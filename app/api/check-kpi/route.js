// app/api/check-kpi/route.js
import { getGoogleSheetsClient } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic"; // Next.js: tránh cache API

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

function isBlank(v) {
  return norm(v) === "" || norm(v) === "N/A" || norm(v) === "NA" || norm(v) === "####";
}

// number parse: hỗ trợ 1,08 (decimal comma), 1,234, 1.234,56, "95.87%"
function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let t = s(v).trim();
  if (!t) return 0;
  if (t === "####") return 0;

  // percent?
  const hasPct = t.includes("%");
  t = t.replace(/%/g, "");

  // remove spaces
  t = t.replace(/\s+/g, "");

  // nếu có cả '.' và ',' -> assume ',' là thousands, '.' là decimal hoặc ngược lại
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");

  if (hasDot && hasComma) {
    // case 1.234,56 (EU) -> remove '.', ',' -> '.'
    // detect last separator
    const lastDot = t.lastIndexOf(".");
    const lastComma = t.lastIndexOf(",");
    if (lastComma > lastDot) {
      t = t.replace(/\./g, "").replace(/,/g, ".");
    } else {
      t = t.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    // 1,08 -> decimal comma
    t = t.replace(/,/g, ".");
  } else {
    // 1,234 -> thousands
    t = t.replace(/,/g, "");
  }

  const n = Number(t);
  if (!Number.isFinite(n)) return 0;

  if (hasPct) return n; // already percent
  return n;
}

function toPercent(v) {
  const raw = s(v).trim();
  if (!raw) return 0;

  if (raw.includes("%")) return toNumber(raw); // e.g. "95.87%"
  const n = toNumber(raw);

  // nếu dạng 0.9587 -> 95.87
  if (n > 0 && n <= 1) return n * 100;
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

function findAllDatePositions(grid, dateFull) {
  // dateFull dd/MM/yyyy
  const m = dateFull.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const short = m ? `${m[1]}/${m[2]}` : dateFull;

  const out = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = s(row[c]).trim();
      if (!cell) continue;

      // match full or short (24/12) or exact "24/12/2025"
      if (cell === dateFull || cell === short) out.push({ r, c });
      else {
        // đôi khi cell có dạng "24/12" kèm spaces
        if (cell.replace(/\s+/g, "") === dateFull.replace(/\s+/g, "")) out.push({ r, c });
        if (cell.replace(/\s+/g, "") === short.replace(/\s+/g, "")) out.push({ r, c });
      }
    }
  }
  return out;
}

function rowHasHourlyHeader(row) {
  const cells = row.map((x) => norm(x));
  const hasDmH = cells.some((x) => x.includes("DM/H"));
  const has9h = cells.some((x) => x.includes("->9H") || x.includes(">9H"));
  return hasDmH && has9h;
}

function findHourlyHeaderRowNear(grid, startR) {
  const end = Math.min(grid.length - 1, startR + 40);
  for (let r = startR; r <= end; r++) {
    if (rowHasHourlyHeader(grid[r] || [])) return r;
  }
  return -1;
}

function findHourlyHeaderRow(grid, dateFull) {
  // ưu tiên tìm theo date -> tìm header gần đó
  const pos = findAllDatePositions(grid, dateFull);
  for (const p of pos) {
    const idx = findHourlyHeaderRowNear(grid, p.r);
    if (idx >= 0) return idx;
  }

  // fallback: tìm toàn sheet
  for (let r = 0; r < grid.length; r++) {
    if (rowHasHourlyHeader(grid[r] || [])) return r;
  }

  return -1;
}

function findColumnByHeaderPriority(headerRows, groups) {
  // headerRows: array of rows (vd: [rowHeader, rowHeader2]) để chống merge
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
  // tìm cột nào dưới header có nhiều "C1..C10" nhất
  const maxLook = Math.min(grid.length, headerRowIdx + 30);
  const counts = new Map();

  for (let r = headerRowIdx + 1; r < maxLook; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < Math.min(row.length, 20); c++) {
      if (isLineLabel(row[c])) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }
  }

  let bestCol = -1;
  let bestCount = 0;
  for (const [c, ct] of counts.entries()) {
    if (ct > bestCount) {
      bestCount = ct;
      bestCol = c;
    }
  }
  return bestCol;
}

