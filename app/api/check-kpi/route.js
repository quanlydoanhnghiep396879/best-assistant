// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import getSheetsClientMaybe from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

// ===== helpers =====
const s = (v) => (v === null || v === undefined ? "" : String(v));
const normSpaces = (str) => s(str).replace(/\u00A0/g, " ").trim();

// bỏ dấu + đổi Đ/đ -> D/d
function noMark(str) {
  return normSpaces(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, (m) => (m === "Đ" ? "D" : "d"));
}

function norm(str) {
  return noMark(str).toUpperCase();
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = normSpaces(v);
  if (!t) return 0;
  // bỏ dấu % nếu có
  const cleaned = t.replace(/%/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function isDateCell(v) {
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normSpaces(v));
}

function normalizeLineLabel(raw) {
  const t = normSpaces(raw);
  // C01 / c1 / C 1 -> C1
  const m = t.match(/^C\s*0*([0-9]+)$/i);
  if (m) return `C${Number(m[1])}`;
  return t;
}

function isLineC(raw) {
  const t = normalizeLineLabel(raw);
  return /^C([1-9]|10|[0-9]{2,})$/i.test(t); // cho C1..C10..C99...
}

function lineSort(a, b) {
  const na = Number(String(a).replace(/[^0-9]/g, "")) || 0;
  const nb = Number(String(b).replace(/[^0-9]/g, "")) || 0;
  return na - nb;
}

function jsonNoStore(obj, status = 200) {
  return NextResponse.json(obj, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

// ===== tìm cột theo header trong 1 vùng hàng =====
function findColByHeaders(rows, headersNeed) {
  // rows: array of rows (2D), tìm thấy header ở bất kỳ row nào -> trả col index
  // headersNeed: array of strings (đã norm)
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const cell = norm(row[c]);
      if (!cell) continue;
      if (headersNeed.some((h) => cell.includes(h))) return c;
    }
  }
  return -1;
}

// ===== tìm hàng chứa header hours "->9h" ... =====
function findHourHeaderRow(values) {
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    let hit = 0;
    for (const cell of row) {
      const t = normSpaces(cell);
      if (/^->?\s*\d{1,2}h(30)?$/i.test(t)) hit++;
    }
    // chỉ cần thấy vài mốc giờ là coi như hàng header giờ
    if (hit >= 3) return r;
  }
  return -1;
}

function buildHourCols(values, hourHeaderIdx) {
  const row = values[hourHeaderIdx] || [];
  const cols = [];
  for (let c = 0; c < row.length; c++) {
    const t = normSpaces(row[c]);
    if (/^->?\s*\d{1,2}h(30)?$/i.test(t)) {
      // chuẩn hoá label hiển thị dạng "->9h"
      const label = t.startsWith("->") ? t : `->${t.replace(/^>/, "")}`;
      cols.push({ label, col: c });
    }
  }
  return cols;
}

// hệ số giờ để tính DM lũy tiến
const HOUR_FACTORS = {
  "->9H": 1,
  "->10H": 2,
  "->11H": 3,
  "->12H30": 4.5,
  "->13H30": 5.5,
  "->14H30": 6.5,
  "->15H30": 7.5,
  "->16H30": 8,
};

function hourFactor(label) {
  const k = norm(label);
  return HOUR_FACTORS[k] ?? null;
}

