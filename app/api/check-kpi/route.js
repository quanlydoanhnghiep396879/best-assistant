// app/api/check-kpi/route.js

import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ================= helpers ================= */

function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalize(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// serial date -> dd/mm/yyyy
function serialToDMY(n) {
  const base = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isLikelySerialDate(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 30000 && n <= 70000;
}

function parseDateCell(v) {
  if (isLikelySerialDate(v)) return serialToDMY(v);

  const t = String(v || "").trim();
  if (!t) return "";

  // dd/mm/yyyy
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[1].padStart(2, "0")}/${m1[2].padStart(2, "0")}/${m1[3]}`;

  // yyyy-mm-dd
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[3]}/${m2[2]}/${m2[1]}`;

  // dd/mm
  const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${m3[1].padStart(2, "0")}/${m3[2].padStart(2, "0")}`;

  return "";
}

function toShortDM(dmy) {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]}`;
  const m2 = s.match(/^(\d{2})\/(\d{2})$/);
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

function toPercent(v) {
  if (v === null || v === undefined) return 0;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0;
    if (v >= 0 && v <= 1.5) return v * 100; // 0.95 => 95
    return v;
  }

  const t = String(v).trim();
  if (!t) return 0;

  const cleaned = t.replace("%", "").replace(/,/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;

  if (n >= 0 && n <= 1.5 && !t.includes("%")) return n * 100;
  return n;
}

/* ========== FIX: nhận cả "->9h" và "→9h" ========== */
function isHourHeaderCell(x) {
  const t = String(x || "").trim();
  if (!t) return false;
  const hasArrow = t.includes("->") || t.includes("→");
  return hasArrow && /h/i.test(t);
}

function getHourCols(row) {
  const cols = [];
  for (let c = 0; c < row.length; c++) {
    if (isHourHeaderCell(row[c])) cols.push(c);
  }
  return cols;
}

function pickLineLabel(row, beforeCol) {
  for (let c = 0; c < beforeCol; c++) {
    const t = String(row[c] || "").trim();
    if (!t) continue;
    const n = normalize(t);
    if (/^(TONG HOP|C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(n)) return t;
  }
  const t0 = String(row[0] || "").trim();
  return t0 || "";
}

/* =================== FIX CHÍNH: cắt vùng theo ngày =================== */

// tìm tất cả "mốc ngày" trong sheet (row nào có cell là date)
function findDateAnchors(full) {
  const anchors = [];
  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    for (let c = 0; c < row.length; c++) {
      const dmy = parseDateCell(row[c]);
      if (dmy) {
        anchors.push({ row: r, dmy, short: toShortDM(dmy) });
        break;
      }
    }
  }
  // bỏ trùng (cùng short, lấy mốc xuất hiện đầu tiên)
  const seen = new Set();
  const out = [];
  for (const a of anchors) {
    const k = `${a.short}@${a.row}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  // sort theo row
  out.sort((a, b) => a.row - b.row);
  return out;
}

// lấy range row [start..end] thuộc đúng ngày đang chọn
function getDayRange(full, chosenDate) {
  const chosenShort = toShortDM(chosenDate);
  const anchors = findDateAnchors(full);

  // tìm anchor có short đúng ngày
  const idx = anchors.findIndex((a) => a.short === chosenShort);
  if (idx < 0) {
    // fallback: cả sheet
    return { start: 0, end: full.length - 1, chosenShort, anchorRow: -1 };
  }

  const start = anchors[idx].row;
  const end = idx + 1 < anchors.length ? anchors[idx + 1].row - 1 : full.length - 1;

  return { start, end, chosenShort, anchorRow: anchors[idx].row };
}

// tìm header bảng giờ trong vùng ngày
function findHourlyHeaderInRange(full, start, end) {
  for (let r = start; r <= end; r++) {
    const row = full[r] || [];
    const hourCols = getHourCols(row);
    if (hourCols.length >= 2) {
      const hourLabels = hourCols.map((c) => String(row[c] || "").trim());
      const firstHourCol = Math.min(...hourCols);
      const dmHCol = Math.max(0, firstHourCol - 1);
      const dmDayCol = Math.max(0, firstHourCol - 2);

      return { headerRow: r, hourCols, hourLabels, dmHCol, dmDayCol };
    }
  }
  return null;
}

function buildHourlyData(full, chosenDate) {
  const range = getDayRange(full, chosenDate);
  const info = findHourlyHeaderInRange(full, range.start, range.end);
  if (!info) return { byLine: {}, lines: [], info: null, range };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  for (let r = headerRow + 1; r <= range.end; r++) {
    const row = full[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;

    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const line = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

    // ra khỏi khối
    if (!hasAnyHour && dmH === 0 && dmDay === 0 && !line) break;
    if (!line) continue;

    const normLine = normalize(line);
    if (normLine.includes("TOTAL") || normLine.includes("TONG KIEM") || normLine.includes("TONG MAY")) continue;

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

      return { label: hourLabels[idx] || `H${idx + 1}, actual, target, diff, status` };
    });

    byLine[line] = { line, dmDay, dmH, hours };
    lines.push(line);
  }

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
  }

  return { byLine, lines: lines.length ? ["TỔNG HỢP", ...lines] : [], info, range };
}

/* ========= FIX: tìm mềm header bảng % =========
   Chỉ cần có "SUAT DAT" & "DINH MUC" là nhận
*/
function findDailyPerfHeaderInRange(full, start, end) {
  let best = null;
  for (let r = start; r <= end; r++) {
    const row = full[r] || [];
    const norm = row.map(normalize);

    const suatCol = norm.findIndex((x) => x.includes("SUAT DAT"));
    const dinhCol = norm.findIndex((x) => x.includes("DINH MUC"));

    if (suatCol >= 0 && dinhCol >= 0) {
      best = { headerRow: r, suatCol, dinhCol };
      break;
    }
  }
  return best;
}

function buildDailyRowsFromSheet(full, hourlyPack, chosenDate) {
  const range = hourlyPack?.range || getDayRange(full, chosenDate);
  const header = findDailyPerfHeaderInRange(full, range.start, range.end);
  if (!header) return [];

  const { headerRow, suatCol, dinhCol } = header;
  const beforeCol = Math.min(suatCol, dinhCol);

  const out = [];

  for (let r = headerRow + 1; r <= range.end; r++) {
    const row = full[r] || [];
    const line = pickLineLabel(row, beforeCol);

    const rawA = String(row[suatCol] ?? "").trim();
    const rawB = String(row[dinhCol] ?? "").trim();

    if (!rawA && !rawB && !line) break;
    if (!line) continue;

    const normLine = normalize(line);
    if (!/^(TONG HOP|C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(normLine)) continue;

    const hsDat = toPercent(row[suatCol]);
    const hsDm = toPercent(row[dinhCol]);

    const status = hsDm > 0 && hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";

    out.push({
      line,
      hsDat: Number.isFinite(hsDat) ? hsDat : 0,
      hsDm: Number.isFinite(hsDm) ? hsDm : 0,
      status,
    });
  }

  return out;
}

/* ========= đọc dates từ CONFIG_KPI ========= */
async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();
  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, {
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const dates = rows.map((r) => parseDateCell(r?.[0])).filter(Boolean);
  dates.sort(sortDatesDesc);
  return dates;
}

/* ================= API ================= */

export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLine = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const { KPI_SHEET_NAME } = sheetNames();

    const dates = await readConfigDates();
    const chosenDate = parseDateCell(qDate) || dates[0] || "";

    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ5000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const hourlyAll = buildHourlyData(full, chosenDate);
    const dailyRows = buildDailyRowsFromSheet(full, hourlyAll, chosenDate);

    const lines = hourlyAll.lines || [];
    const line = hourlyAll.byLine?.[qLine] ? qLine : "TỔNG HỢP";
    const lineData = hourlyAll.byLine?.[line] || { line, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines,
      selectedLine: line,
      dailyRows,
      hourly: lineData,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}