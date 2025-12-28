import { NextResponse } from "next/server";
import { readSheetRange } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];
const MARK_HOURS = {
  "->9h": 1,
  "->10h": 2,
  "->11h": 3,
  "->12h30": 4.5,
  "->13h30": 5.5,
  "->14h30": 6.5,
  "->15h30": 7.5,
  "->16h30": 8.5,
};

function norm(s) {
  let x = (s ?? "").toString().trim();
  if (!x) return "";
  x = x.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  x = x.replace(/đ/g, "d").replace(/Đ/g, "D");
  x = x.replace(/\s+/g, " ");
  return x.toUpperCase();
}
function keyOf(s) {
  return norm(s).replace(/[^A-Z0-9]/g, "");
}
function toNum(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || s === "—" || s === "-" || s === "N/A") return null;

  if (s.includes("%")) {
    s = s.replace("%", "").trim().replace(/\s+/g, "");
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n / 100 : null;
  }

  s = s.replace(/\s+/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isLineName(x) {
  const s = norm(x);
  return /^(C\d+|CAT|KCS|HOAN TAT|NM)$/.test(s);
}
function prettyLine(x) {
  const s = norm(x);
  if (s === "CAT") return "CÁT";
  if (s === "HOAN TAT") return "HOÀN TẤT";
  return s;
}

function forwardFillRow(row) {
  const out = [...(row || [])];
  let last = "";
  for (let i = 0; i < out.length; i++) {
    const v = (out[i] ?? "").toString().trim();
    if (v) last = v;
    else if (last) out[i] = last;
  }
  return out;
}

function findRowHavingMarks(values) {
  const scan = Math.min(values.length, 12);
  for (let r = 0; r < scan; r++) {
    const row = forwardFillRow(values[r] || []);
    const set = new Set(row.map((c) => norm(c)));
    let hit = 0;
    for (const m of MARKS) if (set.has(norm(m))) hit++;
    if (hit >= 3) return r;
  }
  return -1;
}

function buildHeaderTexts(values, r) {
  const r0 = Math.max(0, r - 1);
  const r1 = r;
  const r2 = Math.min(values.length - 1, r + 1);

  const a = forwardFillRow(values[r0] || []);
  const b = forwardFillRow(values[r1] || []);
  const c = forwardFillRow(values[r2] || []);

  const maxCol = Math.max(a.length, b.length, c.length);
  const headers = Array(maxCol).fill("");

  for (let i = 0; i < maxCol; i++) {
    const parts = [];
    if ((a[i] ?? "").toString().trim()) parts.push(a[i]);
    if ((b[i] ?? "").toString().trim()) parts.push(b[i]);
    if ((c[i] ?? "").toString().trim()) parts.push(c[i]);
    headers[i] = keyOf(parts.join(" "));
  }
  return headers;
}

function findCol(headers, includesAnyKeys) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] || "";
    for (const k of includesAnyKeys) {
      if (h.includes(k)) return i;
    }
  }
  return -1;
}

