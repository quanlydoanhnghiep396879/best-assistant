// app/api/check-kpi/route.js
import { getSheetsClient } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic"; // tránh cache ở Vercel

// ===== Helpers =====
const noMark = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const norm = (s) =>
  noMark(s)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

function toNumberSafe(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const t = String(v).trim();
  if (!t) return null;

  // "95.87%" , "1,234"
  const cleaned = t.replace(/%/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isLikelyDateCell(x) {
  const t = String(x ?? "").trim();
  return /^\d{2}\/\d{2}(\/\d{4})?$/.test(t);
}

// hỗ trợ "->9h", "-> 9h", "→9h", "→ 12h30"
function isHourHeaderCell(x) {
  const s = String(x ?? "").trim();
  if (!s) return false;
  return /^(->|→)\s*\d{1,2}\s*h(\s*\d{1,2})?$/i.test(s.replace(/\s+/g, ""));
}

function parseHourFactor(label) {
  let s = String(label ?? "").trim();
  s = s.replace(/^->\s*/i, "").replace(/^→\s*/i, "");
  s = s.replace(/\s+/g, "").toUpperCase(); // "12H30"
  const m = s.match(/^(\d{1,2})H(\d{1,2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const factor = hh + mm / 60 - 8; // 9h=1, 10h=2, 12h30=4.5...
  return factor > 0 ? factor : null;
}

function sortLine(a, b) {
  const na = norm(a);
  const nb = norm(b);
  const ma = na.match(/^C(\d+)$/);
  const mb = nb.match(/^C(\d+)$/);
  if (ma && mb) return Number(ma[1]) - Number(ma[2] ? ma[2] : ma[1]) - (Number(mb[1]));
  if (ma && !mb) return -1;
  if (!ma && mb) return 1;
  return na.localeCompare(nb, "vi");
}

function shouldSkipLine(lineNorm) {
  return (
    lineNorm === "CAT" ||
    lineNorm === "CẮT" ||
    lineNorm === "HOAN TAT" ||
    lineNorm === "HOÀN TẤT" ||
    lineNorm === "KCS" ||
    lineNorm === "NM"
  );
}

function pickEnvSheetId() {
  return process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || "";
}

/**
 * 🔥 Quan trọng:
 * Header sheet bạn bị merge/nhiều tầng => KHÔNG được chỉ dò quanh hourHeaderIdx.
 * Hàm này sẽ dò toàn block, ưu tiên header nằm "thấp" hơn (gần data hơn).
 */
function findColumnByHeaderAnywhere(block, keywords, maxRows = 60) {
  let best = { r: -1, c: -1 };
  const R = Math.min(block.length, maxRows);

  for (let r = 0; r < R; r++) {
    const row = block[r] || [];
    for (let c = 0; c < row.length; c++) {
      const x = norm(row[c]);
      if (!x) continue;
      if (keywords.some((k) => x.includes(k))) {
        // ưu tiên row lớn hơn (gần data hơn)
        if (r > best.r) best = { r, c };
      }
    }
  }
  return best.c;
}

// Ưu tiên nhóm keyword theo thứ tự
function findColumnByHeaderPriority(block, groups) {
  for (const g of groups) {
    const c = findColumnByHeaderAnywhere(block, g);
    if (c >= 0) return c;
  }
  return -1;
}

function findDMHColumn(block, hourHeaderIdx) {
  // dò quanh header giờ trước, vì DM/H nằm gần khu giờ
  const start = Math.max(0, hourHeaderIdx - 5);
  for (let r = hourHeaderIdx; r >= start; r--) {
    const row = block[r] || [];
    for (let c = 0; c < row.length; c++) {
      const x = norm(row[c]);
      if (x === "DM/H" || x === "DMH" || x === "DM /H" || x === "ĐM/H" || x === "ĐMH") return c;
    }
  }
  // fallback: nếu dòng mốc giờ có chữ "H"
  const row = block[hourHeaderIdx] || [];
  for (let c = 0; c < row.length; c++) {
    if (norm(row[c]) === "H") return c;
  }
  return -1;
}

function findLineColumn(block) {
  // dò toàn block để chắc ăn
  const c = findColumnByHeaderAnywhere(block, ["CHUYEN", "CHUYỀN", "LINE", "CHUYEN/BP"]);
  return c >= 0 ? c : 0;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim(); // dd/MM/yyyy
    const lineParam = (searchParams.get("line") || "TỔNG HỢP").trim();

    if (!date) {
      return Response.json({ ok: false, error: "Thiếu query ?date=dd/MM/yyyy" }, { status: 400 });
    }

    const spreadsheetId = pickEnvSheetId();
    if (!spreadsheetId) {
      return Response.json({ ok: false, error: "Thiếu env GOOGLE_SHEET_ID" }, { status: 500 });
    }

    const KPI_SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";
    const sheets = await getSheetsClient();

    // ✅ tăng range (sheet bạn khá rộng)
    const range = `${KPI_SHEET_NAME}!A1:CF500`;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp.data.values || [];
    if (!values.length) {
      return Response.json({ ok: false, error: "Sheet rỗng hoặc không đọc được" }, { status: 500 });
    }

    const target = norm(date);
    const short = norm(date.replace(/\/\d{4}$/, "")); // dd/MM

    // ===== 1) TÌM BLOCK THEO NGÀY =====
    let startRow = -1;

    for (let r = 0; r < values.length; r++) {
      const nv = norm(values[r]?.[0]);
      if (nv === target || nv === short) {
        startRow = r;
        break;
      }
    }

    if (startRow < 0) {
      outer: for (let r = 0; r < values.length; r++) {
        const row = values[r] || [];
        for (let c = 0; c < row.length; c++) {
          const nv = norm(row[c]);
          if (nv === target || nv === short) {
            startRow = r;
            break outer;
          }
        }
      }
    }

    if (startRow < 0) {
      return Response.json(
        { ok: false, error: `Không tìm thấy ngày ${date} trong tab ${KPI_SHEET_NAME}`},
        { status: 404 }
      );
    }

    let endRow = values.length;
    for (let r = startRow + 1; r < values.length; r++) {
      const v = values[r]?.[0];
      if (isLikelyDateCell(v)) {
        endRow = r;
        break;
      }
    }

    const block = values.slice(startRow, endRow);

    // ===== 2) TÌM DÒNG HEADER MỐC GIỜ =====
    let hourHeaderIdx = -1;
    for (let i = 0; i < block.length; i++) {
      const row = block[i] || [];
      const hourCount = row.filter(isHourHeaderCell).length;
      if (hourCount >= 2) {
        hourHeaderIdx = i;
        break;
      }
    }

    if (hourHeaderIdx < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không tìm thấy dòng header mốc giờ (->9h / →9h).",
          _debug: { startRow, endRow, sample: block.slice(0, 20) },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 3) TÌM CỘT QUAN TRỌNG =====
    const colDMH = findDMHColumn(block, hourHeaderIdx);
    if (colDMH < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không tìm thấy cột DM/H (có thể đang merge).",
          _debug: { hourHeaderIdx, sample: block.slice(Math.max(0, hourHeaderIdx - 6), hourHeaderIdx + 3) },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const colLine = findLineColumn(block);

    // ✅ HS đạt trong ngày: ưu tiên đúng theo sheet bạn
    const colHsDat = findColumnByHeaderPriority(block, [
      ["TY LE HS DAT/NGAY", "TY LE HS DAT NGAY"],
      ["HIEU SUAT DAT TRONG NGAY", "SUAT DAT TRONG NGAY", "HS DAT TRONG NGAY"],
      ["H SUAT DAT TRONG NGAY", "H. SUAT DAT TRONG NGAY"],
      // fallback cuối: có thể bạn đổi tên
      ["TY LE HS DAT", "HS DAT"],
    ]);

    // ✅ HS định mức trong ngày: ưu tiên đúng theo sheet bạn
    const colHsDm = findColumnByHeaderPriority(block, [
      ["HS DINH MUC TRONG NGAY", "DINH MUC TRONG NGAY", "HS DM TRONG NGAY"],
      ["HS DINH MUC BQ", "DINH MUC BQ", "DINH MUC BQ DAU THANG", "HS DINH MUC BQ DAU THANG"],
      // fallback cuối
      ["HS DINH MUC", "HS DM", "DINH MUC"],
    ]);

    if (colHsDat < 0 || colHsDm < 0) {
      return Response.json(
        {
          ok: false,
          error:
            "Không thấy cột HS đạt trong ngày / HS định mức trong ngày (header có thể merge hoặc đổi tên).",
          _debug: {
            hourHeaderIdx,
            found: { colHsDat, colHsDm },
            // show nhiều hơn để bạn nhìn thấy header đúng
            sample: block.slice(0, 25),
          },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 4) LẤY CÁC CỘT GIỜ =====
    const hourHeaderRow = block[hourHeaderIdx] || [];
    const hourCols = [];
    for (let c = 0; c < hourHeaderRow.length; c++) {
      if (isHourHeaderCell(hourHeaderRow[c])) {
        hourCols.push({ c, label: String(hourHeaderRow[c]).trim() });
      }
    }

    // ===== 5) ĐỌC DỮ LIỆU =====
    const rawRows = [];
    for (let i = hourHeaderIdx + 1; i < block.length; i++) {
      const row = block[i] || [];
      const line = String(row[colLine] ?? "").trim();
      if (!line) continue;

      const lineNorm = norm(line);
      if (shouldSkipLine(lineNorm)) continue;

      const dmH = toNumberSafe(row[colDMH]) ?? 0;
      const hsDat = toNumberSafe(row[colHsDat]) ?? 0;
      const hsDm = toNumberSafe(row[colHsDm]) ?? 0;

      // nếu cả 3 đều 0 thì bỏ qua
      if (dmH === 0 && hsDat === 0 && hsDm === 0) continue;

      const hourValues = {};
      for (const hc of hourCols) {
        hourValues[hc.label] = toNumberSafe(row[hc.c]) ?? 0;
      }

      rawRows.push({
        line: line.toUpperCase(),
        dmH,
        hsDat,
        hsDm,
        hourValues,
      });
    }

    // ===== 6) DAILY =====
    const dailyRows = rawRows
      .map((r) => ({
        line: r.line,
        hsDat: r.hsDat,
        hsDm: r.hsDm,
        status: r.hsDat >= r.hsDm ? "ĐẠT" : "CHƯA ĐẠT",
      }))
      .sort((a, b) => {
        const ma = norm(a.line).match(/^C(\d+)$/);
        const mb = norm(b.line).match(/^C(\d+)$/);
        if (ma && mb) return Number(ma[1]) - Number(mb[1]);
        if (ma && !mb) return -1;
        if (!ma && mb) return 1;
        return norm(a.line).localeCompare(norm(b.line), "vi");
      });

    // ===== 7) LINES =====
    const lines = ["TỔNG HỢP", ...dailyRows.map((x) => x.line)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        if (a === "TỔNG HỢP") return -1;
        if (b === "TỔNG HỢP") return 1;
        const ma = norm(a).match(/^C(\d+)$/);
        const mb = norm(b).match(/^C(\d+)$/);
        if (ma && mb) return Number(ma[1]) - Number(mb[1]);
        if (ma && !mb) return -1;
        if (!ma && mb) return 1;
        return norm(a).localeCompare(norm(b), "vi");
      });

    // ===== 😎 SELECTED LINE =====
    const want = norm(lineParam);
    let selectedLine = "TỔNG HỢP";
    const found = lines.find((x) => norm(x) === want);
    if (found) selectedLine = found;

    // ===== 9) HOURLY =====
    let base;
    if (selectedLine === "TỔNG HỢP") {
      const sumDmH = rawRows.reduce((s, r) => s + (r.dmH || 0), 0);
      const sumHour = {};
      for (const hc of hourCols) sumHour[hc.label] = 0;
      for (const r of rawRows) {
        for (const hc of hourCols) sumHour[hc.label] += r.hourValues[hc.label] || 0;
      }
      base = { line: "TỔNG HỢP", dmH: sumDmH, hourValues: sumHour };
    } else {
      base = rawRows.find((r) => norm(r.line) === norm(selectedLine));
      if (!base) base = { line: selectedLine, dmH: 0, hourValues: {} };
    }

    const hours = hourCols.map((hc) => {
      const label = hc.label;
      const total = Number(base.hourValues?.[label] ?? 0) || 0;
      const factor = parseHourFactor(label);
      const dmTarget = factor ? (base.dmH || 0) * factor : 0;
      const diff = total - dmTarget;

      return {
        label,
        total,
        dmTarget,
        diff,
        status: diff >= 0 ? "VƯỢT" : "THIẾU",
      };
    });

    return Response.json(
      {
        ok: true,
        chosenDate: date,
        lines,
        selectedLine,
        dailyRows,
        hourly: { line: base.line, dmH: base.dmH || 0, hours },
        _debug: {
          startRow,
          endRow,
          hourHeaderIdx,
          rowCount: rawRows.length,
          colLine,
          colDMH,
          colHsDat,
          colHsDm,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