function hourFactor(label) {
  // label like "->9h", "->12h30", "->16h30"
  const t = norm(label).replace(">", "").replace("-", "");
  // find HH and optional 30
  const m = t.match(/(\d{1,2})H(30)?/);
  if (!m) return 0;
  const hh = parseInt(m[1], 10);
  let f = hh - 8; // 9h ->1
  if (m[2]) f += 0.5; // 12h30 ->4.5
  // theo sheet bạn: ->16h30 vẫn tính 8 (TG SX = 😎
  if (hh >= 16) f = 8;
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

    // đọc vùng đủ lớn (sheet bạn đang nằm khoảng A..T)
    const range = `${DEFAULT_SHEET_NAME}!A1:Z300`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueRenderOption: "UNFORMATTED_VALUE", // lấy số dạng số nếu có
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const grid = resp.data.values || [];
    if (!grid.length) {
      return Response.json(
        { ok: false, error: "Sheet rỗng hoặc không đọc được range" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== tìm header bảng giờ theo ngày =====
    const headerRowIdx = findHourlyHeaderRow(grid, date);
    if (headerRowIdx < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không tìm thấy header bảng giờ (có DM/H và ->9h...).",
          _debug: debug ? { date, range, sampleTop: grid.slice(0, 15) } : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const headerRow = grid[headerRowIdx] || [];
    const headerRow2 = grid[headerRowIdx + 1] || []; // chống merge header 2 tầng
    const headerRows = [headerRow, headerRow2];

    // ===== find columns =====
    const colDmH = findColumnByHeaderPriority(headerRows, [["DM/H"]]);

    // time columns
    const hourCols = [];
    const hourLabels = [];
    for (let c = 0; c < headerRow.length; c++) {
      const t = norm(headerRow[c]);
      if (t.includes("->") && t.includes("H")) {
        hourCols.push(c);
        hourLabels.push(s(headerRow[c]).trim());
      }
    }

    // daily percent columns (header có thể merge)
    let colTGsx = findColumnByHeaderPriority(headerRows, [["TG SX", "TGSX"]]);
    let colHsDat = findColumnByHeaderPriority(headerRows, [
      ["SUAT DAT TRONG NGAY", "HIEU SUAT DAT TRONG NGAY", "HS DAT TRONG NGAY"],
      ["SUAT DAT TRONG"],
    ]);
    let colHsDm = findColumnByHeaderPriority(headerRows, [
      ["DINH MUC TRONG NGAY", "HS DINH MUC TRONG NGAY", "HS DM TRONG NGAY"],
      ["DINH MUC TRONG"],
    ]);

    // fallback theo TG SX
    if ((colHsDat < 0 || colHsDm < 0) && colTGsx >= 0) {
      colHsDat = colTGsx + 1;
      colHsDm = colTGsx + 2;
    }

    if (colDmH < 0 || hourCols.length === 0) {
      return Response.json(
        {
          ok: false,
          error: "Không map được cột DM/H hoặc các cột mốc giờ (->9h...).",
          _debug: debug ? { headerRowIdx, headerRow, colDmH, hourCols } : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (colHsDat < 0 || colHsDm < 0) {
      return Response.json(
        {
          ok: false,
          error:
            "Không thấy cột HS đạt trong ngày / HS định mức trong ngày (header có thể merge hoặc đổi tên).",
          _debug: debug
            ? {
                headerRowIdx,
                found: { colHsDat, colHsDm, colTGsx },
                headerRow,
                headerRow2,
              }
            : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== detect line label column =====
    const colLine = detectLineColumn(grid, headerRowIdx);
    if (colLine < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không dò ra cột chứa C1..C10.",
          _debug: debug ? { headerRowIdx, headerRow, colLine } : undefined,
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== read rows =====
    const exclude = new Set(["CAT", "CẮT", "KCS", "HOAN TAT", "HOÀN TẤT", "NM"]);
    const linesSet = new Set();
    const lineRows = [];

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const rawLine = row[colLine];

      if (!rawLine && r > headerRowIdx + 3) {
        // gặp vùng trống dài -> break mềm (nhưng vẫn cho đọc thêm chút)
        // nếu muốn gắt hơn: break;
      }

      if (!isLineLabel(rawLine)) continue;

      const line = normalizeLine(rawLine);
      if (!line) continue;

      // chỉ lấy C1..C10 (bạn muốn bỏ CẮT/KCS/HOÀN TẤT/NM)
      const n = parseInt(line.replace("C", ""), 10);
      if (!(n >= 1 && n <= 10)) continue;

      if (exclude.has(norm(line))) continue;

      const dmH = toNumber(row[colDmH]);

      // hourly totals (cumulative)
      const hours = hourCols.map((c, idx) => ({
        label: hourLabels[idx],
        total: toNumber(row[c]),
      }));

      const tgSx = colTGsx >= 0 ? toNumber(row[colTGsx]) : 0;
      const hsDat = toPercent(row[colHsDat]);
      const hsDm = toPercent(row[colHsDm]);

      linesSet.add(line);
      lineRows.push({ line, dmH, tgSx, hsDat, hsDm, hours });
    }

    const lines = sortLines([...linesSet]);
    const selectedLine = norm(lineReq) === "TỔNG HỢP" ? "TỔNG HỢP" : normalizeLine(lineReq) || "TỔNG HỢP";

    // ===== dailyRows for table (all lines) =====
    const dailyRows = lineRows.map((x) => ({
      line: x.line,
      hsDat: x.hsDat,
      hsDm: x.hsDm,
      status: x.hsDat >= x.hsDm ? "ĐẠT" : "CHƯA ĐẠT",
    }));

    // ===== hourly for selected line =====
    let hourly = { line: selectedLine, dmH: 0, hours: [] };

    if (selectedLine === "TỔNG HỢP") {
      // sum dmH + sum totals each hour
      const dmHsum = lineRows.reduce((acc, x) => acc + (Number.isFinite(x.dmH) ? x.dmH : 0), 0);
      hourly.dmH = dmHsum;

      const sums = hourLabels.map((label, idx) => {
        const total = lineRows.reduce((acc, x) => acc + (x.hours[idx]?.total || 0), 0);
        const f = hourFactor(label);
        const dmTarget = dmHsum * f;
        const diff = total - dmTarget;
        return {
          label,
          total,
          dmTarget,
          diff,
          status: diff >= 0 ? "VƯỢT" : "THIẾU",
        };
      });

      hourly.hours = sums;
    } else {
      const row = lineRows.find((x) => x.line === selectedLine);
      if (row) {
        hourly.dmH = row.dmH;

        hourly.hours = row.hours.map((h) => {
          const f = hourFactor(h.label);
          const dmTarget = row.dmH * f;
          const diff = h.total - dmTarget;
          return {
            label: h.label,
            total: h.total,
            dmTarget,
            diff,
            status: diff >= 0 ? "VƯỢT" : "THIẾU",
          };
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
              headerRowIdx,
              cols: { colLine, colDmH, hourCols, colTGsx, colHsDat, colHsDm },
              headerRow: headerRow.slice(0, 40),
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