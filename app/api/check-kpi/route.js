// app/api/check-kpi/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

// ===== helpers =====
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normKey(x) {
  // quan trọng: xoá xuống dòng / khoảng trắng để bắt được "ĐM/\nH"
  return String(x ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, ""); // remove ALL whitespace (space, \n, \t)
}

function parseDateText(v) {
  const t = String(v ?? "").trim();
  if (!t) return "";
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[1].padStart(2, "0")}/${m1[2].padStart(2, "0")}/${m1[3]}`;
  const m2 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m2) return `${m2[1].padStart(2, "0")}/${m2[2].padStart(2, "0")}`;
  const m3 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m3) return `${m3[3]}/${m3[2]}/${m3[1]}`;
  return t;
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
  // ưu tiên dd/mm/yyyy, còn lại sort chuỗi
  const pa = String(a).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const pb = String(b).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!pa || !pb) return String(b).localeCompare(String(a));
  const da = Date.parse(`${pa[3]}-${pa[2]}-${pa[1]}`);
  const db = Date.parse(`${pb[3]}-${pb[2]}-${pb[1]}`);
  return db - da;
}

// ===== tìm bảng giờ =====
function findHourlyTable(full) {
  let headerRow = -1;
  let dmDayCol = -1;
  let dmHCol = -1;
  let hourCols = [];
  let hourLabels = [];

  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const nk = row.map(normKey);

    const hasDMH = nk.some((k) => k === "DM/H" || k === "DMH" || k.includes("DM/H"));
    const hasArrowHour = row.some((x) => {
      const t = String(x || "");
      return t.includes("->") && /h/i.test(t);
    });

    if (hasDMH && hasArrowHour) {
      headerRow = r;

      for (let c = 0; c < nk.length; c++) {
        if (nk[c].includes("DM/NGAY") || nk[c].includes("DMNGAY")) dmDayCol = c;
        if (nk[c] === "DM/H" || nk[c] === "DMH" || nk[c].includes("DM/H")) dmHCol = c;
      }

      hourCols = [];
      for (let c = 0; c < row.length; c++) {
        const t = String(row[c] || "").trim();
        if (t.includes("->") && /h/i.test(t)) hourCols.push(c);
      }

      hourLabels = hourCols.map((c) => String(row[c] || "").trim());
      break;
    }
  }

  if (headerRow < 0 || dmHCol < 0 || hourCols.length === 0) return null;
  return { headerRow, dmDayCol, dmHCol, hourCols, hourLabels };
}

function findLineLabelInRow(row, beforeCol) {
  for (let c = 0; c < beforeCol; c++) {
    const t = String(row[c] || "").trim().toUpperCase();
    if (/^C\d+$/.test(t)) return t; // C1..C10 nằm ở cột A như ảnh bạn gửi
  }
  return "";
}

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

    // nếu gặp vùng trống nhiều dòng thì dừng
    if (!hasAnyHour && dmH === 0 && dmDay === 0) {
      blankStreak++;
      if (blankStreak >= 6) break;
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

      return { label: hourLabels[idx] || `H${idx + 1}`, actual, target, diff, status };
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

      return { label: byLine[lines[0]].hours[idx].label, actual, target, diff, status };
    });

    byLine["TỔNG HỢP"] = { line: "TỔNG HỢP", dmDay: totalDmDay, dmH: totalDmH, hours: totalHours };
  }

  return { byLine, lines: ["TỔNG HỢP", ...lines] };
}

async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();

  // IMPORTANT: dùng FORMATTED_VALUE để tránh số thường bị hiểu nhầm là serial date
  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, {
    valueRenderOption: "FORMATTED_VALUE",
  });

  const dates = rows.map((r) => parseDateText(r?.[0])).filter(Boolean);
  dates.sort(sortDatesDesc);
  return dates;
}

// ===== API =====
export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLine = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const { KPI_SHEET_NAME } = sheetNames();

    const dates = await readConfigDates();
    const chosenDate = parseDateText(qDate) || dates[0] || "";
    const chosenShortDM = toShortDM(chosenDate); // (nếu UI cần)

    // đọc KPI (unformatted để lấy số chuẩn)
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const hourlyAll = buildHourlyData(full);

    const selectedLine = hourlyAll.byLine[qLine] ? qLine : "TỔNG HỢP";
    const hourly = hourlyAll.byLine[selectedLine] || { line: selectedLine, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      chosenShortDM,
      dates,
      lines: hourlyAll.lines,
      selectedLine,
      hourly,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}