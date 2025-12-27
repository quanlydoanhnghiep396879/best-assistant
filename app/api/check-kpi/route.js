// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "../../lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORK_HOURS = 8;
const DEFAULT_DAY_TARGET = 0.9;

// 8 mốc chuẩn
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
    .replace(/[^\w>→\/]/g, ""); // giữ chữ, số, _, >, →, /
}

function parseNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (s === "" || s === "-" || s.toUpperCase() === "N/A") return 0;

  s = s.replace("%", "").trim();

  // "1,08" -> 1.08 ; "2,755" -> 2.755
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

  if (s.includes("%")) return parseNumber(s) / 100;

  const n = parseNumber(s);
  if (!Number.isFinite(n)) return null;
  // nếu user nhập 95.87 => coi là %
  if (n > 1.5) return n / 100;
  return n;
}

function findRangeForDate(configRows, date) {
  const row = configRows.find(
    (r) => String(r.date).trim() === String(date).trim()
  );
  return row?.range || "";
}

function getMaxCols(values, fromRow, toRow) {
  let max = 0;
  for (let i = fromRow; i <= toRow; i++) {
    const r = values[i] || [];
    max = Math.max(max, r.length);
  }
  return max;
}

/** Ghép header nhiều dòng (để bắt chữ ở ô merge) */
function buildCompositeHeader(values, baseIndex) {
  const from = Math.max(0, baseIndex - 2);
  const to = Math.min(values.length - 1, baseIndex + 2);
  const maxCols = getMaxCols(values, from, to);

  const header = Array.from({ length: maxCols }, (_, c) => {
    const parts = [];
    for (let r = from; r <= to; r++) {
      const cell = (values[r] || [])[c];
      const txt = String(cell || "").trim();
      if (txt) parts.push(txt);
    }
    return parts.join(" ").trim();
  });

  return header;
}

function headerHas(header, keywords) {
  const H = header.map(normToken);
  return H.some((cell) => keywords.every((k) => cell.includes(k)));
}

function scoreHeader(header) {
  const H = header.map(normToken);

  const hasMark = H.some((c) => c.includes(normToken("->9h")) || c.includes(normToken("→9h")));
  const hasDMH = H.some((c) => c.includes("DM/H") || (c.includes("DM") && c.includes("H")));
  const hasDMDay = H.some((c) => c.includes("DM/NG") || (c.includes("DM") && c.includes("NGAY")));
  const hasAch = H.some((c) => c.includes("SUAT") && c.includes("DAT") && c.includes("TRONG"));
  const hasTarget = H.some((c) => c.includes("DINH") && c.includes("MUC") && c.includes("TRONG"));

  let score = 0;
  if (hasMark) score += 4;
  if (hasDMH) score += 3;
  if (hasDMDay) score += 2;
  if (hasAch) score += 1;
  if (hasTarget) score += 1;
  return score;
}

/** Tìm index dòng header tốt nhất trong block đầu */
function findBestHeaderRow(values) {
  const limit = Math.min(values.length, 25);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < limit; i++) {
    const header = buildCompositeHeader(values, i);
    const sc = scoreHeader(header);
    if (sc > bestScore) {
      bestScore = sc;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function findColIndex(header, patterns) {
  // patterns: [ ["DM","NGAY"], ["DM/NG"] ... ]
  const H = header.map(normToken);
  for (let i = 0; i < H.length; i++) {
    const cell = H[i];
    for (const p of patterns) {
      if (p.every((kw) => cell.includes(kw))) return i;
    }
  }
  return -1;
}

function findMarkCols(header) {
  const H = header.map(normToken);
  return MARKS.map((m) => {
    const key1 = normToken(m.key);
    const key2 = key1.replace("->", "→"); // phòng trường hợp sheet dùng → thay ->
    const col = H.findIndex((c) => c.includes(key1) || c.includes(key2));
    return { ...m, col };
  });
}

function isLikelyDataRow(row0) {
  const t = stripAccents(row0).trim();
  if (!t) return false;
  // loại các dòng tổng / tiêu đề
  if (t.includes("TOTAL") || t.includes("TONG")) return false;
  if (t.includes("LOAI")) return false;
  return true;
}

function parseKpi(values) {
  if (!values || values.length === 0) return { marks: MARKS.map((m) => m.key), lines: [] };

  const headerRowIndex = findBestHeaderRow(values);
  const header = buildCompositeHeader(values, headerRowIndex);

  // tìm cột
  const colDMDay = findColIndex(header, [
    ["DM/NG"],          // DM/NGÀY
    ["DM", "NGAY"],     // DM NGÀY (không có dấu /)
    ["DMNGAY"],
  ]);

  const colDMH = findColIndex(header, [
    ["DM/H"],       // DM/H
    ["DM", "H"],    // DM H
    ["DMH"],
  ]);

  const colDayAch = findColIndex(header, [
    ["SUAT", "DAT", "TRONG"], // SUẤT ĐẠT TRONG ...
  ]);

  const colDayTarget = findColIndex(header, [
    ["DINH", "MUC", "TRONG"], // ĐỊNH MỨC TRONG ...
  ]);

  const markCols = findMarkCols(header);
  const latestMark = "->16h30";

  // data rows: bắt đầu sau headerRowIndex, nhưng bỏ qua các dòng không phải data
  const lines = [];
  for (let r = headerRowIndex + 1; r < values.length; r++) {
    const row = values[r] || [];
    const lineName = String(row[0] || "").trim();

    if (!lineName) continue;
    if (!isLikelyDataRow(lineName)) continue;

    // nếu gặp dòng trống kéo dài hoặc hết block data thì break theo thực tế sheet
    // (nếu bạn muốn chặt hơn thì đổi logic break)
    // Ở đây: nếu lineName là số/nhãn lạ vẫn parse được.

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
