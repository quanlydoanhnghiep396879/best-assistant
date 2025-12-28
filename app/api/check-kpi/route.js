import { NextResponse } from "next/server";
import { readSheetRange } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];

function norm(s) {
  let x = (s ?? "").toString().trim();
  if (!x) return "";
  x = x.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  x = x.replace(/đ/g, "d").replace(/Đ/g, "D");
  x = x.replace(/\s+/g, " ");
  return x.toUpperCase();
}

function toNum(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || s === "—" || s === "-" || s === "N/A") return null;

  // percent
  if (s.includes("%")) {
    s = s.replace("%", "").trim();
    s = s.replace(/\s+/g, "");
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n / 100 : null;
  }

  s = s.replace(/\s+/g, "");
  // VN: 1,08 => 1.08 ; 1.234,5 => 1234.5
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isLineName(x) {
  const s = norm(x);
  return /^(C\d+|CAT|KCS|HOAN TAT|NM)$/.test(s);
}

function findBestHeaderRow(values) {
  // chọn row có nhiều keyword nhất
  let best = 0;
  let bestScore = -1;

  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const cells = row.map(norm);

    let score = 0;
    if (cells.some((c) => c.includes("CHUYEN") || c.includes("CHUYỀN"))) score += 2;
    if (cells.some((c) => c.includes("DM/NGAY") || c.includes("DM NGAY") || c.includes("ĐM/NGÀY"))) score += 3;
    if (cells.some((c) => c.includes("DM/H") || c === "H")) score += 3;
    if (cells.some((c) => c.includes("SUAT") || c.includes("HIEU SUAT") || c.includes("HS"))) score += 2;
    if (cells.some((c) => MARKS.map(norm).includes(c))) score += 4;

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function findCol(values, headerRow, regex) {
  // scan 2 hàng: headerRow và headerRow+1 (vì sheet hay merge)
  const rows = [values[headerRow] || [], values[headerRow + 1] || []];

  for (let rr = 0; rr < rows.length; rr++) {
    const row = rows[rr];
    for (let c = 0; c < row.length; c++) {
      const cell = norm(row[c]);
      if (regex.test(cell)) return c;
    }
  }
  return -1;
}

function findMarkCols(values, headerRow) {
  const cols = {};
  for (const m of MARKS) {
    const mm = norm(m);
    let found = -1;
    for (const r of [headerRow, headerRow + 1]) {
      const row = values[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (norm(row[c]) === mm) {
          found = c;
          break;
        }
      }
      if (found !== -1) break;
    }
    cols[m] = found;
  }
  return cols;
}

function findStartRow(values, afterRow, colLineGuess) {
  // tìm dòng đầu tiên có C1/C2... ở cột gần colLineGuess nhất
  for (let r = afterRow; r < values.length; r++) {
    const row = values[r] || [];
    // ưu tiên cột đoán
    if (colLineGuess >= 0 && isLineName(row[colLineGuess])) return r;

    // fallback: quét vài cột đầu
    for (let c = 0; c < Math.min(row.length, 6); c++) {
      if (isLineName(row[c])) return r;
    }
  }
  return afterRow + 1;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim();
    if (!date) return NextResponse.json({ message: "Missing date" }, { status: 400 });

    // đọc config để lấy RANGE theo date
    const cfg = await readSheetRange("CONFIG_KPI!A2:B");
    const map = new Map(
      cfg
        .map((r) => [(r?.[0] || "").toString().trim(), (r?.[1] || "").toString().trim()])
        .filter(([d, range]) => d && range)
    );

    const rangeA1 = map.get(date);
    if (!rangeA1) return NextResponse.json({ message: `Không tìm thấy RANGE cho ngày: ${date}` }, { status: 400 });

    const values = await readSheetRange(rangeA1);

    // ===== detect header + columns =====
    const headerRow = findBestHeaderRow(values);

    const colLine = findCol(values, headerRow, /CHUYEN|CHUYỀN/);
    const colDmDay = findCol(values, headerRow, /DM\/NGAY|DM NGAY|ĐM\/NGÀY|ĐM NGÀY/);
    const colDmHour = findCol(values, headerRow, /DM\/H|ĐM\/H|DMH|^H$/);

    const colHsDay = findCol(values, headerRow, /SUAT DAT TRONG|HIEU SUAT TRONG NGAY|HS DAT TRONG NGAY/);
    const colHsTarget = findCol(values, headerRow, /DINH MUC TRONG|HS DINH MUC|SUAT DINH MUC/);

    const markCols = findMarkCols(values, headerRow);

    const startRow = findStartRow(values, headerRow + 1, colLine);

    // ===== parse rows =====
    const lines = [];

    for (let r = startRow; r < values.length; r++) {
      const row = values[r] || [];
      const lineCell = colLine >= 0 ? row[colLine] : row[0];

      if (!lineCell && r > startRow) break; // hết bảng
      if (!isLineName(lineCell)) continue;  // bỏ dòng không phải chuyền

      const line = norm(lineCell).replace("CAT", "CÁT").replace("HOAN TAT", "HOÀN TẤT");

      const dmDay = colDmDay >= 0 ? toNum(row[colDmDay]) : null;
      const dmHour = colDmHour >= 0 ? toNum(row[colDmHour]) : null;

      // lũy tiến theo giờ
      const hourly = {};
      for (const m of MARKS) {
        const c = markCols[m];
        hourly[m] = c >= 0 ? toNum(row[c]) : null;
      }

      // hiệu suất ngày (nếu có)
      const hsDay = colHsDay >= 0 ? toNum(row[colHsDay]) : null;
      const hsTarget = colHsTarget >= 0 ? toNum(row[colHsTarget]) : 0.9;

      // status HS
      let hsStatus = "CHƯA CÓ";
      if (typeof hsDay === "number" && isFinite(hsDay)) {
        hsStatus = hsDay >= (hsTarget || 0.9) ? "ĐẠT" : "CHƯA ĐẠT";
      }

      lines.push({
        line,
        dmDay: typeof dmDay === "number" ? dmDay : null,
        dmHour: typeof dmHour === "number" ? dmHour : null,
        hourly,
        hsDay: typeof hsDay === "number" ? hsDay : null,
        hsTarget: typeof hsTarget === "number" ? hsTarget : 0.9,
        hsStatus,
      });
    }

    return NextResponse.json(
      {
        date,
        range: rangeA1,
        meta: {
          headerRow,
          startRow,
          colLine,
          colDmDay,
          colDmHour,
          colHsDay,
          colHsTarget,
          markCols,
        },
        lines,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ message: e?.message || String(e) }, { status: 500 });
  }
}