function statusFromDiff(diff, tol = 0.5) {
  if (diff === null) return "N/A";
  if (Math.abs(diff) <= tol) return "ĐỦ";
  if (diff > tol) return "VƯỢT";
  return "THIẾU";
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim();
    if (!date) return NextResponse.json({ message: "Missing date" }, { status: 400 });

    // CONFIG_KPI: A=DATE, B=RANGE
    const cfg = await readSheetRange("CONFIG_KPI!A2:B");
    const map = new Map(
      cfg
        .map((r) => [(r?.[0] || "").toString().trim(), (r?.[1] || "").toString().trim()])
        .filter(([d, range]) => d && range)
    );

    const rangeA1 = map.get(date);
    if (!rangeA1) {
      return NextResponse.json({ message: `Không tìm thấy RANGE cho ngày: ${date}` }, { status: 400 });
    }

    const values = await readSheetRange(rangeA1);
    if (!values?.length) return NextResponse.json({ message: "Range rỗng" }, { status: 400 });

    const rHeader = findRowHavingMarks(values);
    if (rHeader < 0) {
      return NextResponse.json(
        { message: "Không tìm thấy dòng header chứa các mốc (->9h, ->10h...). Hãy chắc RANGE bao trùm đúng header." },
        { status: 400 }
      );
    }

    const headers = buildHeaderTexts(values, rHeader);

    const colLine = findCol(headers, ["CHUYEN"]);
    const colDmDay = findCol(headers, ["DMNGAY"]);
    const colDmHour = findCol(headers, ["DMH"]);

    // ✅ thêm cột MÃ HÀNG + CHỦNG LOẠI theo header
    const colMaHang = findCol(headers, ["MAHANG"]);
    const colChungLoai = findCol(headers, ["CHUNGLOAI"]);

    const markCols = {};
    for (const m of MARKS) {
      const mk = keyOf(m); // ->9h => 9H
      markCols[m] = findCol(headers, [mk]);
    }

    if (colLine < 0) {
      return NextResponse.json({ message: "Không tìm thấy cột CHUYỀN trong header." }, { status: 400 });
    }
    if (colDmDay < 0 || colDmHour < 0) {
      return NextResponse.json(
        { message: "Không tìm thấy cột ĐM/NGÀY hoặc ĐM/H theo header.", debug: { colDmDay, colDmHour, rHeader } },
        { status: 400 }
      );
    }

    // data rows
    const dataRows = [];
    for (let r = rHeader + 1; r < values.length; r++) {
      const row = values[r] || [];
      if (isLineName(row[colLine])) dataRows.push(r);
    }

    const lines = [];
    const hsTarget = 0.9;

    // ✅ khử trùng chuyền bị lặp (NM thường bị 2 dòng)
    const seen = new Set();

    for (const r of dataRows) {
      const row = values[r] || [];
      const line = prettyLine(row[colLine]);
      if (seen.has(line)) continue;
      seen.add(line);

      const maHang = colMaHang >= 0 ? (row[colMaHang] ?? "").toString().trim() : "";
      const chungLoai = colChungLoai >= 0 ? (row[colChungLoai] ?? "").toString().trim() : "";

      const dmDay = toNum(row[colDmDay]);
      const dmHour = toNum(row[colDmHour]);

      const hourly = {};
      const dmCum = {};
      const diff = {};
      const status = {};

      for (const m of MARKS) {
        const c = markCols[m];
        hourly[m] = c >= 0 ? toNum(row[c]) : null;

        dmCum[m] =
          typeof dmHour === "number" && MARK_HOURS[m] ? dmHour * MARK_HOURS[m] : null;

        diff[m] =
          typeof hourly[m] === "number" && typeof dmCum[m] === "number" ? hourly[m] - dmCum[m] : null;

        status[m] = statusFromDiff(diff[m]);
      }

      const last = hourly["->16h30"];
      const hsDay =
        typeof last === "number" && typeof dmDay === "number" && dmDay !== 0 ? last / dmDay : null;

      const hsStatus = hsDay === null ? "CHƯA CÓ" : hsDay >= hsTarget ? "ĐẠT" : "CHƯA ĐẠT";

      lines.push({
        line,
        maHang,
        chungLoai,
        dmDay: typeof dmDay === "number" ? dmDay : null,
        dmHour: typeof dmHour === "number" ? dmHour : null,
        hourly,
        dmCum,
        diff,
        status,
        hsDay,
        hsTarget,
        hsStatus,
      });
    }

    return NextResponse.json(
      {
        date,
        range: rangeA1,
        meta: { rHeader, colLine, colDmDay, colDmHour, colMaHang, colChungLoai, markCols, lineCount: lines.length },
        lines,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ message: e?.message || String(e) }, { status: 500 });
  }
}
