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

// tránh 430/487 bị coi là serial date
function isLikelySerialDate(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 30000 && n <= 70000;
}

function parseDateCell(v) {
  if (isLikelySerialDate(v)) return serialToDMY(v);

  const t = String(v || "").trim();
  if (!t) return "";

  // dd/mm/yyyy
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);``
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

// number/string -> percent 0..100
function toPercent(v) {
  if (v === null || v === undefined) return 0;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0;
    // 0.9587 => 95.87
    if (v >= 0 && v <= 1.5) return v * 100;
    return v;
  }

  const t = String(v).trim();
  if (!t) return 0;

  // "95.87%" => 95.87
  const cleaned = t.replace("%", "").replace(/,/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;

  // "0.9587" => 95.87
  if (n >= 0 && n <= 1.5 && !t.includes("%")) return n * 100;
  return n;
}

/* ========= tìm cột giờ ========= */
function getHourCols(row) {
  const cols = [];
  for (let c = 0; c < row.length; c++) {
    const t = String(row[c] || "").trim();
    if (t.includes("->") && /h/i.test(t)) cols.push(c);
  }
  return cols;
}

function findAllHourlyHeaders(full) {
  const headers = [];
  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const hourCols = getHourCols(row);
    if (hourCols.length >= 2) headers.push({ headerRow: r, hourCols });
  }
  return headers;
}

/* ====== điểm mấu chốt FIX LỖI NGÀY: lấy "ngày gần nhất phía trên" (date đầu tiên gặp khi đi lên) ====== */
function closestDateAbove(full, fromRow, maxUp = 200) {
  const start = Math.max(0, fromRow - maxUp);
  for (let r = fromRow; r >= start; r--) {
    const row = full[r] || [];
    for (let c = 0; c < row.length; c++) {
      const d = parseDateCell(row[c]);
      if (d) return { row: r, dmy: d, short: toShortDM(d) };
    }
  }
  return null;
}

function selectHourlyTableByDate(full, chosenDate) {
  const chosenShort = toShortDM(chosenDate);
  const candidates = findAllHourlyHeaders(full);
  if (!candidates.length) return null;

  let best = null;
  let bestDist = Infinity;

  for (const cand of candidates) {
    const near = closestDateAbove(full, cand.headerRow, 200);
    if (!near) continue;

    // chỉ nhận đúng ngày (dd/mm)
    if (near.short !== chosenShort) continue;

    const dist = cand.headerRow - near.row; // càng nhỏ càng đúng khối
    if (dist < bestDist) {
      bestDist = dist;
      best = { ...cand, dateRow: near.row };
    }
  }

  // nếu không match được, fallback lấy bảng đầu tiên để không trả trống
  if (!best) best = { ...candidates[0], dateRow: -1 };

  const { headerRow, hourCols } = best;
  const firstHourCol = Math.min(...hourCols);

  // dmHCol = cột ngay trước giờ đầu tiên (sheet bạn đang ghi "H" chứ không phải "DM/H")
  const dmHCol = Math.max(0, firstHourCol - 1);
  const dmDayCol = Math.max(0, firstHourCol - 2);

  const hourLabels = hourCols.map((c) => String((full[headerRow] || [])[c] || "").trim());

  return { headerRow, hourCols, hourLabels, dmHCol, dmDayCol, dateRow: best.dateRow };
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

function buildHourlyData(full, chosenDate) {
  const info = selectHourlyTableByDate(full, chosenDate);
  if (!info) return { byLine: {}, lines: [], info: null };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;

    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const line = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

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

  return { byLine, lines: lines.length ? ["TỔNG HỢP", ...lines] : [], info };
}

/* ========= parse bảng %: "SUẤT ĐẠT TRỌNG" & "ĐỊNH MỨC TRỌNG" ========= */
function findDailyPerfTableNear(full, aroundRow) {
  const r0 = Math.max(0, aroundRow - 250);
  const r1 = Math.min(full.length - 1, aroundRow + 250);

  let best = null;
  let bestDist = Infinity;

  for (let r = r0; r <= r1; r++) {
    const row = full[r] || [];
    const norm = row.map(normalize);

    const suatCol = norm.findIndex((x) => x.includes("SUAT DAT TRONG"));
    const dinhCol = norm.findIndex((x) => x.includes("DINH MUC TRONG"));

    if (suatCol >= 0 && dinhCol >= 0) {
      const dist = Math.abs(r - aroundRow);
      if (dist < bestDist) {
        bestDist = dist;
        best = { headerRow: r, suatCol, dinhCol };
      }
    }
  }

  return best; // {headerRow, suatCol, dinhCol} | null
}

function buildDailyRowsFromSheet(full, hourlyInfo, chosenDate) {
  if (!hourlyInfo?.info) return [];

  const aroundRow = hourlyInfo.info.headerRow ?? 0;

  // đảm bảo đúng ngày: chỉ lấy daily table trong cùng “khối ngày”
  // vì selectHourlyTableByDate đã chọn đúng khối theo chosenDate rồi, nên aroundRow đã thuộc đúng ngày
  const t = findDailyPerfTableNear(full, aroundRow);
  if (!t) return [];

  const { headerRow, suatCol, dinhCol } = t;
  const beforeCol = Math.min(suatCol, dinhCol);

  const out = [];

  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];
    const line = pickLineLabel(row, beforeCol);
    const hsDat = toPercent(row[suatCol]);
    const hsDm = toPercent(row[dinhCol]);

    const any = String(row[suatCol] || "").trim() || String(row[dinhCol] || "").trim();
    if (!any && !line) break;

    if (!line) continue;

    const normLine = normalize(line);
    if (!/^(TONG HOP|C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(normLine)) continue;

    const status = hsDat >= hsDm && hsDm > 0 ? "ĐẠT" : "CHƯA ĐẠT";

    out.push({
      line,
      hsDat: Number.isFinite(hsDat) ? hsDat : 0,
      hsDm: Number.isFinite(hsDm) ? hsDm : 0,
      status,
    });
  }

  // nếu không có TỔNG HỢP trong bảng thì mình vẫn giữ TỔNG HỢP từ hourly lines
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

    // nếu sheet dài hơn 2000 dòng thì tăng lên 5000 cho chắc
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ5000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    // 1) hourly đúng ngày
    const hourlyAll = buildHourlyData(full, chosenDate);

    // 2) dailyRows lấy từ cột % trong sheet (SUẤT ĐẠT TRỌNG / ĐỊNH MỨC TRỌNG)
    const dailyRows = buildDailyRowsFromSheet(full, hourlyAll, chosenDate);

    // lines dropdown lấy từ hourlyAll (đúng ngày)
    const lines = hourlyAll.lines || [];

    const line = hourlyAll.byLine?.[qLine] ? qLine : "TỔNG HỢP";
    const lineData = hourlyAll.byLine?.[line] || { line, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines,
      selectedLine: line,
      dailyRows, // ✅ HS đạt + HS ĐM đúng theo sheet
      hourly: lineData, // ✅ từng giờ: actual/target/diff/status
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}