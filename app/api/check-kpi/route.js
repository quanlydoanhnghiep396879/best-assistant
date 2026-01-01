// app/api/check-kpi/route.js

import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---- helpers ----
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
  // dd/mm (không có năm) -> để nguyên dd/mm
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

// --- Tìm bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY” ---
function findHourlyTable(full, shortDM) {
  // Tìm row có DM/H và có các cột ->9h...
  let headerRow = -1;
  let dmDayCol = -1;
  let dmHCol = -1;
  let hourCols = [];

  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const normRow = row.map(normalize);

    const hasDMH = normRow.some((x) => x === "DM/H" || x === "DMH" || x === "ĐM/H" || x === "DM / H");
    const hasArrowHour = row.some((x) => String(x || "").includes("->") && /h/i.test(String(x)));

    if (hasDMH && hasArrowHour) {
      headerRow = r;

      // xác định col DM/NGÀY và DM/H
      for (let c = 0; c < normRow.length; c++) {
        if (normRow[c].includes("DM/NGAY") || normRow[c].includes("DMNGAY") || normRow[c].includes("ĐM/NGAY")) dmDayCol = c;
        if (normRow[c] === "DM/H" || normRow[c] === "DMH") dmHCol = c;
      }

      // giờ
      hourCols = [];
      for (let c = 0; c < row.length; c++) {
        const t = String(row[c] || "").trim();
        if (t.includes("->") && /h/i.test(t)) hourCols.push(c);
      }

      break;
    }
  }

  if (headerRow < 0 || dmHCol < 0 || hourCols.length === 0) return null;

  const hourLabels = hourCols.map((c) => String((full[headerRow] || [])[c] || "").trim());
  return { headerRow, dmDayCol, dmHCol, hourCols, hourLabels };
}

function pickLineLabel(row, beforeCol) {
  // tìm nhãn chuyền ở các cột trước DM/NGÀY (thường A..G)
  for (let c = 0; c < beforeCol; c++) {
    const t = String(row[c] || "").trim();
    if (!t) continue;
    const n = normalize(t);
    if (/^(C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(n)) return t;
  }
  // fallback: lấy cell đầu tiên
  const t0 = String(row[0] || "").trim();
  return t0 || "";
}

function buildHourlyData(full, chosenShortDM) {
  const info = findHourlyTable(full, chosenShortDM);
  if (!info) return { hours: [], byLine: {}, lines: [] };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  // dữ liệu bắt đầu từ row sau headerRow
  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;

    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const hasLabelArea = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

    // gặp vùng trống thì dừng (tránh kéo xuống bảng khác)
    if (!hasAnyHour && dmH === 0 && dmDay === 0 && !hasLabelArea) {
      // cho phép bỏ qua vài dòng trống nhẹ, nhưng ở đây dừng luôn để an toàn
      break;
    }

    // bỏ qua các dòng tổng/cộng nếu có
    const line = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);
    if (!line) continue;

    // nếu dmH = 0 mà vẫn có giờ (có thể là dòng tổng/ghi chú) -> vẫn lưu nhưng status sẽ “chưa có DM”
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

  return { byLine, lines: ["TỔNG HỢP", ...lines] };
}

async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();

  // đọc cột A (DATE). Bạn có thể để thêm cột khác cũng được, code chỉ lấy cột A.
  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, { valueRenderOption: "UNFORMATTED_VALUE" });
  const dates = rows.map((r) => parseDateCell(r?.[0])).filter(Boolean);

  // chuẩn hóa dd/mm/yyyy: nếu ai nhập dd/mm không có năm -> vẫn giữ dd/mm, nhưng bạn nên nhập đủ năm để chắc
  dates.sort(sortDatesDesc);
  return dates;
}

// ---- API ----
export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLine = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const { KPI_SHEET_NAME } = sheetNames();

    const dates = await readConfigDates();
    const chosenDate = parseDateCell(qDate) || dates[0] || "";

    // đọc KPI rộng`
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, { valueRenderOption: "UNFORMATTED_VALUE" });

    const chosenShortDM = toShortDM(chosenDate);

    // build hourly from KPI (theo ảnh bạn gửi)
    const hourly = buildHourlyData(full, chosenShortDM);

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
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}