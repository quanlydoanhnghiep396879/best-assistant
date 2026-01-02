// app/api/check-kpi/route.js

import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------- helpers ----------------
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
  const d = new Date(base.getTime() + Number(n) * 24 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeNoDiacritics(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normKey(s) {
  // chuẩn hoá mạnh để match "ĐM/\nH", "ĐM / H", "DMH"...
  return normalizeNoDiacritics(s)
    .replace(/\s+/g, "") // bỏ khoảng trắng
    .replace(/\\N/g, "") // phòng trường hợp có \n dạng text
    .replace(/\n/g, "");
}

function parseDateCell(v) {
  // nếu là serial number
  if (typeof v === "number" && Number.isFinite(v)) return serialToDMY(v);

  const t = String(v || "").trim();
  if (!t) return "";

  // dd/mm/yyyy
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[1].padStart(2, "0")}/${m1[2].padStart(2, "0")}/${m1[3]}`;

  // yyyy-mm-dd
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[3]}/${m2[2]}/${m2[1]}`;
  // dd/mm (không có năm)
  const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${m3[1].padStart(2, "0")}/${m3[2].padStart(2, "0")}`;

  return t;
}

function toShortDM(dmy) {
  // dd/mm/yyyy -> dd/mm
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]}`;
  // nếu đã là dd/mm thì ok
  const m2 = String(dmy || "").match(/^(\d{2})\/(\d{2})$/);
  if (m2) return `${m2[1]}/${m2[2]}`;
  return "";
}

function sortDatesDesc(a, b) {
  // hỗ trợ dd/mm/yyyy
  const pa = String(a).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const pb = String(b).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!pa || !pb) return String(b).localeCompare(String(a));
  const da = Date.parse(`${pa[3]}-${pa[2]}-${pa[1]}`);
  const db = Date.parse(`${pb[3]}-${pb[2]}-${pb[1]}`);
  return db - da;
}

function findLineLabelInRow(row, beforeCol) {
  for (let c = 0; c < beforeCol; c++) {
    const t = String(row[c] || "").trim();
    if (!t) continue;
    const n = normalizeNoDiacritics(t);
    if (/^(C\d+|CAT|KCS|HOAN\s*TAT|HOANTAT|NM)$/.test(n)) return t;
  }
  // fallback
  const t0 = String(row[0] || "").trim();
  return t0 || "";
}

function isHourHeaderCell(v) {
  const t = String(v ?? "").trim();
  if (!t) return false;

  // chấp nhận: "->9h", ">9h", "→9h", "9h", "->12h30", "12h30"
  const hasH = /h/i.test(t);
  const hasNumber = /\d/.test(t);
  return hasH && hasNumber;
}

// ---------------- find hourly table (ROBUST) ----------------
function findHourlyTable(full) {
  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const nk = row.map(normKey);

    // tìm cột ĐM/H ở hàng r
    let dmHCol = -1;
    for (let c = 0; c < nk.length; c++) {
      const k = nk[c];
      // DM/H có thể ra: "DM/H" => "DM/H" sau normKey thành "DM/H"? (đã bỏ space nhưng vẫn còn "/")
      // hoặc "DMH", hoặc "ĐM/H" -> "DM/H"
      if (k === "DM/H" || k === "DMH" || k.includes("DM/H")) {
        dmHCol = c;
        break;
      }
      // trường hợp bị mất "/" sau normKey (hiếm): "DMH"
      if (k === "DMH") {
        dmHCol = c;
        break;
      }
    }
    if (dmHCol < 0) continue;

    // tìm DM/NGÀY (nếu có)
    let dmDayCol = -1;
    for (let c = 0; c < nk.length; c++) {
      const k = nk[c];
      if (k.includes("DM/NGAY") || k.includes("DMNGAY")) {
        dmDayCol = c;
        break;
      }
    }

    // tìm hàng header giờ: ưu tiên r, nếu không có thì thử r+1 (do merge lệch hàng)
    const scanHourCols = (rr) => {
      const rrRow = full[rr] || [];
      const cols = [];
      for (let c = 0; c < rrRow.length; c++) {
        if (isHourHeaderCell(rrRow[c])) cols.push(c);
      }
      return cols;
    };

    let headerRow = r;
    let hourCols = scanHourCols(r);

    if (hourCols.length === 0 && r + 1 < full.length) {
      const next = scanHourCols(r + 1);
      if (next.length > 0) {
        headerRow = r + 1;
        hourCols = next;
      }
    }

    if (hourCols.length === 0) continue;

    const hourLabels = hourCols.map((c) => String((full[headerRow] || [])[c] || "").trim());

    return { headerRow, dmDayCol, dmHCol, hourCols, hourLabels };
  }

  return null;
}

// ---------------- build hourly data ----------------
function buildHourlyData(full) {
  const info = findHourlyTable(full);
  if (!info) return { byLine: {}, lines: [] };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  let blankStreak = 0;

  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;
    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");

    // gặp vùng trống liên tục thì dừng (tránh sang bảng khác)
    if (!hasAnyHour && dmH === 0 && dmDay === 0) {
      blankStreak++;
      if (blankStreak >= 3) break;
      continue;
    }
    blankStreak = 0;

    const beforeCol = dmDayCol >= 0 ? dmDayCol : dmHCol;
    const line = findLineLabelInRow(row, beforeCol);
    if (!line) continue;

    const hours = hourCols.map((c, idx) => {
      const actual = toNum(row[c]);
      const target = dmH > 0 ? dmH * (idx + 1) : 0;
      const diff = actual - target;

      let status = "CHƯA CÓ ĐM";
      if (dmH > 0) status = actual === target ? "ĐỦ" : actual > target ? "VƯỢT" : "THIẾU";

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

    const totalHours = byLine[lines[0]].hours.map((_, idx) => {
      const actual = lines.reduce((s, ln) => s + (byLine[ln]?.hours?.[idx]?.actual || 0), 0);
      const target = totalDmH > 0 ? totalDmH * (idx + 1) : 0;
      const diff = actual - target;

      let status = "CHƯA CÓ ĐM";
      if (totalDmH > 0) status = actual === target ? "ĐỦ" : actual > target ? "VƯỢT" : "THIẾU";

      return {
        label: byLine[lines[0]].hours[idx].label,
        actual,
        target,
        diff,
        status,
      };
    });

    byLine["TỔNG HỢP"] = { line: "TỔNG HỢP", dmDay: totalDmDay, dmH: totalDmH, hours: totalHours };
  }

  return { byLine, lines: ["TỔNG HỢP", ...lines] };
}

// ---------------- read config dates ----------------
async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();

  // đọc cột A (DATE)
  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`,{
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const dates = (rows || []).map((r) => parseDateCell(r?.[0])).filter(Boolean);
  dates.sort(sortDatesDesc);
  return dates;
}

// ---------------- API ----------------
export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLine = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const { KPI_SHEET_NAME } = sheetNames();

    // lấy danh sách ngày từ CONFIG_KPI
    const dates = await readConfigDates();
    const chosenDate = parseDateCell(qDate) || dates[0] || "";

    // đọc KPI rộng (bạn có thể hạ xuống A1:AZ1200 nếu sheet không dài)
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    // build hourly
    const hourly = buildHourlyData(full);

    // chọn line trả về
    const line = hourly.byLine[qLine] ? qLine : "TỔNG HỢP";
    const lineData = hourly.byLine[line] || { line, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines: hourly.lines,
      selectedLine: line,
      hourly: lineData,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: "CHECK_KPI_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}