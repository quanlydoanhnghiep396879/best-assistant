// app/api/check-kpi/route.js
import { getGoogleSheetsClient } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const DEFAULT_SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// ===== helpers =====
const s = (v) => (v == null ? "" : String(v));

function noMark(str) {
  return s(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function norm(str) {
  return noMark(str)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let t = s(v).trim();
  if (!t || t === "####") return 0;

  const hasPct = t.includes("%");
  t = t.replace(/%/g, "").replace(/\s+/g, "");

  const hasDot = t.includes(".");
  const hasComma = t.includes(",");

  if (hasDot && hasComma) {
    const lastDot = t.lastIndexOf(".");
    const lastComma = t.lastIndexOf(",");
    if (lastComma > lastDot) t = t.replace(/\./g, "").replace(/,/g, ".");
    else t = t.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    t = t.replace(/,/g, ".");
  } else {
    t = t.replace(/,/g, "");
  }

  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function toPercent(v) {
  const raw = s(v).trim();
  if (!raw) return 0;
  if (raw.includes("%")) return toNumber(raw); // "95.87%"
  const n = toNumber(raw);
  if (n > 0 && n <= 1) return n * 100; // 0.9587 => 95.87
  return n;
}

function isLineLabel(v) {
  const t = norm(v);
  return /^C\s*0*\d+$/.test(t);
}

function normalizeLine(v) {
  const m = norm(v).match(/^C\s*0*(\d+)$/);
  if (!m) return "";
  return `C${parseInt(m[1], 10)}`;
}

function sortLines(lines) {
  return [...lines].sort((a, b) => {
    const na = parseInt(a.replace(/^C/i, ""), 10);
    const nb = parseInt(b.replace(/^C/i, ""), 10);
    return na - nb;
  });
}

// ===== hour header detection (robust) =====
function unifyArrowText(t) {
  // chuẩn hoá mũi tên unicode về "->"
  return t
    .replace(/[→➜➔⇒]/g, "->")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHourLabel(cell) {
  let t = norm(cell);
  if (!t) return null;
  t = unifyArrowText(t);

  // loại DM/H
  if (t.includes("DM/H")) return null;

  // tìm dạng "->9H", "->12H30", "9H", "12H30"...
  const m = t.match(/(\d{1,2})\s*H\s*(30)?/);
  if (!m) return null;

  const hh = parseInt(m[1], 10);
  if (!(hh >= 7 && hh <= 23)) return null;

  const hasArrow = t.includes("->") || t.includes(">") || t.startsWith("-");

  // ưu tiên những ô có mũi tên, nhưng vẫn cho qua nếu đúng dạng giờ (để chịu merge)
  const label = `->${hh}h${m[2] ? "30" : ""}`;
  return { label, hasArrow };
}

function findBestHourlyHeaderRow(grid) {
  let best = { r: -1, score: 0, hasDmHNear: false };

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const hoursSet = new Set();
    let hasArrowCount = 0;

    for (let c = 0; c < row.length; c++) {
      const ex = extractHourLabel(row[c]);
      if (ex) {
        hoursSet.add(ex.label);
        if (ex.hasArrow) hasArrowCount++;
      }
    }

    // score: số mốc giờ unique, cộng thêm arrowCount để ưu tiên đúng dòng
    const score = hoursSet.size * 10 + hasArrowCount;

    if (score > best.score) {
      // check DM/H gần đó (r-2..r+2)
      let nearDmH = false;
      for (let k = Math.max(0, r - 2); k <= Math.min(grid.length - 1, r + 2); k++) {
        const rr = (grid[k] || []).map((x) => norm(x)).join(" | ");
        if (rr.includes("DM/H")) {
          nearDmH = true;
          break;
        }
      }
      best = { r, score, hasDmHNear: nearDmH };
    }
  }

  // yêu cầu tối thiểu phải có >= 2 mốc giờ (score >= 20)
  if (best.score < 20) return -1;
  return best.r;
}

function findColumnByHeaderPriority(headerRows, groups) {
  const H = [];
  for (const row of headerRows) {
    if (!row) continue;
    for (let i = 0; i < row.length; i++) {
      if (!H[i]) H[i] = [];
      H[i].push(norm(row[i]));
    }
  }

  for (const group of groups) {
    for (let col = 0; col < H.length; col++) {
      const mergedText = (H[col] || []).join(" | ");
      for (const kw of group) {
        const k = norm(kw);
        if (k && mergedText.includes(k)) return col;
      }
    }
  }
  return -1;
}

function detectLineColumn(grid, headerRowIdx) {
  const maxLook = Math.min(grid.length, headerRowIdx + 40);
  const counts = new Map();

  for (let r = headerRowIdx + 1; r < maxLook; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < Math.min(row.length, 25); c++) {
      if (isLineLabel(row[c])) counts.set(c, (counts.get(c) || 0) + 1);
    }
  }

  let bestCol = -1,
    bestCount = 0;
  for (const [c, ct] of counts.entries()) {
    if (ct > bestCount) {
      bestCount = ct;
      bestCol = c;
    }
  }
  return bestCol;
}

function hourFactor(label) {
  const t = norm(label).replace(">", "").replace("-", "");
  const m = t.match(/(\d{1,2})H(30)?/);
  if (!m) return 0;
  const hh = parseInt(m[1], 10);
  let f = hh - 8; // 9h ->1
  if (m[2]) f += 0.5; // 12h30 ->4.5
  if (hh >= 16) f = 8; // clamp
  return f;
}

// ===== API =====
export async function GET(req) {
  try {
    if (!SPREADSHEET_ID) {
      return Response.json(
        { ok: false, error: "Missing env GOOGLE_SHEET_ID" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { searchParams } = new URL(req.url);
    const date = s(searchParams.get("date")).trim(); // dd/MM/yyyy
    const lineReq = s(searchParams.get("line") || "TỔNG HỢP").trim();
    const debug = searchParams.get("debug") === "1";

    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      return Response.json(
        { ok: false, error: "date phải dạng dd/MM/yyyy (vd 24/12/2025)" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const sheets = await getGoogleSheetsClient();

    const range = `${DEFAULT_SHEET_NAME}!A1:Z400`; // tăng range chút cho chắc
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const grid = resp.data.values || [];
    if (!grid.length) {
      return Response.json(
        { ok: false, error: "Sheet rỗng hoặc không đọc được range" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 1) tìm dòng header giờ theo kiểu robust =====
    const hourHeaderIdx = findBestHourlyHeaderRow(grid);
    if (hourHeaderIdx < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không tìm thấy header bảng giờ (->9h, ->10h...).",
          _debug: debug
            ? {
                range,
                hint:
                  "Bật debug=1 để xem header sample. Nếu sheet dùng ký hiệu khác '->9h' hãy chụp đúng dòng mốc giờ.",
                top30: grid.slice(0, 30),
              }
            : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // headerRows: lấy cả trên/dưới để chịu merge
    const headerRows = [
      grid[hourHeaderIdx - 2],
      grid[hourHeaderIdx - 1],
      grid[hourHeaderIdx],
      grid[hourHeaderIdx + 1],
      grid[hourHeaderIdx + 2],
    ].filter(Boolean);

    // ===== 2) tìm cột DM/H =====
    const colDmH = findColumnByHeaderPriority(headerRows, [["DM/H"]]);
    if (colDmH < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không tìm thấy cột DM/H (do merge/đổi tên).",
          _debug: debug ? { hourHeaderIdx, headerRows } : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 3) tìm các cột giờ từ dòng có nhiều mốc giờ nhất =====
    const bestRow = grid[hourHeaderIdx] || [];
    const hourCols = [];
    const hourLabels = [];

    for (let c = 0; c < bestRow.length; c++) {
      const ex = extractHourLabel(bestRow[c]);
      if (ex) {
        hourCols.push(c);
        hourLabels.push(s(bestRow[c]).trim());
      }
    }

    if (hourCols.length < 2) {
      // fallback: thử dòng kế bên (do header 2 tầng)
      const row2 = grid[hourHeaderIdx + 1] || [];
      for (let c = 0; c < row2.length; c++) {
        const ex = extractHourLabel(row2[c]);
        if (ex) {
          hourCols.push(c);
          hourLabels.push(s(row2[c]).trim());
        }
      }
    }

    if (hourCols.length < 2) {
      return Response.json(
        {
          ok: false,
          error: "Tìm được dòng header nhưng không lấy được các cột ->9h, ->10h...",
          _debug: debug ? { hourHeaderIdx, bestRow } : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 4) daily columns =====
    let colTGsx = findColumnByHeaderPriority(headerRows, [["TG SX", "TGSX"]]);
    let colHsDat = findColumnByHeaderPriority(headerRows, [
      ["SUAT DAT TRONG NGAY", "HIEU SUAT DAT TRONG NGAY", "HS DAT TRONG NGAY"],
      ["SUAT DAT TRONG"],
    ]);
    let colHsDm = findColumnByHeaderPriority(headerRows, [
      ["DINH MUC TRONG NGAY", "HS DINH MUC TRONG NGAY", "HS DM TRONG NGAY"],
      ["DINH MUC TRONG"],
    ]);

    if ((colHsDat < 0 || colHsDm < 0) && colTGsx >= 0) {
      colHsDat = colTGsx + 1;
      colHsDm = colTGsx + 2;
    }

    if (colHsDat < 0 || colHsDm < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không map được cột SUẤT ĐẠT TRONG NGÀY / ĐỊNH MỨC TRONG NGÀY (do merge/đổi tên).",
          _debug: debug ? { hourHeaderIdx, headerRows, found: { colTGsx, colHsDat, colHsDm } } : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 5) dò cột line C1..C10 =====
    const colLine = detectLineColumn(grid, hourHeaderIdx);
    if (colLine < 0) {
      return Response.json(
        { ok: false, error: "Không dò ra cột chứa C1..C10." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 6) đọc data rows =====
    const linesSet = new Set();
    const lineRows = [];

    for (let r = hourHeaderIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const rawLine = row[colLine];
      if (!isLineLabel(rawLine)) continue;

      const line = normalizeLine(rawLine);
      if (!line) continue;

      const n = parseInt(line.replace("C", ""), 10);
      if (!(n >= 1 && n <= 10)) continue;

      const dmH = toNumber(row[colDmH]);
      const hours = hourCols.map((c, idx) => ({
        label: hourLabels[idx],
        total: toNumber(row[c]),
      }));

      const hsDat = toPercent(row[colHsDat]);
      const hsDm = toPercent(row[colHsDm]);

      linesSet.add(line);
      lineRows.push({ line, dmH, hsDat, hsDm, hours });
    }

    const lines = sortLines([...linesSet]);
    const selectedLine =
      norm(lineReq) === "TỔNG HỢP" ? "TỔNG HỢP" : normalizeLine(lineReq) || "TỔNG HỢP";

    const dailyRows = lineRows.map((x) => ({
      line: x.line,
      hsDat: x.hsDat,
      hsDm: x.hsDm,
      status: x.hsDat >= x.hsDm ? "ĐẠT" : "CHƯA ĐẠT",
    }));

    // hourly
    let hourly = { line: selectedLine, dmH: 0, hours: [] };

    if (selectedLine === "TỔNG HỢP") {
      const dmHsum = lineRows.reduce((acc, x) => acc + (Number.isFinite(x.dmH) ? x.dmH : 0), 0);
      hourly.dmH = dmHsum;

      hourly.hours = hourLabels.map((label, idx) => {
        const total = lineRows.reduce((acc, x) => acc + (x.hours[idx]?.total || 0), 0);
        const f = hourFactor(label);
        const dmTarget = dmHsum * f;
        const diff = total - dmTarget;
        return { label, total, dmTarget, diff, status: diff >= 0 ? "VƯỢT" : "THIẾU" };
      });
    } else {
      const row = lineRows.find((x) => x.line === selectedLine);
      if (row) {
        hourly.dmH = row.dmH;
        hourly.hours = row.hours.map((h) => {
          const f = hourFactor(h.label);
          const dmTarget = row.dmH * f;
          const diff = h.total - dmTarget;
          return { label: h.label, total: h.total, dmTarget, diff, status: diff >= 0 ? "VƯỢT" : "THIẾU" };
        });
      }
    }

    return Response.json(
      {
        ok: true,
        chosenDate: date,
        lines: ["TỔNG HỢP", ...lines],
        selectedLine,
        dailyRows,
        hourly,
        _debug: debug
          ? {
              sheet: DEFAULT_SHEET_NAME,
              range,
              hourHeaderIdx,
              cols: { colLine, colDmH, hourCols, colHsDat, colHsDm },
              headerSample: headerRows.map((r) => (r || []).slice(0, 40)),
            }
          : undefined,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}