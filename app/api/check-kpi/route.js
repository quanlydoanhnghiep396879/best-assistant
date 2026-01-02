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
  // label: "->9h", "→12h30"
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
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
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

function findDMHColumn(block, hourHeaderIdx) {
  // tìm cột có "DM/H" hoặc "DMH" trong 0..3 dòng phía trên dòng mốc giờ
  const start = Math.max(0, hourHeaderIdx - 3);
  for (let r = hourHeaderIdx; r >= start; r--) {
    const row = block[r] || [];
    for (let c = 0; c < row.length; c++) {
      const x = norm(row[c]);
      if (x === "DM/H" || x === "DMH" || x === "DM /H" || x === "ĐM/H" || x === "ĐMH") {
        return c;
      }
    }
  }

  // fallback: nếu dòng mốc giờ có chữ "H" (subheader), thử lấy cột đó
  const row = block[hourHeaderIdx] || [];
  for (let c = 0; c < row.length; c++) {
    if (norm(row[c]) === "H") return c;
  }

  return -1;
}

function findColumnByHeaderNearby(block, hourHeaderIdx, keywords) {
  // tìm cột theo keywords trong 0..3 dòng phía trên (do header nhiều tầng)
  const start = Math.max(0, hourHeaderIdx - 3);
  for (let r = hourHeaderIdx; r >= start; r--) {
    const row = block[r] || [];
    for (let c = 0; c < row.length; c++) {
      const x = norm(row[c]);
      if (keywords.some((k) => x.includes(k))) return c;
    }
  }
  return -1;
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
    const range = `${KPI_SHEET_NAME}!A1:AZ5000`;

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

    // ưu tiên cột A
    for (let r = 0; r < values.length; r++) {
      const nv = norm(values[r]?.[0]);
      if (nv === target || nv === short) {
        startRow = r;
        break;
      }
    }

    // fallback quét toàn sheet
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
        { ok: false, error: `Không tìm thấy ngày ${date} trong tab ${KPI_SHEET_NAME}` },
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

    // ===== 2) TÌM DÒNG HEADER MỐC GIỜ (->9h / →9h) =====
    let hourHeaderIdx = -1;
    for (let i = 0; i < block.length; i++) {
      const row = block[i] || [];
      const hourCount = row.filter(isHourHeaderCell).length;
      if (hourCount >= 2) { // có ít nhất 2 mốc giờ thì chắc chắn là header giờ
        hourHeaderIdx = i;
        break;
      }
    }

    if (hourHeaderIdx < 0) {
      // trả debug 10 dòng đầu của block cho dễ nhìn
      return Response.json(
        {
          ok: false,
          error: "Không tìm thấy dòng header mốc giờ (->9h / →9h).",
          _debug: { startRow, endRow, sample: block.slice(0, 12) },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 3) TÌM CÁC CỘT QUAN TRỌNG (header nhiều tầng) =====
    const colDMH = findDMHColumn(block, hourHeaderIdx);
    if (colDMH < 0) {
      return Response.json(
        {
          ok: false,
          error: "Không tìm thấy cột DM/H (có thể đang merge).",
          _debug: { hourHeaderIdx, sample: block.slice(Math.max(0, hourHeaderIdx - 3), hourHeaderIdx + 2) },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // cột chuyền
    let colLine = findColumnByHeaderNearby(block, hourHeaderIdx, ["CHUYEN", "CHUYỀN", "LINE"]);
    if (colLine < 0) colLine = 0; // fallback

    // cột hiệu suất ngày: "SUẤT ĐẠT TRONG NGÀY" và "ĐỊNH MỨC TRONG NGÀY"
    const colHsDat = findColumnByHeaderNearby(block, hourHeaderIdx, ["SUAT DAT TRONG NGAY"]);
    const colHsDm  = findColumnByHeaderNearby(block, hourHeaderIdx, ["DINH MUC TRONG NGAY"]);

    if (colHsDat < 0 || colHsDm < 0) {
      return Response.json(
        {
          ok: false,
          error:
            "Không thấy cột 'SUẤT ĐẠT TRONG NGÀY' hoặc 'ĐỊNH MỨC TRONG NGÀY' (header có thể đang merge).",
          _debug: { hourHeaderIdx, sample: block.slice(Math.max(0, hourHeaderIdx - 3), hourHeaderIdx + 2) },
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 4) LẤY DANH SÁCH CỘT GIỜ TỪ DÒNG hourHeaderIdx =====
    const hourHeaderRow = block[hourHeaderIdx] || [];
    const hourCols = [];
    for (let c = 0; c < hourHeaderRow.length; c++) {
      if (isHourHeaderCell(hourHeaderRow[c])) {
        hourCols.push({ c, label: String(hourHeaderRow[c]).trim() });
      }
    }

    // ===== 5) ĐỌC DATA ROWS (từ sau headerIdx xuống) =====
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

      // nếu row toàn 0 thì bỏ
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

    if (!rawRows.length) {
      return Response.json(
        {
          ok: true,
          chosenDate: date,
          lines: ["TỔNG HỢP"],
          selectedLine: "TỔNG HỢP",
          dailyRows: [],
          hourly: { line: "TỔNG HỢP", dmH: 0, hours: [] },
          _debug: { startRow, endRow, hourHeaderIdx, note: "Không đọc được dòng dữ liệu dưới header." },
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 6) DAILY (HS đạt vs HS ĐM) =====
    const dailyRows = rawRows
      .map((r) => ({
        line: r.line,
        hsDat: r.hsDat,
        hsDm: r.hsDm,
        status: r.hsDat >= r.hsDm ? "ĐẠT" : "CHƯA ĐẠT",
      }))
      .sort((a, b) => sortLine(a.line, b.line));

    // ===== 7) LINES LIST =====
    const lines = ["TỔNG HỢP", ...dailyRows.map((x) => x.line)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        if (a === "TỔNG HỢP") return -1;
        if (b === "TỔNG HỢP") return 1;
        return sortLine(a, b);
      });

    // ===== 😎 SELECTED LINE =====
    const want = norm(lineParam);
    let selectedLine = "TỔNG HỢP";
    const found = lines.find((x) => norm(x) === want);
    if (found) selectedLine = found;

    // ===== 9) HOURLY (lũy tiến vs DM/H * mốc giờ) =====
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
        _debug: { startRow, endRow, hourHeaderIdx, rowCount: rawRows.length, colDMH, colLine, colHsDat, colHsDm },
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