// app/api/check-kpi/route.js
import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

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

function normalize(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function parseDateCell(v) {
  if (typeof v === "number" && Number.isFinite(v)) return serialToDMY(v);
  const t = String(v || "").trim();
  if (!t) return "";

  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[1].padStart(2, "0")}/${m1[2].padStart(2, "0")}/${m1[3]}`;

  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[3]}/${m2[2]}/${m2[1]}`;

  const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) return `${m3[1].padStart(2, "0")}/${m3[2].padStart(2, "0")}`;

  return t;
}

function sortDatesDesc(a, b) {
  const pa = String(a).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const pb = String(b).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!pa || !pb) return String(b).localeCompare(String(a));
  const da = Date.parse(`${pa[3]}-${pa[2]}-${pa[1]}`);
  const db = Date.parse(`${pb[3]}-${pb[2]}-${pb[1]}`);
  return db - da;
}

// ====== BỎ CẮT / HOÀN TẤT / KCS / NM ======
function isIgnoredLine(line) {
  const t = normalize(line);
  if (!t) return false;
  // "CẮT" -> "CAT" do normalize()
  if (t === "CAT") return true;
  if (t === "KCS") return true;
  if (t === "NM") return true;
  if (t === "HOAN TAT") return true;
  if (t === "HOÀN TẤT") return true;
  return false;
}

// ====== sort chuyền đúng số: C1..C10.. ======
function lineSortKey(line) {
  const t = normalize(line);
  if (t === "TONG HOP" || t === "TỔNG HỢP") return { g: 0, n: 0, s: t };
  const m = t.match(/^C\s*0*([0-9]+)$/);
  if (m) return { g: 1, n: parseInt(m[1], 10), s: t };
  return { g: 9, n: 9999, s: t };
}
function sortLinesNumeric(arr) {
  return [...arr].sort((a, b) => {
    const ka = lineSortKey(a);
    const kb = lineSortKey(b);
    if (ka.g !== kb.g) return ka.g - kb.g;
    if (ka.n !== kb.n) return ka.n - kb.n;
    return ka.s.localeCompare(kb.s);
  });
}

// --- Tìm bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY” ---
function findHourlyTable(full) {
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

      for (let c = 0; c < normRow.length; c++) {
        if (normRow[c].includes("DM/NGAY") || normRow[c].includes("DMNGAY") || normRow[c].includes("ĐM/NGAY")) dmDayCol = c;
        if (normRow[c] === "DM/H" || normRow[c] === "DMH") dmHCol = c;
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
  const hourLabels = hourCols.map((c) => String((full[headerRow] || [])[c] || "").trim());
  return { headerRow, dmDayCol, dmHCol, hourCols, hourLabels };
}

function pickLineLabel(row, beforeCol) {
  for (let c = 0; c < beforeCol; c++) {
    const t = String(row[c] || "").trim();
    if (!t) continue;
    const n = normalize(t);
    if (/^(C\d+|CAT|KCS|HOAN|HOAN TAT|NM)/.test(n)) return t;
  }
  const t0 = String(row[0] || "").trim();
  return t0 || "";
}

function buildHourlyData(full) {
  const info = findHourlyTable(full);
  if (!info) return { byLine: {}, lines: [] };

  const { headerRow, dmDayCol, dmHCol, hourCols, hourLabels } = info;

  const byLine = {};
  const lines = [];

  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];

    const dmH = toNum(row[dmHCol]);
    const dmDay = dmDayCol >= 0 ? toNum(row[dmDayCol]) : 0;

    const hasAnyHour = hourCols.some((c) => String(row[c] || "").trim() !== "");
    const labelProbe = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);

    if (!hasAnyHour && dmH === 0 && dmDay === 0 && !labelProbe) break;

    const line = pickLineLabel(row, dmDayCol >= 0 ? dmDayCol : dmHCol);
    if (!line) continue;

    // BỎ các dòng không muốn hiển thị
    if (isIgnoredLine(line)) continue;

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

  // Tổng hợp (chỉ cộng các line còn lại sau khi lọc)
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

      return { label: (byLine[lines[0]]?.hours?.[idx]?.label) || `H${idx + 1}`, actual, target, diff, status };
    });

    byLine["TỔNG HỢP"] = { line: "TỔNG HỢP", dmDay: totalDmDay, dmH: totalDmH, hours: totalHours };
  }

  // sort lines chuẩn C1..C10
  const sorted = sortLinesNumeric(lines);
  return { byLine, lines: ["TỔNG HỢP", ...sorted] };
}

