// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

/** ===== ENV ===== */
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

function assertEnv() {
  const missing = [];
  if (!SHEET_ID) missing.push("GOOGLE_SHEET_ID");
  if (!CLIENT_EMAIL) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!PRIVATE_KEY) missing.push("GOOGLE_PRIVATE_KEY");
  if (missing.length) {
    throw new Error("Missing env: " + missing.join(", "));
  }
}

/** ===== Google Sheets date serial (Excel-like) -> JS Date =====
 * Google Sheets date serial is compatible with Excel 1900 system:
 * day 0 ~= 1899-12-30
 */
function serialToDate(serial) {
  const base = Date.UTC(1899, 11, 30);
  const ms = base + Number(serial) * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Normalize any date input -> "DD/MM/YYYY" */
export function toDdMmYyyy(input) {
  if (input === null || input === undefined) return "";

  // number: 46015
  if (typeof input === "number" && Number.isFinite(input)) {
    const d = serialToDate(input);
    const dd = pad2(d.getUTCDate());
    const mm = pad2(d.getUTCMonth() + 1);
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  const s = String(input).trim();
  if (!s) return "";

  // numeric string: "46015"
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return toDdMmYyyy(n);
  }

  // ISO: "2025-12-23"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yyyy, mm, dd] = s.split("-").map(Number);
    return `${pad2(dd)}/${pad2(mm)}/${yyyy}`;
  }

  // DD/MM/YYYY or D/M/YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dd = pad2(Number(m[1]));
    const mm = pad2(Number(m[2]));
    const yyyy = Number(m[3]);
    return `${dd}/${mm}/${yyyy}`;
  }

  // fallback: return original
  return s;
}

function ddmmyyyyToTime(s) {
  const n = toDdMmYyyy(s);
  const m = n.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return Number.NaN;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  // use UTC for stable sort
  return Date.UTC(yyyy, mm - 1, dd);
}

/** Sort dates ASC: 23/12/2025 before 24/12/2025 */
export function sortDatesAsc(dates) {
  const norm = (dates || [])
    .map(toDdMmYyyy)
    .filter(Boolean);

  // unique
  const uniq = Array.from(new Set(norm));

  uniq.sort((a, b) => {
    const ta = ddmmyyyyToTime(a);
    const tb = ddmmyyyyToTime(b);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return a.localeCompare(b);
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb; // ASC
  });

  return uniq;
}

/** ===== auth + sheets client ===== */
export async function getSheetsClient() {
  assertEnv();

  const auth = new google.auth.JWT({
    email: CLIENT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

/** Read a range */
export async function readRange(range, {
  valueRenderOption = "FORMATTED_VALUE", // IMPORTANT: keeps date as "23/12/2025" not 46015
  majorDimension = "ROWS",
} = {}) {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption,
    dateTimeRenderOption: "FORMATTED_STRING",
    majorDimension,
  });

  return res.data.values || [];
}

/** Get KPI dates from CONFIG_KPI sheet and sort ASC */
export async function listKpiDates() {
  // assume CONFIG_KPI has DATE in col A from row 2
  const values = await readRange("CONFIG_KPI!A2:A", {
    valueRenderOption: "FORMATTED_VALUE",
  });

  const dates = values.flat().map(toDdMmYyyy).filter(Boolean);
  return sortDatesAsc(dates);
}

/** Find range string by date from CONFIG_KPI (A=date, B=range) */
export async function findRangeByDate(dateInput) {
  const want = toDdMmYyyy(dateInput);
  if (!want) return null;

  const rows = await readRange("CONFIG_KPI!A2:B", {
    valueRenderOption: "FORMATTED_VALUE",
  });

  for (const r of rows) {
    const d = toDdMmYyyy(r?.[0]);
    const range = (r?.[1] || "").trim();
    if (d === want && range) return range;
  }
  return null;
}