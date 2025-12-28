// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normText(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    // bỏ dấu tiếng Việt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // chuẩn hoá ký tự
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-");
}

function toNumber(v) {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  // xử lý 1,08 -> 1.08
  const t = s.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeDateInput(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  // nếu là yyyy-mm-dd -> dd/mm/yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split("-");
    return `${d}/${m}/${y}`;
  }
  return t;
}

function getEnvSheetId() {
  return process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEETS_ID || "";
}

function getServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (b64) {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  }
  if (raw) return JSON.parse(raw);

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_BASE64 or GOOGLE_SERVICE_ACCOUNT_JSON");
}

async function getSheets() {
  const sa = getServiceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readConfigRangeByDate(sheets, spreadsheetId, dateStr) {
  const configRange = "CONFIG_KPI!A:B";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: configRange,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = res.data.values || [];
  const target = normText(dateStr);

  for (const r of rows) {
    const d = r?.[0];
    const rg = r?.[1];
    if (!d || !rg) continue;
    if (normText(d) === "DATE") continue; // header
    if (normText(d) === target) return String(rg).trim();
  }
  return "";
}

function findColByKeywordInTopRows(values, keywords, topRows = 6) {
  const R = Math.min(values.length, topRows);
  let best = -1;

  for (let r = 0; r < R; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normText(row[c]);
      if (!cell) continue;
      for (const k of keywords) {
        if (cell.includes(normText(k))) return c;
      }
    }
  }
  return best;
}

function findColsForMarks(values, marks, topRows = 8) {
  const R = Math.min(values.length, topRows);
  const map = {};
  for (const m of marks) map[m] = -1;

  for (let r = 0; r < R; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normText(row[c]).replace(/\s+/g, "");
      if (!cell) continue;
      for (const m of marks) {
        const key = normText(m).replace(/\s+/g, "");
        if (cell.includes(key)) map[m] = c;
      }
    }
  }
  return map;
}

function findLineNameCol(values) {
  // dò cột nào chứa nhiều giá trị dạng C1..C10 / CẮT / KCS / HOÀN TẤT / NM
  const allowed = new Set(["CAT", "KCS", "HOAN TAT", "NM"]);
  const maxCols = Math.max(...values.map(r => (r ? r.length : 0)), 0);

  let bestCol = -1;
  let bestScore = 0;

  for (let c = 0; c < maxCols; c++) {
    let score = 0;
    for (let r = 0; r < values.length; r++) {
      const v = normText(values[r]?.[c]);
      if (!v) continue;
      if (/^C\d+$/.test(v)) score++;
      if (allowed.has(v)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

function statusFromHs(hsDat, hsTarget) {
  if (!Number.isFinite(hsDat)) return "CHƯA CÓ";
  if (hsDat >= hsTarget) return "ĐẠT";
  return "CHƯA ĐẠT";
}

const MARKS = ["->9h","->10h","->11h","->12h30","->13h30","->14h30","->15h30","->16h30"];
const HOURS = { "->9h":1, "->10h":2, "->11h":3, "->12h30":4.5, "->13h30":5.5, "->14h30":6.5, "->15h30":7.5, "->16h30":8.5 };

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = normalizeDateInput(url.searchParams.get("date") || "");
    if (!date) {
      return NextResponse.json({ ok: false, error: "Missing date" }, { status: 400 });
    }

    const spreadsheetId = getEnvSheetId();
    if (!spreadsheetId) {
      return NextResponse.json({ ok: false, error: "Missing GOOGLE_SHEET_ID" }, { status: 500 });
    }

    const sheets = await getSheets();

    const kpiRange = await readConfigRangeByDate(sheets, spreadsheetId, date);
    if (!kpiRange) {
      return NextResponse.json({
        ok: false,
        error: `Không tìm thấy DATE=${date} trong CONFIG_KPI`,
      }, { status: 200 });
    }

    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: kpiRange,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = dataRes.data.values || [];
    if (!values.length) {
      return NextResponse.json({ ok: false, error: `Range rỗng: ${kpiRange}` }, { status: 200 });
    }

    const lineCol = findLineNameCol(values);
    const maHangCol = findColByKeywordInTopRows(values, ["MA HANG", "MÃ HÀNG"], 8);
    const dmDayCol = findColByKeywordInTopRows(values, ["DM/NGAY", "ĐM/NGÀY", "DM / NGAY"], 8);
    const dmHourCol = findColByKeywordInTopRows(values, ["DM/H", "ĐM/H", "DM / H"], 8);
    const markCols = findColsForMarks(values, MARKS, 10);

    // build lines
    const lines = [];
    for (const row of values) {
      const lineName = normText(row?.[lineCol]);
      if (!lineName) continue;

      const isLine =
        /^C\d+$/.test(lineName) ||
        lineName === "CAT" ||
        lineName === "KCS" ||
        lineName === "HOAN TAT" ||
        lineName === "NM";

      if (!isLine) continue;

      const dmDay = toNumber(row?.[dmDayCol]);
      const dmHour = toNumber(row?.[dmHourCol]);

      // last mark for HS day
      let lastMarkVal = NaN;
      for (let i = MARKS.length - 1; i >= 0; i--) {
        const c = markCols[MARKS[i]];
        const v = toNumber(row?.[c]);
        if (Number.isFinite(v)) { lastMarkVal = v; break; }
      }

      const hsDat = (Number.isFinite(dmDay) && Number.isFinite(lastMarkVal) && dmDay > 0)
        ? (lastMarkVal / dmDay)
        : NaN;

      const hsTarget = 0.9; // 90%

      lines.push({
        line: row?.[lineCol] ?? "",
        maHang: maHangCol >= 0 ? (row?.[maHangCol] ?? "") : "",
        dmDay: Number.isFinite(dmDay) ? dmDay : null,
        dmHour: Number.isFinite(dmHour) ? dmHour : null,
        hsDat: Number.isFinite(hsDat) ? hsDat : null,
        hsTarget,
        status: statusFromHs(hsDat, hsTarget),
        hourly: Object.fromEntries(MARKS.map(m => [m, Number.isFinite(toNumber(row?.[markCols[m]])) ? toNumber(row?.[markCols[m]]) : null])),
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      kpiRange,
      debug: { lineCol, maHangCol, dmDayCol, dmHourCol, markCols },
      lines,
      marks: MARKS,
      hoursMap: HOURS,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
