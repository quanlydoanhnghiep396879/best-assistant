// app/api/check-kpi/route.js

import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ===================== helpers ===================== */
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Google/Excel serial date -> dd/mm/yyyy (base 1899-12-30)
function serialToDMY(n) {
  const base = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalize(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseDateCell(v) {
  // serial number
  if (typeof v === "number" && Number.isFinite(v)) return serialToDMY(v);

  const t = String(v || "").trim();
  if (!t) return "";

  // dd/mm/yyyy
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[1].padStart(2, "0")}/${m1[2].padStart(2, "0")}/${m1[3]}`;

  // yyyy-mm-dd
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[3]}/${m2[2]}/${m2[1]}`;
  // dd/mm (no year)
  const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${m3[1].padStart(2, "0")}/${m3[2].padStart(2, "0")}`;

  return t;
}

function toShortDM(dmy) {
  // dd/mm/yyyy -> dd/mm
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]}`;
  // already dd/mm
  const m2 = String(dmy || "").match(/^(\d{2})\/(\d{2})$/);
  if (m2) return `${m2[1]}/${m2[2]}`;
  return "";
}

function sortDatesDesc(a, b) {
  const pa = String(a).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const pb = String(b).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!pa || !pb) return String(b).localeCompare(String(a));
  const da = Date.parse(`${pa[3]}-${pa[2]}-${pa[1]}`);
  const db = Date.parse(`${pb[3]}-${pb[2]}-${pb[1]}`);
  return db - da;
}

/* ===================== line parsing ===================== */
// Convert various text forms to a "line id" like C1, C4+C5, CAT/KCS/HOAN TAT/NM...
function extractLineIdFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const n = normalize(raw);

  // Common departments
  if (/\bKCS\b/.test(n)) return "KCS";
  if (/\bCAT\b/.test(n)) return "CẮT";
  if (/\bHOAN\s*TAT\b/.test(n) || /\bHOAN\s*TAT\b/.test(n) || /\bHOAN\b/.test(n)) return "HOÀN TẤT";
  // NM / N.M
  if (/\bNM\b/.test(n)) return "NM";

  // Pattern like 088AG(C1) or N61ct(C4+C5) -> take inside (...)
  const mParen = n.match(/\((C\d+(?:\+C\d+)*)\)/);
  if (mParen && mParen[1]) return mParen[1];

  // Standalone C1 / C01 / C 1
  const mC = n.match(/\bC\s*0*(\d+)(?:\s*\+\s*C\s*0*(\d+))*\b/);
  if (mC) {
    // if it contains +C.., rebuild canonical string
    // easiest: extract all C\d occurrences
    const all = n.match(/C\s*0*\d+/g) || [];
    if (all.length) {
      const parts = all.map((x) => {
        const mm = x.match(/C\s*0*(\d+)/);
        return mm ? `C${mm[1]}` : "";
      }).filter(Boolean);
      return parts.join("+");
    }
    const one = mC[1];
    return one ? `C${Number(one)}` : "";
  }

  return "";
}

function extractLineIdFromRow(row) {
  // scan all cells; first match wins
  for (const cell of row || []) {
    const id = extractLineIdFromText(cell);
    if (id) return id;
  }
  return "";
}

/* ===================== block selection by date ===================== */
function rowHasChosenShortDM(row, chosenShortDM) {
  if (!chosenShortDM) return false;
  const want = chosenShortDM.trim();
  for (const cell of row || []) {
    const dmy = parseDateCell(cell);
    const sd = toShortDM(dmy);
    if (sd && sd === want) return true;

    // sometimes header is literally "24/12"
    const t = String(cell || "").trim();
    if (t === want) return true;
  }
  return false;
}

