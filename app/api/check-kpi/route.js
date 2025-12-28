// ================================
// File: app/api/check-kpi/route.js
// Next.js App Router route handler
// ================================
import { google } from "googleapis";

export const runtime = "nodejs"; // googleapis needs node runtime

// ---------- helpers ----------
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function normText(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/"); // "DM / NGAY" => "DM/NGAY"
}

// dd/mm/yyyy
function toDDMMYYYY(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  // already dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }

  // try Date parse
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const y = dt.getFullYear();
    return `${d}/${m}/${y}`;
  }

  return raw;
}

function getServiceAccountFromEnv() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const rawB64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (rawJson && rawJson.trim()) {
    return JSON.parse(rawJson);
  }
  if (rawB64 && rawB64.trim()) {
    const decoded = Buffer.from(rawB64, "base64").toString("utf8");
    return JSON.parse(decoded);
  }
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
}

async function getSheetsClient() {
  const sa = getServiceAccountFromEnv();

  // private_key from env sometimes contains literal \n
  if (sa.private_key && sa.private_key.includes("\\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

async function readRange(sheets, spreadsheetId, range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return res.data.values || [];
}

// Find best header row in first N rows
function detectHeaderRow(values, maxScanRows = 12) {
  const n = Math.min(values.length, maxScanRows);
  let best = { idx: 0, score: -1 };

  for (let r = 0; r < n; r++) {
    const row = values[r] || [];
    const texts = row.map(normText);

    const hasDmDay = texts.some(t => t.includes("DM/NGAY") || t.includes("ĐM/NGAY"));
    const hasDmHour = texts.some(t => t.includes("DM/H") || t.includes("ĐM/H"));
    const markCount = texts.filter(t => t.startsWith("->") || /^-\>\s*\d+H/.test(t)).length;

    // also accept "->9H" etc if user typed strange spacing
    const score = (hasDmDay ? 3 : 0) + (hasDmHour ? 3 : 0) + markCount;

    if (score > best.score) best = { idx: r, score };
  }

  return best.idx;
}

function findCol(rowNorm, predicate) {
  for (let c = 0; c < rowNorm.length; c++) {
    if (predicate(rowNorm[c], c)) return c;
  }
  return -1;
}

function parseMarksFromHeader(headerRow) {
  const marks = []; // {key:'->9h', col, hourPoint}
  for (let c = 0; c < headerRow.length; c++) {
    const t = normText(headerRow[c]);
    if (!t) continue;

    // Accept: "->9H", "->12H30"
    const m = t.match(/^\-\>\s*(\d{1,2})H(?:(\d{2}))?$/);
    if (m) {
      const hh = Number(m[1]);
      const mm = m[2] ? Number(m[2]) : 0;
      const hourPoint = hh + (mm / 60);
      const key = `->${hh}h${mm ? String(mm).padStart(2, "0") : ""}`.replace("h00","h");
      marks.push({ key, col: c, hourPoint });
    }
  }
  return marks;
}

function isLineCode(s) {
  const t = normText(s);
  if (!t) return false;
  if (/^C\d{1,2}$/.test(t)) return true;
  if (t === "CAT" || t === "CẮT") return true;
  if (t === "KCS") return true;
  if (t === "HOAN TAT" || t === "HOÀN TẤT") return true;
  if (t === "NM") return true;
  return false;
}

function calcHourlyStatus(actual, dm) {
  if (dm === null || dm === undefined || !Number.isFinite(dm)) return { status: "N/A", badge: "na" };
  if (!Number.isFinite(actual)) return { status: "N/A", badge: "na" };

  const delta = actual - dm;
  // vượt: >= 105% DM
  if (actual >= dm * 1.05) return { status: "VƯỢT", badge: "ok" };
  // đủ/đạt: >= DM
  if (delta >= 0) return { status: "ĐỦ", badge: "ok" };
  // thiếu
  return { status: "THIẾU", badge: "bad" };
}

function calcDayStatus(hsDay, hsTarget = 0.9) {
  if (!Number.isFinite(hsDay)) return { status: "CHƯA CÓ", badge: "na" };
  if (hsDay >= 1.0) return { status: "VƯỢT", badge: "ok" };
  if (hsDay >= hsTarget) return { status: "ĐẠT", badge: "ok" };
  return { status: "CHƯA ĐẠT", badge: "bad" };
}

// ---------- main ----------
export async function GET(req) {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) return jsonResponse({ error: "Missing GOOGLE_SHEET_ID" }, 400);

    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date") || "";
    const dateDDMM = toDDMMYYYY(dateParam);

    const sheets = await getSheetsClient();

    // 1) Read CONFIG_KPI to find range for date
    const configValues = await readRange(sheets, spreadsheetId, "CONFIG_KPI!A:B");

    // Find header row in CONFIG_KPI
    let startRow = 0;
    for (let i = 0; i < Math.min(configValues.length, 5); i++) {
      const a = normText(configValues[i]?.[0]);
      const b = normText(configValues[i]?.[1]);
      if (a === "DATE" && b === "RANGE") { startRow = i + 1; break; }
    }

    const dateToRange = new Map();
    for (let i = startRow; i < configValues.length; i++) {
      const d = toDDMMYYYY(configValues[i]?.[0]);
      const r = String(configValues[i]?.[1] ?? "").trim();
      if (d && r) dateToRange.set(d, r);
    }

    // list dates for dropdown
    const availableDates = Array.from(dateToRange.keys());

    // if no date => return only list for UI
    if (!dateDDMM) {
      return jsonResponse({
        ok: true,
        dates: availableDates,
        hint: "Call /api/check-kpi?date=dd/mm/yyyy",
      });
    }

    const range = dateToRange.get(dateDDMM);
    if (!range) {
      return jsonResponse({
        ok: true,
        date: dateDDMM,
        dates: availableDates,
        lines: [],
        marks: [],
        message: "No range found for date in CONFIG_KPI",
      });
    }

    // 2) Read KPI range
    const values = await readRange(sheets, spreadsheetId, range);
    if (!values.length) {
      return jsonResponse({ ok: true, date: dateDDMM, range, lines: [], marks: [] });
    }

    // 3) Detect header row + parse columns
    const headerIdx = detectHeaderRow(values, 14);
    const headerRow = values[headerIdx] || [];
    const headerNorm = headerRow.map(normText);

    const colLine = 0; // by your sheet: line is usually column A in range
    const colMaHang = findCol(headerNorm, (t) => t === "MA HANG" || t === "MÃ HÀNG" || t.includes("MA HANG"));

    const colDmDay = findCol(headerNorm, (t) => t.includes("DM/NGAY") || t.includes("ĐM/NGÀY") || t === "DMNGAY");
    const colDmHour = findCol(headerNorm, (t) => t.includes("DM/H") || t.includes("ĐM/H") || t === "DMH");

    const marks = parseMarksFromHeader(headerRow); // {key, col, hourPoint}
    // choose last mark = max hourPoint
    const lastMark = marks.length ? marks.reduce((a,b)=> (b.hourPoint>a.hourPoint?b:a)) : null;

    // 4) Parse rows after header
    const lines = [];
    for (let r = headerIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      const lineRaw = row[colLine];
      if (!isLineCode(lineRaw)) continue;

      const lineName = String(lineRaw ?? "").trim();
      const maHang = (colMaHang >= 0) ? String(row[colMaHang] ?? "").trim() : "";

      const dmDay = (colDmDay >= 0) ? Number(row[colDmDay]) : NaN;
      const dmHour = (colDmHour >= 0) ? Number(row[colDmHour]) : NaN;

      // actual last cumulative = value at last mark col
      const actualLast = lastMark ? Number(row[lastMark.col]) : NaN;

      // hs day = actual / dmDay
      const hsDay = (Number.isFinite(actualLast) && Number.isFinite(dmDay) && dmDay > 0)
        ? (actualLast / dmDay)
        : NaN;

      const hsTarget = 0.9;
      const dayStatus = calcDayStatus(hsDay, hsTarget);

      const hourly = {};
      for (const m of marks) {
        const actual = Number(row[m.col]);
        const dmCum = (Number.isFinite(dmHour) ? dmHour * Math.max(0, (m.hourPoint - 8)) : NaN); 
        // giả định bắt đầu SX từ 8h -> 9h là 1 giờ. Nếu bạn muốn bắt đầu khác, đổi "8".

        const delta = (Number.isFinite(actual) && Number.isFinite(dmCum)) ? (actual - dmCum) : NaN;
        const st = calcHourlyStatus(actual, dmCum);

        hourly[m.key] = {
          actual: Number.isFinite(actual) ? actual : null,
          dm: Number.isFinite(dmCum) ? Math.round(dmCum) : null,
          delta: Number.isFinite(delta) ? Math.round(delta) : null,
          status: st.status,
          badge: st.badge,
        };
      }

      lines.push({
        line: lineName,
        maHang: maHang || null,

        dmDay: Number.isFinite(dmDay) ? dmDay : null,
        dmHour: Number.isFinite(dmHour) ? dmHour : null,

        hsDay: Number.isFinite(hsDay) ? Number((hsDay * 100).toFixed(2)) : null, // percent
        hsTarget: hsTarget * 100,
        hsStatus: dayStatus.status,
        hsBadge: dayStatus.badge,

        hourly,
      });
    }

    return jsonResponse({
      ok: true,
      date: dateDDMM,
      range,
      dates: availableDates,
      headerIdx,
      cols: { colMaHang, colDmDay, colDmHour, marks: marks.map(m => ({ key: m.key, col: m.col })) },
      marks: marks.map(m => m.key),
      lastMark: lastMark?.key ?? null,
      lines,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}