// ===== main =====
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const date = normSpaces(searchParams.get("date")); // dd/MM/yyyy
  const selectedLineRaw = normSpaces(searchParams.get("line") || "TỔNG HỢP");
  const wantDebug = searchParams.get("debug") === "1";

  if (!date || !isDateCell(date)) {
    return jsonNoStore({ ok: false, error: "Thiếu hoặc sai định dạng date (dd/MM/yyyy)" }, 400);
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    return jsonNoStore({ ok: false, error: "Missing env GOOGLE_SHEET_ID" }, 500);
  }

  const sheetName = process.env.KPI_SHEET_NAME || "KPI";
  const range = `${sheetName}!A1:Z400`;

  // lấy client
  let client = getSheetsClientMaybe;
  if (typeof getSheetsClientMaybe === "function") {
    client = await getSheetsClientMaybe();
  }

  // validate shape
  if (!client?.spreadsheets?.values?.get) {
    return jsonNoStore(
      {
        ok: false,
        error: "googleSheetsClient không đúng kiểu. Cần có client.spreadsheets.values.get(...)",
      },
      500
    );
  }

  // đọc sheet
  let values = [];
  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    values = res?.data?.values || [];
  } catch (e) {
    return jsonNoStore({ ok: false, error: e?.message || "Read sheet failed" }, 500);
  }

  // tìm dòng có ngày
  let dateRow = -1;
  for (let r = 0; r < values.length; r++) {
    const v = normSpaces(values[r]?.[0]);
    if (v === date) {
      dateRow = r;
      break;
    }
  }
  if (dateRow < 0) {
    return jsonNoStore({ ok: true, chosenDate: date, lines: ["TỔNG HỢP"], selectedLine: "TỔNG HỢP", dailyRows: [], hourly: { line: "TỔNG HỢP", dmH: 0, hours: [] } });
  }

  // tìm header daily (cột suất đạt & định mức trong ngày) bằng cách scan toàn sheet
  let dailyHeaderRow = -1;
  let colHsDat = -1;
  let colHsDm = -1;

  const needDat = ["SUAT DAT TRONG NGAY", "HS DAT TRONG NGAY", "TY LE HS DAT"];
  const needDm = ["DINH MUC TRONG NGAY", "HS DINH MUC TRONG NGAY", "TY LE HS DINH MUC", "DINH MUC"];

  for (let r = 0; r < Math.min(values.length, 80); r++) {
    const row = values[r] || [];
    const rowNorm = row.map((x) => norm(x));
    const hasDat = rowNorm.some((x) => needDat.some((k) => x.includes(k)));
    const hasDm = rowNorm.some((x) => needDm.some((k) => x.includes(k)));
    if (hasDat && hasDm) {
      dailyHeaderRow = r;
      break;
    }
  }

  if (dailyHeaderRow >= 0) {
    // tìm col trong vùng vài hàng quanh header (phòng merge)
    const dailyHeaderRows = values.slice(Math.max(0, dailyHeaderRow - 1), dailyHeaderRow + 2);
    colHsDat = findColByHeaders(dailyHeaderRows, needDat);
    colHsDm = findColByHeaders(dailyHeaderRows, needDm);
  }

  // tìm header giờ
  const hourHeaderIdx = findHourHeaderRow(values);
  const hourCols = hourHeaderIdx >= 0 ? buildHourCols(values, hourHeaderIdx) : [];

  // tìm cột DM/H (hoặc ĐM/H) quanh header giờ
  let colDmH = -1;
  if (hourHeaderIdx >= 0 && hourCols.length) {
    const around = values.slice(Math.max(0, hourHeaderIdx - 3), hourHeaderIdx + 2);
    colDmH = findColByHeaders(around, [
      "DM/H",
      "DMH",
      "DINH MUC/H",
      "DINH MUC GIO",
      "DINH MUC GIO/H",
      "ĐM/H", // đã được norm() thành DM/H nhờ noMark()
    ]);

    // fallback nếu merge làm mất text: lấy cột ngay trước mốc giờ đầu tiên
    if (colDmH < 0) {
      const firstHourCol = Math.min(...hourCols.map((x) => x.col));
      const guess = firstHourCol - 1;
      if (guess >= 0) colDmH = guess;
    }
  }

  // ===== parse lines rows: từ dateRow+1 đến khi gặp dòng trống hoặc ngày khác =====
  const lineRows = [];
  for (let r = dateRow + 1; r < values.length; r++) {
    const first = normSpaces(values[r]?.[0]);

    if (!first) break;
    if (isDateCell(first)) break; // sang ngày khác

    const line = normalizeLineLabel(first);

    // chỉ lấy C1..C10.. (bỏ CẮT/KCS/HOÀN TẤT/NM...)
    if (!isLineC(line)) continue;

    const hsDat = colHsDat >= 0 ? toNumberSafe(values[r]?.[colHsDat]) : 0;
    const hsDm = colHsDm >= 0 ? toNumberSafe(values[r]?.[colHsDm]) : 0;

    // giờ
    const dmH = colDmH >= 0 ? toNumberSafe(values[r]?.[colDmH]) : 0;

    const hours = hourCols.map(({ label, col }) => ({
      label,
      total: toNumberSafe(values[r]?.[col]),
    }));

    lineRows.push({ r, line, hsDat, hsDm, dmH, hours });
  }

  // lines list
  const lines = ["TỔNG HỢP", ...lineRows.map((x) => x.line).sort(lineSort)];

  // dailyRows output (luôn trả toàn bộ)
  const dailyRows = lineRows
    .map((x) => {
      const status = x.hsDat >= x.hsDm ? "ĐẠT" : "CHƯA ĐẠT";
      return { line: x.line, hsDat: x.hsDat, hsDm: x.hsDm, status };
    })
    .sort((a, b) => lineSort(a.line, b.line));

  // ===== hourly for selected line / tổng hợp =====
  const selectedLine = norm(selectedLineRaw) === "TONG HOP" || norm(selectedLineRaw) === "TỔNG HỢP" ? "TỔNG HỢP" : normalizeLineLabel(selectedLineRaw);

  let hourly = { line: selectedLine, dmH: 0, hours: [] };

  if (!hourCols.length) {
    // không có bảng giờ
    hourly = { line: selectedLine, dmH: 0, hours: [] };
  } else {
    if (selectedLine === "TỔNG HỢP") {
      const dmH = lineRows.reduce((sum, x) => sum + (x.dmH || 0), 0);

      const hours = hourCols.map(({ label }) => {
        const total = lineRows.reduce((sum, x) => {
          const found = x.hours.find((h) => h.label === label);
          return sum + (found?.total || 0);
        }, 0);

        const f = hourFactor(label);
        const dmTarget = f === null ? 0 : dmH * f;
        const diff = total - dmTarget;
        const status = diff >= 0 ? "VƯỢT" : "THIẾU";

        return { label, total, dmTarget, diff, status };
      });

      hourly = { line: "TỔNG HỢP", dmH, hours };
    } else {
      const row = lineRows.find((x) => norm(x.line) === norm(selectedLine));
      if (!row) {
        hourly = { line: selectedLine, dmH: 0, hours: [] };
      } else {
        const dmH = row.dmH || 0;
        const hours = hourCols.map(({ label }) => {
          const found = row.hours.find((h) => h.label === label);
          const total = found?.total || 0;

          const f = hourFactor(label);
          const dmTarget = f === null ? 0 : dmH * f;
          const diff = total - dmTarget;
          const status = diff >= 0 ? "VƯỢT" : "THIẾU";

          return { label, total, dmTarget, diff, status };
        });

        hourly = { line: row.line, dmH, hours };
      }
    }
  }

  // debug
  const _debug = wantDebug
    ? {
        sheetName,
        range,
        dateRow,
        dailyHeaderRow,
        colHsDat,
        colHsDm,
        hourHeaderIdx,
        colDmH,
        hourCols: hourCols.slice(0, 20),
        sampleRow0: values[dateRow] || null,
        sampleNext: values[dateRow + 1] || null,
      }
    : undefined;

  return jsonNoStore({
    ok: true,
    chosenDate: date,
    lines,
    selectedLine,
    dailyRows,
    hourly,
    ...(wantDebug ? { _debug } : {}),
  });
}