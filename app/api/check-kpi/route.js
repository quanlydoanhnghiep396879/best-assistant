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

function parseDateCellFull(v) {
  if (isLikelySerialDate(v)) return serialToDMY(v);
  const t = String(v || "").trim();
  if (!t) return "";

  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[1].padStart(2, "0")}/${m1[2].padStart(2, "0")}/${m1[3]}`;

  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[3]}/${m2[2]}/${m2[1]}`;

  return "";
}

function toShortDM(dmy) {
  const s = String(dmy || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]}`;
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
    if (v >= 0 && v <= 1.5) return v * 100; // dạng 0.76 -> 76%
    return v; // dạng 76
  }

  const t = String(v).trim();
  if (!t) return 0;

  const cleaned = t.replace("%", "").replace(/,/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;

  if (n >= 0 && n <= 1.5 && !t.includes("%")) return n * 100;
  return n;
}

function roundInt(n) {
  n = Number(n);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/* ======== hour header detect ======== */
// nhận: "->9h", "→9h", ">9h", "9h", "12h30"
function isHourHeaderCell(x) {
  const t = String(x || "").trim();
  if (!t) return false;

  const okTime = /(\d{1,2}\s*h(\s*30)?)|(\d{1,2}h30)/i.test(t);
  if (!okTime) return false;

  const hasArrow = t.includes("->") || t.includes("→") || t.includes(">");

  return hasArrow || okTime;
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

/* =================== FIX RANGE =================== */

function rowHasDayHeaderSignal(row) {
  const joined = normalize((row || []).join(" "));
  return (
    joined.includes("LAO DONG") ||
    joined.includes("THONG KE") ||
    joined.includes("HIEU SUAT") ||
    joined.includes("MA HANG") ||
    joined.includes("CHUNG LOAI") ||
    joined.includes("DM/NGAY") ||
    joined.includes("DM/H")
  );
}

function findDateAnchorsFull(full) {
  const anchors = [];

  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];

    // chỉ quét A..F để tránh bắt nhầm date trong bảng khác
    for (let c = 0; c <= 5 && c < row.length; c++) {
      const dmyFull = parseDateCellFull(row[c]);
      if (dmyFull) {
        if (rowHasDayHeaderSignal(row)) {
          anchors.push({ row: r, dmy: dmyFull, short: toShortDM(dmyFull) });
        }
        break;
      }
    }
  }

  anchors.sort((a, b) => a.row - b.row);
  return anchors;
}

function getDayRangeByFullDate(full, chosenDateFull) {
  const anchors = findDateAnchorsFull(full);
  const idx = anchors.findIndex((a) => a.dmy === chosenDateFull);

  if (idx < 0) {
    return { start: 0, end: full.length - 1, anchorRow: -1, anchorsCount: anchors.length };
  }

  const start = anchors[idx].row;

  // tìm anchor kế tiếp nhưng phải cách >= 10 dòng
  let nextRow = null;
  for (let j = idx + 1; j < anchors.length; j++) {
    if (anchors[j].row >= start + 10) {
      nextRow = anchors[j].row;
      break;
    }
  }

  const end = nextRow !== null ? nextRow - 1 : full.length - 1;
  return { start, end, anchorRow: start, anchorsCount: anchors.length };
}

function findHourlyHeaderInRange(full, start, end) {
  for (let r = start; r <= end; r++) {
    const row = full[r] || [];
    const hourCols = getHourCols(row);

    if (hourCols.length >= 3) {
      const hourLabels = hourCols.map((c) => String(row[c] || "").trim());
      const firstHourCol = Math.min(...hourCols);
      const dmHCol = Math.max(0, firstHourCol - 1);
      const dmDayCol = Math.max(0, firstHourCol - 2);

      return { headerRow: r, hourCols, hourLabels, dmHCol, dmDayCol };
    }
  }
  return null;
}

/* ================= DAILY COL DETECT (NEW) ================= */

function findColByKeywords(full, start, end, keywords) {
  const keys = keywords.map(normalize);
  const counts = new Map(); // col -> hits

  for (let r = start; r <= end; r++) {
    const row = full[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normalize(row[c]);
      if (!cell) continue;
      if (keys.some((k) => cell.includes(k))) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }
  }

  let bestCol = -1;
  let bestHit = 0;
  for (const [col, hit] of counts.entries()) {
    if (hit > bestHit) {
      bestHit = hit;
      bestCol = col;
    }
  }
  return bestCol;
}

function buildHourlyData(full, chosenDateFull) {
  const range = getDayRangeByFullDate(full, chosenDateFull);
  const info = findHourlyHeaderInRange(full, range.start, range.end);

  if (!info) return { byLine: {}, lines: [], info: null, range };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  for (let r = headerRow + 1; r <= range.end; r++) {
    const row = full[r] || [];

    const dmH = roundInt(toNum(row[dmHCol]));
    const dmDay = dmDayCol >= 0 ? roundInt(toNum(row[dmDayCol])) : 0;

    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const line = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

    if (!hasAnyHour && dmH === 0 && dmDay === 0 && !line) break;
    if (!line) continue;

    const normLine = normalize(line);
    if (normLine.includes("TOTAL") || normLine.includes("TONG KIEM") || normLine.includes("TONG MAY")) continue;

    const hours = hourCols.map((c, idx) => {
      const actual = roundInt(toNum(row[c]));
      const target = dmH > 0 ? dmH * (idx + 1) : 0;
      const diff = actual - target;

      let status = "CHƯA CÓ ĐM";
      if (dmH > 0) status = actual === target ? "ĐỦ" : actual > target ? "VƯỢT" : "THIẾU";

      return { label: hourLabels[idx] || `H${idx + 1}`, actual, target, diff, status };
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
      if (totalDmH > 0) status = actual === target ? "ĐỦ" : actual > target ? "VƯỢT" : "THIẾU";

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

  return { byLine, lines: lines.length ? ["TỔNG HỢP", ...lines] : [], info, range, headerRow };
}

function buildDailyRowsSmart(full, range, headerRowForLines) {
  // tìm cột % theo keyword (bắt được header dọc/merge)
  const suatCol = findColByKeywords(full, range.start, range.end, [
    "SUẤT ĐẠT TRONG NGÀY",
    "SUAT DAT TRONG NGAY",
    "SUẤT ĐẠT",
    "SUAT DAT",
  ]);

  const dinhCol = findColByKeywords(full, range.start, range.end, [
    "ĐỊNH MỨC TRONG NGÀY",
    "DINH MUC TRONG NGAY",
    "ĐỊNH MỨC",
    "DINH MUC",
  ]);

  if (suatCol < 0 || dinhCol < 0) return [];

  const out = [];
  // đi theo block line giống hourly để chắc chắn lấy đúng dòng C1..C10
  for (let r = headerRowForLines + 1; r <= range.end; r++) {
    const row = full[r] || [];

    // line label nằm trước dmDay/dmH nên lấy bằng cách scan sớm
    const line = pickLineLabel(row, Math.min(suatCol, dinhCol));
    if (!line) continue;

    const normLine = normalize(line);
    if (!/^(TONG HOP|C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(normLine)) continue;

    const hsDat = toPercent(row[suatCol]);
    const hsDm = toPercent(row[dinhCol]);

    // nếu dòng không có % thì bỏ qua
    if (hsDat === 0 && hsDm === 0) continue;

    const status = hsDm > 0 && hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";

    out.push({
      line,
      hsDat: Math.round(hsDat * 100) / 100,
      hsDm: Math.round(hsDm * 100) / 100,
      status,
    });
  }

  return out;
}

/* ========= read dates config ========= */
async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();
  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, {
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const dates = rows.map((r) => parseDateCellFull(r?.[0]) || "").filter(Boolean);
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
    const chosenDateFull = parseDateCellFull(qDate) || dates[0] || "";

    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ5000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const hourlyAll = buildHourlyData(full, chosenDateFull);

    // ✅ dailyRows: dò cột % theo keyword (fix header dọc/merge)
    const dailyRows = hourlyAll.info
      ? buildDailyRowsSmart(full, hourlyAll.range, hourlyAll.headerRow)
      : [];

    const lines = hourlyAll.lines || [];
    const line = hourlyAll.byLine?.[qLine] ? qLine : "TỔNG HỢP";
    const lineData = hourlyAll.byLine?.[line] || { line, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate: chosenDateFull,
      dates,
      lines,
      selectedLine: line,
      dailyRows,
      hourly: lineData,
      _debug: {
        range: hourlyAll.range,
        foundHourlyHeader: !!hourlyAll.info,
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}