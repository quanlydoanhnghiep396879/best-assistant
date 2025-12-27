// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "../../lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORK_HOURS = 8;
const DEFAULT_DAY_TARGET = 0.9;

// 8 mốc chuẩn
const MARKS = [
  { key: "->9h",    h: 1 },
  { key: "->10h",   h: 2 },
  { key: "->11h",   h: 3 },
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

function parseNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (s === "" || s === "-" || s.toUpperCase() === "N/A") return 0;

  // percent "95.87%" or "0.9587"
  s = s.replace("%", "").trim();

  // xử lý kiểu "1,08" => 1.08
  // nếu có cả "." và "," thì coi "," là thousand sep => remove ","
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parsePercent(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (s.includes("%")) {
    const n = parseNumber(s);
    return n / 100;
  }
  const n = parseNumber(s);
  // nếu user nhập 0.9587 thì OK, nếu nhập 95.87 thì coi là %
  if (n > 1.5) return n / 100;
  return n;
}

function findRangeForDate(configRows, date) {
  const row = configRows.find((r) => String(r.date).trim() === String(date).trim());
  return row?.range || "";
}

/** Tìm header row hợp lệ (có DM/H và có ít nhất 1 mốc ->9h) */
function findHeaderRowIndex(values) {
  for (let i = 0; i < Math.min(values.length, 15); i++) {
    const row = values[i] || [];
    const up = row.map((c) => stripAccents(c));
    const hasDMH = up.some((c) => c.includes("DM/H") || c === "H");
    const hasMark = up.some((c) => c.includes("->9H") || c.includes("→9H"));
    if (hasDMH && hasMark) return i;
  }
  return 0;
}

function findColIndexByIncludes(header, includesArr) {
  const H = header.map((c) => stripAccents(c));
  for (let i = 0; i < H.length; i++) {
    const cell = H[i];
    if (includesArr.every((kw) => cell.includes(kw))) return i;
  }
  return -1;
}

function findMarkCols(header) {
  const Hraw = header.map((c) => String(c || "").trim());
  const H = Hraw.map(stripAccents);

  const result = [];
  for (const m of MARKS) {
    const keyUp = stripAccents(m.key);
    let idx = H.findIndex((c) => c.includes(keyUp));
    // nếu sheet dùng mũi tên khác "→"
    if (idx < 0) {
      const alt = keyUp.replace("->", "→");
      idx = H.findIndex((c) => c.includes(alt));
    }
    result.push({ ...m, col: idx });
  }
  return result;
}

function parseKpi(values) {
  if (!values || values.length === 0) return { marks: MARKS, lines: [] };

  const headerRowIndex = findHeaderRowIndex(values);
  const header = values[headerRowIndex] || [];
  const dataRows = values.slice(headerRowIndex + 1);

  const colDMDay = findColIndexByIncludes(header, ["DM/NG"]);
  const colDMH = (() => {
    let idx = findColIndexByIncludes(header, ["DM/H"]);
    if (idx < 0) idx = header.map(stripAccents).findIndex((c) => c === "H");
    return idx;
  })();

  const colDayAch = findColIndexByIncludes(header, ["SUAT", "DAT", "TRONG"]);
  const colDayTarget = findColIndexByIncludes(header, ["DINH", "MUC", "TRONG"]);

  const markCols = findMarkCols(header);
  const latestMark = "->16h30";

  const lines = [];
  for (const r of dataRows) {
    if (!r) continue;

    const lineName = String(r[0] || "").trim();
    if (!lineName) break; // gặp dòng trống -> stop

    // parse dm
    const dmDay = colDMDay >= 0 ? parseNumber(r[colDMDay]) : 0;
    let dmH = colDMH >= 0 ? parseNumber(r[colDMH]) : 0;
    if (!dmH && dmDay) dmH = dmDay / WORK_HOURS;

    // actual cumulative by marks
    const actual = markCols.map((m) => {
      if (m.col < 0) return null; // không có cột
      const val = r[m.col];
      // nếu cell trống thì null, để status N/A
      const s = String(val ?? "").trim();
      if (s === "") return null;
      return parseNumber(val);
    });

    const expected = markCols.map((m) => (dmH ? dmH * m.h : 0));
    const delta = actual.map((a, i) => (a == null ? null : a - expected[i]));
    const status = actual.map((a, i) => {
      if (a == null) return "N/A";
      return delta[i] >= 0 ? "ĐỦ/VƯỢT" : "THIẾU";
    });

    const dayAch = colDayAch >= 0 ? parsePercent(r[colDayAch]) : null;
    const dayTarget = colDayTarget >= 0 ? parsePercent(r[colDayTarget]) : DEFAULT_DAY_TARGET;

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

  return { marks: markCols.map((m) => m.key), latestMark, lines };
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