async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();
  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A1000`, { valueRenderOption: "UNFORMATTED_VALUE" });
  const dates = rows.map((r) => parseDateCell(r?.[0])).filter(Boolean);
  dates.sort(sortDatesDesc);
  return dates;
}

// ====== DAILY TABLE: HS đạt vs HS ĐM ======
// Bạn đang có 2 cột phần trăm ở sheet (HS đạt & HS ĐM).
// Ở ảnh bạn gửi: có "SUẤT ĐẠT TRONG ..." và "ĐỊNH MỨC TRONG ..."
// -> Nếu bạn đã map đúng ở code cũ thì giữ.
// Ở đây mình làm cách chắc chắn: dò cột có % và lấy 2 cột gần nhau (HS đạt / HS ĐM).
function findDailyPercentCols(full) {
  // tìm dòng header có chữ "SUAT DAT" và "DINH MUC" (không dấu)
  for (let r = 0; r < full.length; r++) {
    const row = full[r] || [];
    const norm = row.map(normalize);

    const idxDat = norm.findIndex((x) => x.includes("SUAT DAT"));
    const idxDm = norm.findIndex((x) => x.includes("DINH MUC"));

    if (idxDat >= 0 && idxDm >= 0) {
      return { headerRow: r, colDat: idxDat, colDm: idxDm };
    }
  }
  return null;
}

function buildDailyRows(full) {
  const info = findDailyPercentCols(full);
  if (!info) return [];

  const { headerRow, colDat, colDm } = info;

  const out = [];
  for (let r = headerRow + 1; r < full.length; r++) {
    const row = full[r] || [];
    const line = String(row[0] || "").trim();
    if (!line) continue;

    // bỏ các dòng không cần
    if (isIgnoredLine(line)) continue;

    // chỉ giữ C1..Cxx + TỔNG HỢP nếu bạn muốn
    const n = normalize(line);
    const isC = /^C\s*\d+/.test(n);
    if (!isC && n !== "TONG HOP" && n !== "TỔNG HỢP") {
      // nếu muốn giữ các nhóm khác thì bỏ if này
    }

    const hsDat = toNum(row[colDat]);
    const hsDm = toNum(row[colDm]);

    // status theo yêu cầu: hsDat >= hsDm => ĐẠT
    const status = hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";

    out.push({ line, hsDat, hsDm, status });
  }

  // sort C1..C10
  return sortLinesNumeric(out.map(x => x.line))
    .map(ln => out.find(x => x.line === ln))
    .filter(Boolean);
}

// ---- API ----
export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qLine = request.nextUrl.searchParams.get("line") || "TỔNG HỢP";

    const { KPI_SHEET_NAME } = sheetNames();

    const dates = await readConfigDates();
    const chosenDate = parseDateCell(qDate) || dates[0] || "";

    // đọc KPI
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ2000`, { valueRenderOption: "UNFORMATTED_VALUE" });

    // hourly
    const hourlyAll = buildHourlyData(full);
    // daily
    const dailyRows = buildDailyRows(full);

    // lines: lấy từ hourly (đã lọc & sort), đồng thời đảm bảo dropdown không có CAT/KCS/NM/...
    const lines = hourlyAll.lines.filter((ln) => !isIgnoredLine(ln));

    const selectedLine = hourlyAll.byLine[qLine] ? qLine : "TỔNG HỢP";
    const hourly = hourlyAll.byLine[selectedLine] || { line: selectedLine, dmDay: 0, dmH: 0, hours: [] };

    const payload = {
      ok: true,
      chosenDate,
      dates,
      lines,
      selectedLine,
      dailyRows,
      hourly,
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }
}