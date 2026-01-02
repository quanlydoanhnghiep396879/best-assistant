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

function toShortDM(dmy) {
  // dd/mm/yyyy -> dd/mm
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]}`;
  // dd/mm
  const m2 = String(dmy || "").match(/^(\d{2})\/(\d{2})$/);
  if (m2) return `${m2[1]}/${m2[2]}`;
  return "";
}

/**
 * IMPORTANT FIX:
 * Chỉ coi số là "serial date" nếu nằm trong range hợp lý (tránh 430 -> 1899/1901).
 * 30000 ~ 1982, 70000 ~ 2091
 */
function isLikelySerialDate(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 30000 && n <= 70000;
}

function parseDateCell(v) {
  // serial number nhưng phải hợp lý
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

function sortDatesDesc(a, b) {
  const pa = String(a).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const pb = String(b).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!pa || !pb) return String(b).localeCompare(String(a));
  const da = Date.parse(`${pa[3]}-${pa[2]}-${pa[1]}`);
  const db = Date.parse(`${pb[3]}-${pb[2]}-${pb[1]}`);
  return db - da;
}

/* ====== FIX LỆCH NGÀY: cắt section theo ô ngày ở cột A ====== */
function sliceSectionByDate(full, chosenDate) {
  const chosenShort = toShortDM(chosenDate);
  if (!chosenDate) return full;

  // tìm start row: ưu tiên cột A (vì file bạn để ngày ở cột A)
  let start = -1;
  for (let r = 0; r < full.length; r++) {
    const d = parseDateCell(full[r]?.[0]);
    if (!d) continue;
    if (d === chosenDate || toShortDM(d) === chosenShort) {
      start = r;
      break;
    }
  }
  if (start < 0) return full;

  // tìm end row = trước ngày kế tiếp (cũng ở cột A)
  let end = full.length;
  for (let r = start + 1; r < full.length; r++) {
    const d = parseDateCell(full[r]?.[0]);
    if (!d) continue;
    // gặp một ô ngày khác => đó là ngày mới
    if (d !== chosenDate && toShortDM(d) !== chosenShort) {
      end = r;
      break;
    }
  }

  return full.slice(start, end);
}

/* ====== tìm bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY” trong section ====== */
function findHourlyTable(section) {
  let headerRow = -1;
  let dmDayCol = -1;
  let dmHCol = -1;
  let hourCols = [];

  for (let r = 0; r < section.length; r++) {
    const row = section[r] || [];
    const normRow = row.map(normalize);

    const hasDMH = normRow.some((x) => x === "DM/H" || x === "DMH" || x === "ĐM/H" || x === "DM / H");
    const hasArrowHour = row.some((x) => String(x || "").includes("->") && /h/i.test(String(x)));

    if (hasDMH && hasArrowHour) {
      headerRow = r;

      for (let c = 0; c < normRow.length; c++) {
        const cell = normRow[c];
        if (cell.includes("DM/NGAY") || cell.includes("DMNGAY") || cell.includes("ĐM/NGAY")) dmDayCol = c;
        if (cell === "DM/H" || cell === "DMH" || cell === "ĐM/H") dmHCol = c;
      }

      hourCols = [];
      for (let c = 0; c < row.length; c++) {
        const t = String(row[c] || "").trim();
        if (t.includes("->") && /h/i.test(t)) hourCols.push(c);
      }
      break;
    }
  }

  if (headerRow < 0 || dmHCol < 0 || hourCols.length === 0) return null;

  const hourLabels = hourCols.map((c) => String((section[headerRow] || [])[c] || "").trim());
  return { headerRow, dmDayCol, dmHCol, hourCols, hourLabels };
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

function buildHourlyData(section) {
  const info = findHourlyTable(section);
  if (!info) return { byLine: {}, lines: [] };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  for (let r = headerRow + 1; r < section.length; r++) {
    const row = section[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;

    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const line = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

    // kết thúc bảng: dòng trống hoàn toàn
    if (!hasAnyHour && dmH === 0 && dmDay === 0 && !line) break;
    if (!line) continue;

    // bỏ qua các dòng tiêu đề phụ / TOTAL KIỂM ĐẠT... nếu cần
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

      return {
        label: hourLabels[idx] || `H${idx + 1}`,
        actual,
        target,
        diff,
        status,
      };
    });

    byLine[line] = { line, dmDay, dmH, hours };
    lines.push(line);
  }

  // Tổng hợp
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

  // lines list để dropdown
  return { byLine, lines: ["TỔNG HỢP", ...lines] };
}

/* ====== Map MÃ HÀNG theo chuyền trong section (để bảng “hiệu suất ngày” có mã hàng) ====== */
function buildMaHangMap(section) {
  let maHangCol = -1;
  let headerRow = -1;

  for (let r = 0; r < Math.min(section.length, 60); r++) {
    const row = section[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (normalize(row[c]) === "MA HANG") {
        headerRow = r;
        maHangCol = c;
        break;
      }
    }
    if (maHangCol >= 0) break;
  }

  const map = {};
  if (maHangCol < 0 || headerRow < 0) return map;

  for (let r = headerRow + 1; r < section.length; r++) {
    const row = section[r] || [];
    const line = String(row[0] || "").trim(); // cột A là C1..C10...
    if (!line) continue;

    const n = normalize(line);
    if (!/^(C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(n)) continue;

    const code = String(row[maHangCol] || "").trim();
    if (code) map[line] = code;
  }

  return map;
}

/* ====== Bảng “hiệu suất trong ngày” (tính từ giờ cuối / ĐM) ====== */
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
    if (targetEnd > 0) {
      status = actualEnd >= targetEnd ? "ĐẠT/VƯỢT" : "CHƯA ĐẠT";
    }

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

/* ====== đọc dates từ CONFIG_KPI: chỉ nhận giá trị là date hợp lý ====== */
async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();

  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, {
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const dates = rows
    .map((r) => parseDateCell(r?.[0]))
    .filter(Boolean);

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

    // đọc KPI rộng
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    // ===== FIX: chỉ xử lý section đúng ngày =====
    const section = sliceSectionByDate(full, chosenDate);

    // build hourly theo section
    const hourly = buildHourlyData(section);

    // build daily rows
    const maHangMap = buildMaHangMap(section);
    const dailyRows = buildDailyRows(hourly, maHangMap);

    // chọn line
    const line = hourly.byLine[qLine] ? qLine : "TỔNG HỢP";
    const lineData = hourly.byLine[line] || { line, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines: hourly.lines,
      selectedLine: line,
      dailyRows,         // ✅ bảng hiệu suất ngày
      hourly: lineData,  // ✅ bảng từng giờ actual/target/diff/status
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}