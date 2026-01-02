// app/api/check-kpi/route.js
import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------- helpers ----------
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const t = String(v).trim();
  if (!t) return 0;

  // % dạng "95.87%" -> 95.87
  if (t.endsWith("%")) {
    const n = Number(t.slice(0, -1).trim().replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

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
  // Date object
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const dd = String(v.getDate()).padStart(2, "0");
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const yyyy = v.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

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

  // dd/mm
  const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${m3[1].padStart(2, "0")}/${m3[2].padStart(2, "0")}`;

  return t;
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

function sortDatesDesc(a, b) {
  const pa = String(a).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const pb = String(b).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!pa || !pb) return String(b).localeCompare(String(a));
  const da = Date.parse(`${pa[3]}-${pa[2]}-${pa[1]}`);
  const db = Date.parse(`${pb[3]}-${pb[2]}-${pb[1]}`);
  return db - da;
}

function rowHasChosenShortDM(row, chosenShortDM) {
  if (!chosenShortDM) return false;
  for (const cell of row || []) {
    const dmy = parseDateCell(cell);
    const sd = toShortDM(dmy);
    if (sd && sd === chosenShortDM) return true;
  }
  return false;
}

function extractLineFromRow(row) {
  // ưu tiên dạng "XXX(C1)" trong MÃ HÀNG
  for (const cell of row || []) {
    const t = String(cell || "").trim();
    if (!t) continue;

    const m = t.match(/\((C\d+)\)/i);
    if (m) return m[1].toUpperCase();

    // nếu cell là C1, C2...
    const m2 = t.match(/^(C\d+)$/i);
    if (m2) return m2[1].toUpperCase();

    const n = normalize(t);
    if (n === "CAT" || n === "CẮT") return "CẮT";
    if (n === "KCS") return "KCS";
    if (n === "HOAN TAT" || n === "HOÀN TẤT") return "HOÀN TẤT";
    if (n === "NM") return "NM";
  }
  return "";
}

function findColByKeywords(full, headerRow, keywords, upRows = 3, downRows = 1) {
  const start = Math.max(0, headerRow - upRows);
  const end = Math.min(full.length - 1, headerRow + downRows);

  for (let r = start; r <= end; r++) {
    const row = full[r] || [];
    const norm = row.map(normalize);
    for (let c = 0; c < norm.length; c++) {
      const v = norm[c];
      if (!v) continue;
      if (keywords.every((k) => v.includes(k))) return c;
    }
  }
  return -1;
}

// ---------- Find hourly table (đúng ngày) ----------
function findHourlyTable(full, chosenShortDM) {
  let headerRow = -1;
  let dmDayCol = -1;
  let dmHCol = -1;
  let hourCols = [];

  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const normRow = row.map(normalize);

    const hasDMH = normRow.some((x) => x === "DM/H" || x === "DMH" || x === "ĐM/H" || x === "DM / H");
    const hasArrowHour = row.some((x) => {
      const t = String(x || "").trim();
      return t.includes("->") && /h/i.test(t);
    });

    if (!hasDMH || !hasArrowHour) continue;

    // ---- IMPORTANT FIX: check đúng block ngày ----
    // sheet của bạn: ngày nằm trên vài dòng, nên phải dò rộng hơn (-8 .. +2)
    let okDate = false;
    for (let rr = Math.max(0, r - 8); rr <= Math.min(full.length - 1, r + 2); rr++) {
      if (rowHasChosenShortDM(full[rr] || [], chosenShortDM)) {
        okDate = true;
        break;
      }
    }
    if (!okDate) continue;

    headerRow = r;

    // xác định col DM/NGÀY và DM/H
    for (let c = 0; c < normRow.length; c++) {
      if (normRow[c].includes("DM/NGAY") || normRow[c].includes("DMNGAY") || normRow[c].includes("ĐM/NGAY")) dmDayCol = c;
      if (normRow[c] === "DM/H" || normRow[c] === "DMH" || normRow[c] === "ĐM/H") dmHCol = c;
    }

    // giờ
    hourCols = [];
    for (let c = 0; c < row.length; c++) {
      const t = String(row[c] || "").trim();
      if (t.includes("->") && /h/i.test(t)) hourCols.push(c);
    }

    break;
  }

  if (headerRow < 0 || dmHCol < 0 || hourCols.length === 0) return null;

  const hourLabels = hourCols.map((c) => String((full[headerRow] || [])[c] || "").trim());

  // tìm cột "MÃ HÀNG" + cột "SUẤT ĐẠT TRONG NGÀY" (để làm dailyRows)
  const maHangCol = findColByKeywords(full, headerRow, ["MA", "HANG"], 6, 2);
  const hsDayCol =
    findColByKeywords(full, headerRow, ["SUAT", "DAT", "TRONG", "NGAY"], 6, 2) ||
    findColByKeywords(full, headerRow, ["HIEU", "SUAT"], 6, 2);

  return { headerRow, dmDayCol, dmHCol, hourCols, hourLabels, maHangCol, hsDayCol };
}

function toPercentValue(v) {
  // nếu Google Sheets trả raw % dạng 0.9587 => 95.87
  const n = toNum(v);
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

function buildFromKpiSheet(full, chosenShortDM) {
  const info = findHourlyTable(full, chosenShortDM);
  if (!info) {
    return {
      hourly: { byLine: {}, lines: [] },
      dailyRows: [],
      meta: { found: false },
    };
  }

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels, maHangCol, hsDayCol } = info;

  const byLine = {};
  const lines = [];
  const dailyRows = [];

  let blankStreak = 0;

  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;
    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const line = extractLineFromRow(row);

    // dòng trống -> cho phép bỏ qua 3 dòng rồi mới dừng
    if (!line && !hasAnyHour && dmH === 0 && dmDay === 0) {
      blankStreak++;
      if (blankStreak >= 3) break;
      continue;
    }
    blankStreak = 0;

    if (!line) continue;

    // build hourly
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
    if (!lines.includes(line)) lines.push(line);

    // build daily row
    const maHang = maHangCol >= 0 ? String(row[maHangCol] || "").trim() : "";
    const hsDat = hsDayCol >= 0 ? toPercentValue(row[hsDayCol]) : 0;
    const hsDm = 100;

    let status = "CHƯA CÓ DỮ LIỆU";
    if (hsDat > 0) status = hsDat >= 100 ? "ĐẠT/VƯỢT" : "CHƯA ĐẠT";

    dailyRows.push({
      line,
      maHang: maHang || "-",
      hsDat,
      hsDm,
      status,
    });
  }

  // Tổng hợp hourly
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

    // Tổng hợp daily (từ last hour)
    const last = totalHours[totalHours.length - 1];
    const hsDatTotal = last?.target > 0 ? (last.actual / last.target) * 100 : 0;

    dailyRows.unshift({
      line: "TỔNG HỢP",
      maHang: "-",
      hsDat: hsDatTotal,
      hsDm: 100,
      status: hsDatTotal >= 100 ? "ĐẠT/VƯỢT" : hsDatTotal > 0 ? "CHƯA ĐẠT" : "CHƯA CÓ DỮ LIỆU",
    });
  }

  const outLines = ["TỔNG HỢP", ...lines];

  return {
    hourly: { byLine, lines: outLines },
    dailyRows,
    meta: { found: true, headerRow },
  };
}

async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();

  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, {
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const dates = rows.map((r) => parseDateCell(r?.[0])).filter(Boolean);
  dates.sort(sortDatesDesc);
  return dates;
}

// ---------- API ----------
export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLine = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const { KPI_SHEET_NAME } = sheetNames();

    const dates = await readConfigDates();
    const chosenDate = parseDateCell(qDate) || dates[0] || "";
    const chosenShortDM = toShortDM(chosenDate);

    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const built = buildFromKpiSheet(full, chosenShortDM);

    const lines = built.hourly.lines || [];
    const byLine = built.hourly.byLine || {};

    const selectedLine = byLine[qLine] ? qLine : "TỔNG HỢP";
    const hourly = byLine[selectedLine] || { line: selectedLine, dmDay: 0, dmH: 0, hours: [] };

    // daily cho line đang chọn (nếu có)
    const dailyRow = (built.dailyRows || []).find((x) => x.line === selectedLine) || null;

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines,
      selectedLine,
      hourly,
      dailyRows: built.dailyRows || [],
      daily: dailyRow,
      meta: built.meta,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}