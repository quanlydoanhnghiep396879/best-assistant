// app/api/check-kpi/route.js
import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ===== helpers =====
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Google serial date -> dd/mm/yyyy (base 1899-12-30)
function serialToDMY(n) {
  const base = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// normalize: bỏ dấu + upper + trim
function normalize(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// compact normalize: bỏ dấu + upper + bỏ toàn bộ whitespace
function normCompact(s) {
  return normalize(s).replace(/\s+/g, "");
}

// parse date cell: string hoặc serial (lọc serial “hợp lý” để tránh số lượng bị coi là ngày)
function parseDateCell(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Serial date thường khoảng 30000..60000 (1982..2064). Tránh nhầm số lượng 200, 500...
    if (v >= 30000 && v <= 60000) return serialToDMY(v);
    return "";
  }

  const t = String(v || "").trim();
  if (!t) return "";

  // dd/mm/yyyy
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[1].padStart(2, "0")}/${m1[2].padStart(2, "0")}/${m1[3]}`;

  // yyyy-mm-dd
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[3]}/${m2[2]}/${m2[1]}`;
  // dd/mm (không năm)
  const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${m3[1].padStart(2, "0")}/${m3[2].padStart(2, "0")}`;

  return t;
}

function toShortDM(dmy) {
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]};`
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

// ===== find hourly table block (đúng ngày) =====
function rowHasChosenDM(full, r, chosenShortDM) {
  if (!chosenShortDM) return true; // nếu không có thì khỏi filter
  // check trong window: r-4 .. r (nơi thường chứa “24/12”)
  const start = Math.max(0, r - 4);
  for (let rr = start; rr <= r; rr++) {
    const row = full[rr] || [];
    for (const cell of row) {
      const s = String(cell || "").trim();
      if (!s) continue;
      if (s.includes(chosenShortDM)) return true; // "24/12"
      // đôi khi nằm dạng dd/mm/yyyy:
      const d = parseDateCell(cell);
      if (toShortDM(d) === chosenShortDM) return true;
    }
  }
  return false;
}

function findHourlyTable(full, chosenShortDM) {
  let best = null;

  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const normRow = row.map(normCompact);

    // DM/H (chịu bẩn): DM/H, DMH, ĐM/H, "DM/ H", "DM /H", "DM/H\n"
    const hasDMH = normRow.some((x) => x === "DM/H" || x === "DMH");

    // giờ: "->9h" ...
    const hourCols = [];
    for (let c = 0; c < row.length; c++) {
      const t = String(row[c] || "").trim();
      if (t.includes("->") && /h/i.test(t)) hourCols.push(c);
    }
    const hasArrowHour = hourCols.length > 0;

    if (!hasDMH || !hasArrowHour) continue;

    // nếu có chosenShortDM thì ưu tiên block đúng ngày
    const matchDate = rowHasChosenDM(full, r, chosenShortDM);
    if (!matchDate && chosenShortDM) continue;

    // tìm DM/NGÀY và DM/H
    let dmDayCol = -1;
    let dmHCol = -1;

    for (let c = 0; c < normRow.length; c++) {
      const x = normRow[c];
      // DM/NGAY: chịu bẩn nhiều kiểu
      if (x.includes("DM/NGAY") || x.includes("DMNGAY") || x.includes("ĐM/NGAY") || x.includes("ĐMNGAY")) {
        dmDayCol = c;
      }
      if (x === "DM/H" || x === "DMH") {
        dmHCol = c;
      }
    }

    if (dmHCol < 0) continue;

    const hourLabels = hourCols.map((c) => String(row[c] || "").trim());

    best = { headerRow: r, dmDayCol, dmHCol, hourCols, hourLabels };
    break; // block đầu tiên khớp ngày là đủ
  }

  return best;
}

function pickLineLabel(row, beforeCol) {
  const limit = Math.max(0, beforeCol);
  for (let c = 0; c < limit; c++) {
    const t = String(row[c] || "").trim();
    if (!t) continue;
    const n = normCompact(t);
    // C1..C99, CAT, KCS, HOAN TAT, NM...
    if (/^(C\d+|CAT|KCS|HOANTAT|HOAN|NM)$/.test(n)) return normalize(t); // trả "C1"...
  }
  // fallback: cell đầu
  const t0 = String(row[0] || "").trim();
  return t0 ? normalize(t0) : "";
}

function buildHourlyData(full, chosenShortDM) {
  const info = findHourlyTable(full, chosenShortDM);
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
    const label = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

    // dừng khi trống liên tiếp vài dòng (tránh bị cắt sớm 1 dòng trống trong bảng)
    if (!hasAnyHour && dmH === 0 && dmDay === 0 && !label) {
      blankStreak++;
      if (blankStreak >= 5) break;
      continue;
    } else {
      blankStreak = 0;
    }

    if (!label) continue;

    const hours = hourCols.map((c, idx) => {
      const actual = toNum(row[c]);
      const target = dmH > 0 ? dmH * (idx + 1) : 0;
      const diff = actual - target;

      let status = "CHƯA CÓ ĐM";
      if (dmH > 0) status = actual >= target ? (actual === target ? "ĐỦ" : "VƯỢT") : "THIẾU";

      return {
        label: hourLabels[idx] || `H${idx + 1}`,
        actual,
        target,
        diff,
        status,
      };
    });

    byLine[label] = { line: label, dmDay, dmH, hours };
    lines.push(label);
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
      if (totalDmH > 0) status = actual >= target ? (actual === target ? "ĐỦ" : "VƯỢT") : "THIẾU";

      return {
        label: byLine[lines[0]]?.hours?.[idx]?.label || `H${idx + 1}`,
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
  const names = sheetNames(); // chú ý: sheetNames() phải là function trả về object
  const CONFIG = names.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";

  const rows = await readValues(`${CONFIG}!A2:A1000`, {
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const dates = rows.map((r) => parseDateCell(r?.[0])).filter(Boolean);
  dates.sort(sortDatesDesc);
  return dates;
}

// ===== API =====
export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLineRaw = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const names = sheetNames(); // chú ý: sheetNames() phải là function
    const KPI = names.KPI_SHEET_NAME || process.env.KPI_SHEET_NAME || "KPI";

    const dates = await readConfigDates();
    const chosenDate = parseDateCell(qDate) || dates[0] || "";
    const chosenShortDM = toShortDM(chosenDate);

    const full = await readValues(`${KPI}!A1:AZ2000`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const hourly = buildHourlyData(full, chosenShortDM);

    // normalize line query: cho phép "c1" -> "C1"
    const qLine = normalize(qLineRaw);
    const selectedLine = hourly.byLine[qLine] ? qLine : "TỔNG HỢP";
    const lineData = hourly.byLine[selectedLine] || { line: selectedLine, dmDay: 0, dmH: 0, hours: [] };

    return Response.json({
      ok: true,
      chosenDate,
      dates,
      lines: hourly.lines,
      selectedLine,
      hourly: lineData,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}