// find the header row (the row that contains DM/H and hour columns) for the chosen date block
function findHourlyTable(full, chosenShortDM) {
  let chosenHeaderRow = -1;

  // find candidate header rows
  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const normRow = row.map(normalize);

    const hasDMH = normRow.some(
      (x) => x === "DM/H" || x === "DMH" || x === "ĐM/H" || x === "DM / H"
    );
    const hasArrowHour = row.some((x) => {
      const t = String(x || "");
      return t.includes("->") && /h/i.test(t);
    });

    if (!hasDMH || !hasArrowHour) continue;

    // Check a few rows ABOVE this headerRow for the date like "24/12"
    let okDate = false;
    for (let up = Math.max(0, r - 6); up <= r; up++) {
      if (rowHasChosenShortDM(full[up] || [], chosenShortDM)) {
        okDate = true;
        break;
      }
    }

    // If matched date => select this block
    if (okDate) {
      chosenHeaderRow = r;
      break;
    }

    // fallback: if no chosenShortDM provided, take first
    if (!chosenShortDM && chosenHeaderRow < 0) chosenHeaderRow = r;
  }

  if (chosenHeaderRow < 0) return null;

  const headerRow = chosenHeaderRow;
  const row = full[headerRow] || [];
  const normRow = row.map(normalize);

  // locate important columns by scanning nearby rows for header names
  const scanHeaderRows = [];
  for (let rr = Math.max(0, headerRow - 3); rr <= headerRow + 1 && rr < full.length; rr++) {
    scanHeaderRows.push({ rr, row: full[rr] || [], norm: (full[rr] || []).map(normalize) });
  }

  function findColByHeader(patterns) {
    for (const item of scanHeaderRows) {
      for (let c = 0; c < item.norm.length; c++) {
        const x = item.norm[c] || "";
        if (patterns.some((p) => x.includes(p))) return c;
      }
    }
    return -1;
  }

  const dmDayCol = findColByHeader(["DM/NGAY", "DMNGAY", "ĐM/NGAY"]);
  const dmHCol = (() => {
    // DM/H appears on headerRow itself
    for (let c = 0; c < normRow.length; c++) {
      if (normRow[c] === "DM/H" || normRow[c] === "DMH" || normRow[c] === "ĐM/H") return c;
    }
    return -1;
  })();

  const maHangCol = findColByHeader(["MA HANG"]);
  const chungLoaiCol = findColByHeader(["CHUNG LOAI"]);
  const tgSxCol = findColByHeader(["TG SX", "TGSX"]);
  const suatDatCol = findColByHeader(["SUAT DAT TRONG NGAY", "SUAT DAT"]);

  // hour columns are on headerRow (the row containing "->9h" ... )
  const hourCols = [];
  for (let c = 0; c < row.length; c++) {
    const t = String(row[c] || "").trim();
    if (t.includes("->") && /h/i.test(t)) hourCols.push(c);
  }

  if (dmHCol < 0 || hourCols.length === 0) return null;

  const hourLabels = hourCols.map((c) => String((full[headerRow] || [])[c] || "").trim());

  return {
    headerRow,
    dmDayCol,
    dmHCol,
    hourCols,
    hourLabels,
    maHangCol,
    chungLoaiCol,
    tgSxCol,
    suatDatCol,
  };
}

