
// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { readValues } from "../_lib/googleSheetsClient";

function norm(s) {
  return String(s || "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const HS_DINH_MUC = 90; // 90%

const MARKS = [
  { key: "->9h", h: 0.5 },
  { key: "->10h", h: 1.5 },
  { key: "->11h", h: 2.5 },
  { key: "->12h30", h: 4.0 },
  { key: "->13h30", h: 5.0 },
  { key: "->14h30", h: 6.0 },
  { key: "->15h30", h: 7.0 },
  { key: "->16h30", h: 8.0 },
];

function isLineName(x) {
  const s = norm(x);
  // C1..C20, CAT, KCS, HOANTAT, NM
  if (/^C\d+$/.test(s)) return true;
  if (s === "CAT" || s === "KCS" || s === "HOANTAT" || s === "NM") return true;
  return false;
}

function findHeaderIndex(values) {
  // tìm dòng có DM/NGAY hoặc DM/H
  const max = Math.min(values.length, 6);
  for (let i = 0; i < max; i++) {
    const row = values[i] || [];
    const joined = row.map(norm).join(" ");
    if (joined.includes("DM/NGAY") || joined.includes("DMNGAY") || joined.includes("DM/H") || joined.includes("DMH")) {
      return i;
    }
  }
  return 1; // fallback
}

function buildHeader(values, topIdx, subIdx) {
  const top = values[topIdx] || [];
  const sub = values[subIdx] || [];
  const cols = Math.max(top.length, sub.length);
  const headers = [];
  for (let c = 0; c < cols; c++) {
    const a = top[c] ?? "";
    const b = sub[c] ?? "";
    headers.push(norm(${a} ${b}));
  }
  return headers;
}

function findCol(headers, includesAny, fallback = -1) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (includesAny.some((k) => h.includes(k))) return i;
  }
  return fallback;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = (url.searchParams.get("date") || "").trim();
    if (!date) return NextResponse.json({ ok: false, error: "Missing date" }, { status: 400 });

    // đọc CONFIG_KPI để lấy range theo date
    const cfg = await readValues("CONFIG_KPI!A:B");
    const map = new Map();
    cfg.slice(1).forEach((r) => {
      if (r && r[0] && r[1]) map.set(String(r[0]).trim(), String(r[1]).trim());
    });

    const rangeA1 = map.get(date);
    if (!rangeA1) {
      return NextResponse.json({
        ok: true,
        date,
        rangeA1: null,
        lines: [],
        marks: MARKS.map((m) => m.key),
        debug: { reason: "No range found for date in CONFIG_KPI" },
      });
    }

    const values = await readValues(rangeA1);
    if (!values.length) {
      return NextResponse.json({
        ok: true,
        date,
        rangeA1,
        lines: [],
        marks: MARKS.map((m) => m.key),
        debug: { reason: "Range returns empty values (check share + sheetId + range)" },
      });
    }

    const headerSubIdx = findHeaderIndex(values);
    const headerTopIdx = Math.max(0, headerSubIdx - 1);
    const headers = buildHeader(values, headerTopIdx, headerSubIdx);
    const dataStart = headerSubIdx + 1;

    const colChuyen = findCol(headers, ["CHUYEN"], 0); // nếu không có label, lấy cột A
    const colMaHang = findCol(headers, ["MAHANG", "MH"], 5); // fallback cột F
    const colDmNgay = findCol(headers, ["DM/NGAY", "DMNGAY"], -1);
    const colDmH = findCol(headers, ["DM/H", "DMH"], -1);

    const markCols = {};
    for (const m of MARKS) {
      const k = norm(m.key);
      // chấp nhận ->9H, ->09H, v.v.
      const idx = headers.findIndex((h) => h.includes(k.replace("->", "")) || h.includes(k));
      markCols[m.key] = idx;
    }

    const lines = [];

    for (let r = dataStart; r < values.length; r++) {
      const row = values[r] || [];
      const chuyen = String(row[colChuyen] ?? "").trim();
      if (!chuyen) continue;
      if (!isLineName(chuyen)) continue;

      const maHangRaw = row[colMaHang] ?? "";
      const maHang = String(maHangRaw).trim() || "";

      const dmDay = colDmNgay >= 0 ? toNumberSafe(row[colDmNgay]) : 0;
      const dmHour = colDmH >= 0 ? toNumberSafe(row[colDmH]) : 0;

      const hourly = {};
      let lastActual = 0;

      for (const m of MARKS) {
        const idx = markCols[m.key];
        const actual = idx >= 0 ? toNumberSafe(row[idx]) : 0;
        lastActual = actual;

        const expected = dmDay > 0 ? (dmDay * (m.h / 8)) : 0; // chia theo 8h
        const diff = actual - expected;

        let status = "N/A";
        if (dmDay > 0) {
          if (actual > expected) status = "VƯỢT";
          else if (Math.abs(diff) < 1e-9) status = "ĐỦ";
          else status = "THIẾU";
        }

        hourly[m.key] = { actual, expected, diff, status };
      }

      const hsDat = dmDay > 0 ? (lastActual / dmDay) * 100 : null;
      let statusDay = "CHƯA CÓ";
      if (dmDay > 0 && hsDat !== null) statusDay = hsDat >= 100 ? "ĐẠT" : "CHƯA ĐẠT";

      lines.push({
        chuyen,
        maHang,
        dmDay,
        dmHour,
        hsDinhMuc: HS_DINH_MUC,
        hsDat,
        statusDay,
        hourly,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      rangeA1,
      marks: MARKS.map((m) => m.key),
      lines,
      debug: {
        headerTopIdx,
        headerSubIdx,
        dataStart,
        colChuyen,
        colMaHang,
        colDmNgay,
        colDmH,
        markCols,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e.message || String(e) },
      { status: 500 }
    );
  }
}
