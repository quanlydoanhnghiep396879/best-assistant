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

// tránh 430, 487 bị coi là serial date
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
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]}`;
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

/* ========= tìm các cột giờ trong 1 row ========= */
function getHourCols(row) {
  const cols = [];
  for (let c = 0; c < row.length; c++) {
    const t = String(row[c] || "").trim();
    // ->9h, ->10h, ->12h30 ...
    if (t.includes("->") && /h/i.test(t)) cols.push(c);
  }
  return cols;
}

/* ========= dò tất cả “header row” có nhiều cột giờ ========= */
function findAllHourlyHeaders(full) {
  const headers = [];
  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const hourCols = getHourCols(row);
    if (hourCols.length >= 2) {
      headers.push({ headerRow: r, hourCols });
    }
  }
  return headers;
}

/* ========= tìm “ngày gần nhất phía trên” của 1 headerRow ========= */
function findNearestDateRow(full, headerRow, chosenShortDM) {
  const start = Math.max(0, headerRow - 60);
  for (let r = headerRow; r >= start; r--) {
    const row = full[r] || [];
    for (let c = 0; c < row.length; c++) {
      const d = parseDateCell(row[c]);
      if (!d) continue;
      if (toShortDM(d) === chosenShortDM) return r;
    }
  }
  return -1;
}

/* ========= chọn đúng bảng giờ theo ngày ========= */
function selectHourlyTableByDate(full, chosenDate) {
  const chosenShort = toShortDM(chosenDate);
  const candidates = findAllHourlyHeaders(full);

  let best = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    const dateRow = findNearestDateRow(full, cand.headerRow, chosenShort);
    if (dateRow < 0) continue;
    const score = cand.headerRow - dateRow; // càng gần càng tốt
    if (score < bestScore) {
      bestScore = score;
      best = { ...cand, dateRow };
    }
  }

  // fallback: nếu không match ngày, lấy bảng đầu tiên (đỡ trống)
  if (!best && candidates.length) best = { ...candidates[0], dateRow: -1 };
  if (!best) return null;

  const { headerRow, hourCols } = best;

  // dmHCol: cột ngay trước cột giờ đầu tiên
  const firstHourCol = Math.min(...hourCols);
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

/* ========= build hourly data từ table đã chọn ========= */
function buildHourlyData(full, chosenDate) {
  const info = selectHourlyTableByDate(full, chosenDate);
  if (!info) return { byLine: {}, lines: [] };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;

    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const line = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

    // hết bảng
    if (!hasAnyHour && dmH === 0 && dmDay === 0 && !line) break;
    if (!line) continue;

    const normLine = normalize(line);
    if (normLine.includes("TOTAL") || normLine.includes("TONG KIEM") || normLine.includes("TONG MAY")) {
      continue;
    }

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

  // tổng hợp
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

  return { byLine, lines: lines.length ? ["TỔNG HỢP", ...lines] : [] };
}

/* ========= Map MÃ HÀNG (để bảng hiệu suất ngày có mã hàng) ========= */
function buildMaHangMap(full, aroundRow) {
  // tìm cell "MÃ HÀNG" trong vùng gần aroundRow
  const map = {};
  const r0 = Math.max(0, aroundRow - 80);
  const r1 = Math.min(full.length - 1, aroundRow + 80);

  let headerRow = -1;
  let maHangCol = -1;

  for (let r = r0; r <= r1; r++) {
    const row = full[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (normalize(row[c]) === "MA HANG" || normalize(row[c]) === "MÃ HÀNG") {
        headerRow = r;
        maHangCol = c;
        break;
      }
    }
    if (maHangCol >= 0) break;
  }

  if (headerRow < 0 || maHangCol < 0) return map;

  for (let r = headerRow + 1; r <= r1; r++) {
    const row = full[r] || [];
    const line = String(row[0] || "").trim(); // cột A
    if (!line) continue;

    const n = normalize(line);
    if (!/^(C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(n)) continue;

    const code = String(row[maHangCol] || "").trim();
    if (code) map[line] = code;
  }

  return map;
}

/* ========= Bảng hiệu suất ngày: lấy theo giờ cuối / ĐM lũy tiến ========= */
function buildDailyRows(hourly, maHangMap) {
  const lines = hourly.lines || [];
  const out = [];

  for (const line of lines) {
    const d = hourly.byLine?.[line];
    if (!d) continue;

    const hours = d.hours || [];
    const last = hours[hours.length - 1] || null;

    const targetEnd = last?.target || 0;
    const actualEnd = last?.actual || 0;

    let hsDat = 0;
    if (targetEnd > 0) hsDat = (actualEnd / targetEnd) * 100;

    let status = "CHƯA CÓ DỮ LIỆU";
    if (targetEnd > 0) status = actualEnd >= targetEnd ? "ĐẠT/VƯỢT" : "CHƯA ĐẠT";

    out.push({
      line,
      maHang: maHangMap[line] || (line === "TỔNG HỢP" ? "-" : ""),
      hsDat: Number.isFinite(hsDat) ? hsDat : 0,
      hsDm: 100,
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

    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    // ✅ build hourly theo “đúng bảng đúng ngày”
    const hourlyAll = buildHourlyData(full, chosenDate);

    // nếu không tìm được bảng => trả debug nhẹ để bạn biết
    if (!hourlyAll.lines?.length) {
      return Response.json({
        ok: true,
        chosenDate,
        dates,
        lines: [],
        selectedLine: "TỔNG HỢP",
        dailyRows: [],
        hourly: { line: "TỔNG HỢP", dmDay: 0, dmH: 0, hours: [] },
        debug: "Không tìm thấy header có cột ->9h... cho ngày này (kiểm tra row chứa ->9h có nằm trong A1:AZ2000 không).",
      });
    }

    // maHang map (tìm gần header của bảng giờ)
    // lấy headerRow của bảng (dò lại lần nữa để biết aroundRow)
    const tableInfo = selectHourlyTableByDate(full, chosenDate);
    const aroundRow = tableInfo?.headerRow ?? 0;
    const maHangMap = buildMaHangMap(full, aroundRow);

    const dailyRows = buildDailyRows(hourlyAll, maHangMap);

    const line = hourlyAll.byLine[qLine] ? qLine : "TỔNG HỢP";
    const lineData = hourlyAll.byLine[line] || { line, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines: hourlyAll.lines,
      selectedLine: line,
      dailyRows,
      hourly: lineData,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