/* ===================== build data (hourly + daily) ===================== */
function parsePercentCell(v) {
  const n = toNum(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // If sheet stores 0.9587 => 95.87%
  if (n > 0 && n <= 1) return n * 100;
  return n; // already 95.87
}

function buildFromKpiSheet(full, chosenShortDM) {
  const info = findHourlyTable(full, chosenShortDM);
  if (!info) {
    return { lines: [], byLine: {}, dailyRows: [] };
  }

  const {
    headerRow,
    dmDayCol,
    dmHCol,
    hourCols,
    hourLabels,
    maHangCol,
    chungLoaiCol,
    tgSxCol,
    suatDatCol,
  } = info;

  const byLine = {};
  const dailyRows = [];
  const lines = [];

  // data starts after headerRow
  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];

    // stop if next block header reached (another DM/H + ->h row)
    const norm = row.map(normalize);
    const isNextHeader =
      norm.some((x) => x === "DM/H" || x === "DMH" || x === "ĐM/H") &&
      row.some((x) => String(x || "").includes("->") && /h/i.test(String(x)));
    if (isNextHeader) break;

    // line id: scan whole row to catch 088AG(C1) etc.
    const lineId = extractLineIdFromRow(row);
    if (!lineId) {
      // If row is truly empty area, allow skipping a little; but if everything empty -> break
      const hasAny = row.some((x) => String(x || "").trim() !== "");
      if (!hasAny) break;
      continue;
    }

    // ignore totals lines that are not a line/department (but keep "TỔNG HỢP" we compute ourselves)
    if (normalize(lineId).includes("TONG HOP")) continue;

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;

    const hours = hourCols.map((c, idx) => {
      const actual = toNum(row[c]);
      const target = dmH > 0 ? dmH * (idx + 1) : 0;
      const diff = actual - target;

      let status = "CHƯA CÓ ĐM";
      if (dmH > 0) {
        if (actual === target) status = "ĐỦ";
        else if (actual > target) status = "VƯỢT";
        else status = "THIẾU";
      }

      return {
        label: hourLabels[idx] || `H${idx + 1}`,
        actual,
        target,
        diff,
        status,
      };
    });

    byLine[lineId] = { line: lineId, dmDay, dmH, hours };
    lines.push(lineId);

    // build daily row (for left table)
    const maHang = maHangCol >= 0 ? String(row[maHangCol] || "").trim() : "";
    const chungLoai = chungLoaiCol >= 0 ? String(row[chungLoaiCol] || "").trim() : "";

    // HS đạt: prefer sheet's "SUẤT ĐẠT TRONG NGÀY", fallback compute from last hour vs DM/ngày
    let hsDat = suatDatCol >= 0 ? parsePercentCell(row[suatDatCol]) : 0;
    if (!hsDat && dmDay > 0) {
      const lastActual = hours.length ? (hours[hours.length - 1].actual || 0) : 0;
      hsDat = (lastActual / dmDay) * 100;
    }

    const hsDm = 100; // you can change if you want another meaning
    let dailyStatus = "CHƯA CÓ";
    if (hsDat > 0) {
      if (hsDat >= 100) dailyStatus = "ĐẠT/VƯỢT";
      else dailyStatus = "CHƯA ĐẠT";
    }

    dailyRows.push({
      line: lineId,
      maHang,
      chungLoai,
      hsDat,
      hsDm,
      tgSx: tgSxCol >= 0 ? toNum(row[tgSxCol]) : 0,
      status: dailyStatus,
    });
  }

  // ===== Compute TỔNG HỢP =====
  if (lines.length) {
    const totalDmH = lines.reduce((s, ln) => s + (byLine[ln]?.dmH || 0), 0);
    const totalDmDay = lines.reduce((s, ln) => s + (byLine[ln]?.dmDay || 0), 0);

    const totalHours = (byLine[lines[0]]?.hours || []).map((_, idx) => {
      const actual = lines.reduce((s, ln) => s + (byLine[ln]?.hours?.[idx]?.actual || 0), 0);
      const target = totalDmH > 0 ? totalDmH * (idx + 1) : 0;
      const diff = actual - target;

      let status = "CHƯA CÓ ĐM";
      if (totalDmH > 0) {
        if (actual === target) status = "ĐỦ";
        else if (actual > target) status = "VƯỢT";
        else status = "THIẾU";
      }

      return {
        label: (byLine[lines[0]]?.hours?.[idx]?.label) || `H${idx + 1}`,
        actual,
        target,
        diff,
        status,
      };
    });

    byLine["TỔNG HỢP"] = { line: "TỔNG HỢP", dmDay: totalDmDay, dmH: totalDmH, hours: totalHours };

    // daily tổng hợp
    let hsDatTotal = 0;
    if (totalDmDay > 0 && totalHours.length) {
      const last = totalHours[totalHours.length - 1].actual || 0;
      hsDatTotal = (last / totalDmDay) * 100;
    }
    dailyRows.unshift({
      line: "TỔNG HỢP",
      maHang: "-",
      chungLoai: "-",
      hsDat: hsDatTotal,
      hsDm: 100,
      tgSx: 0,
      status: hsDatTotal >= 100 ? "ĐẠT/VƯỢT" : "CHƯA ĐẠT",
    });
  }

  return {
    byLine,
    lines: ["TỔNG HỢP", ...lines],
    dailyRows,
  };
}

/* ===================== read config dates ===================== */
async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();

  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, {
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const dates = rows.map((r) => parseDateCell(r?.[0])).filter(Boolean);
  dates.sort(sortDatesDesc);
  return dates;
}

/* ===================== API ===================== */
export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLine = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const { KPI_SHEET_NAME } = sheetNames();

    const dates = await readConfigDates();
    const chosenDate = parseDateCell(qDate) || dates[0] || "";
    const chosenShortDM = toShortDM(chosenDate);

    // read KPI big range
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const built = buildFromKpiSheet(full, chosenShortDM);

    const line = built.byLine[qLine] ? qLine : "TỔNG HỢP";
    const lineData = built.byLine[line] || { line, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines: built.lines,
      selectedLine: line,
      hourly: lineData,
      dailyRows: built.dailyRows, // <<< for "Hiệu suất trong ngày"
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}