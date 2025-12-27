// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "../lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORK_HOURS = 8;
const DEFAULT_DAY_TARGET = 0.9;

const MARKS = [
  { key: "->9h", h: 1 },
  { key: "->10h", h: 2 },
  { key: "->11h", h: 3 },
  { key: "->12h30", h: 4 },
  { key: "->13h30", h: 5 },
  { key: "->14h30", h: 6 },
  { key: "->15h30", h: 7 },
  { key: "->16h30", h: 8 },
];

function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}
function normToken(s) {
  return stripAccents(s)
    .replace(/\s+/g, "")
    .replace(/[^\w>→\/]/g, "");
}

function parseNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (s === "" || s === "-" || s.toUpperCase() === "N/A") return 0;

  s = s.replace("%", "").trim();

  if (s.includes(".") && s.includes(",")) s = s.replace(/,/g, "");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parsePercent(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (s.includes("%")) return parseNumber(s) / 100;

  const n = parseNumber(s);
  if (!Number.isFinite(n)) return null;
  if (n > 1.5) return n / 100;
  return n;
}

function findRangeForDate(configRows, date) {
  const row = configRows.find(
    (r) => String(r.date).trim() === String(date).trim()
  );
  return row?.range || "";
}

function isLikelyDataRow(row0) {
  const t = stripAccents(row0).trim();
  if (!t) return false;
  if (t.includes("TOTAL") || t.includes("TONG")) return false;
  if (t.includes("LOAI")) return false;
  return true;
}

function findFirstMarkCol(values, limitRows = 25) {
  const maxR = Math.min(values.length, limitRows);

  // tìm cột có chứa ->9h ở bất kỳ dòng header nào
  const k1 = normToken("->9h");
  const k2 = k1.replace("->", "→");

  for (let r = 0; r < maxR; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normToken(row[c] || "");
      if (cell.includes(k1) || cell.includes(k2)) {
        return c;
      }
    }
  }
  return -1;
}

function findColByKeywords(values, keywords, limitRows = 25) {
  const maxR = Math.min(values.length, limitRows);
  for (let r = 0; r < maxR; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normToken(row[c] || "");
      if (keywords.every((k) => cell.includes(k))) return c;
    }
  }
  return -1;
}

function findMarkCols(values, limitRows = 25) {
  const maxR = Math.min(values.length, limitRows);

  const cols = MARKS.map(() => -1);

  for (let r = 0; r < maxR; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normToken(row[c] || "");
      MARKS.forEach((m, idx) => {
        const k1 = normToken(m.key);
        const k2 = k1.replace("->", "→");
        if (cols[idx] === -1 && (cell.includes(k1) || cell.includes(k2))) {
          cols[idx] = c;
        }
      });
    }
  }

  return MARKS.map((m, i) => ({ ...m, col: cols[i] }));
}

function parseKpi(values) {
  if (!values?.length) return { latestMark: "->16h30", lines: [] };

  const markCols = findMarkCols(values);
  const firstMarkCol = markCols
    .map((x) => x.col)
    .filter((c) => c >= 0)
    .sort((a, b) => a - b)[0] ?? findFirstMarkCol(values);

  // daily columns (tìm theo keyword trong mọi header)
  const colDayAch = findColByKeywords(values, ["SUAT", "DAT", "TRONG"]);
  const colDayTarget = findColByKeywords(values, ["DINH", "MUC", "TRONG"]);

  // DM cols: ưu tiên tìm bằng chữ, nếu fail thì suy ra theo firstMarkCol
  let colDMH = findColByKeywords(values, ["DM/H"]);
  if (colDMH < 0) colDMH = findColByKeywords(values, ["DM", "H"]);
  let colDMDay = findColByKeywords(values, ["DM/NG"]);
  if (colDMDay < 0) colDMDay = findColByKeywords(values, ["DM", "NGAY"]);

  if (firstMarkCol >= 0) {
    if (colDMH < 0) colDMH = firstMarkCol - 1;      // I
    if (colDMDay < 0) colDMDay = firstMarkCol - 2;  // H
  }

  // tìm dòng bắt đầu data: dòng đầu tiên có C1/C2... (cột A)
  let startRow = 0;
  for (let r = 0; r < Math.min(values.length, 30); r++) {
    const a = String((values[r] || [])[0] || "").trim();
    if (/^C\d+$/i.test(a) || a.toUpperCase() === "CẮT" || a.toUpperCase() === "KCS") {
      startRow = r;
      break;
    }
  }

  const lines = [];

  for (let r = startRow; r < values.length; r++) {
    const row = values[r] || [];
    const lineName = String(row[0] || "").trim();
    if (!lineName) continue;
    if (!isLikelyDataRow(lineName)) continue;

    const dmDay = colDMDay >= 0 ? parseNumber(row[colDMDay]) : 0;

    let dmH = colDMH >= 0 ? parseNumber(row[colDMH]) : 0;
    if (!dmH && dmDay) dmH = dmDay / WORK_HOURS;

    const actual = markCols.map((m) => {
      if (m.col < 0) return null;
      const cell = row[m.col];
      const s = String(cell ?? "").trim();
      if (s === "") return null;
      return parseNumber(cell);
    });

    const expected = markCols.map((m) => (dmH ? dmH * m.h : 0));
    const delta = actual.map((a, i) => (a == null ? null : a - expected[i]));

    const status = actual.map((a, i) => {
      if (a == null) return "N/A";
      const d = delta[i] ?? 0;
      if (d === 0) return "ĐỦ";
      if (d > 0) return "VƯỢT";
      return "THIẾU";
    });

    const dayAch = colDayAch >= 0 ? parsePercent(row[colDayAch]) : null;
    const dayTarget =
      colDayTarget >= 0 ? (parsePercent(row[colDayTarget]) ?? DEFAULT_DAY_TARGET) : DEFAULT_DAY_TARGET;

    let dayStatus = "CHƯA CÓ";
    if (dayAch != null) dayStatus = dayAch >= dayTarget ? "ĐẠT" : "KHÔNG ĐẠT";

    lines.push({
      line: lineName,
      dmDay,
      dmH,
      dayAch,
      dayTarget,
      dayStatus,
      marks: markCols.map((m, i) => ({
        mark: m.key,
        hourIndex: m.h,
        actual: actual[i],
        expected: expected[i],
        delta: delta[i],
        status: status[i],
      })),
    });
  }

  return { latestMark: "->16h30", lines };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json(
      { status: "error", message: "Thiếu query ?date=dd/mm/yyyy" },
      { status: 400 }
    );
  }

  try {
    const configRows = await readConfigRanges();
    const range = findRangeForDate(configRows, date);

    if (!range) {
      return NextResponse.json(
        { status: "error", message: `Không tìm thấy DATE=${date} trong CONFIG_KPI` },
        { status: 404 }
      );
    }

    const values = await readSheetRange(range, { valueRenderOption: "FORMATTED_VALUE" });
    const parsed = parseKpi(values);

    return NextResponse.json({
      status: "success",
      date,
      range,
      ...parsed,
    });
  } catch (err) {
    console.error("CHECK-KPI ERROR:", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
