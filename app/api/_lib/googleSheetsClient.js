import { google } from "googleapis";

/** ===== ENV HELPERS ===== */
export function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function parseSpreadsheetId(input) {
  if (!input) return "";
  const s = String(input).trim();

  // If user put full URL, extract /d/<ID>/
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m?.[1]) return m[1];

  // If user pasted just the ID
  return s;
}

/** ===== DATE NORMALIZE (Google Sheets serial <-> dd/mm/yyyy) =====
 * Google/Excel serial base: 1899-12-30
 * 46014 -> 23/12/2025 ; 46015 -> 24/12/2025
 */
const SERIAL_BASE_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

export function serialToDateStr(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return "";
  const d = new Date(SERIAL_BASE_UTC + Math.round(n) * DAY_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function dateStrToSerial(dateStr) {
  const s = String(dateStr || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return NaN;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const utc = Date.UTC(yyyy, mm - 1, dd);
  return Math.floor((utc - SERIAL_BASE_UTC) / DAY_MS);
}

/** Normalize any date input into dd/mm/yyyy
 * Accepts:
 * - "46015" (serial)
 * - 46015 (serial)
 * - "24/12/2025"
 * - "2025-12-24"
 */
export function normalizeDateKey(v) {
  if (v === null || v === undefined) return "";

  // number or numeric string => serial
  const num = Number(v);
  if (Number.isFinite(num) && String(v).trim() !== "") {
    // If it's a serial like 46015
    if (num > 20000 && num < 80000) return serialToDateStr(num);
  }

  const s = String(v).trim();

  // dd/mm/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")}/${yyyy}`;
  }

  // yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2].padStart(2, "0");
    const dd = iso[3].padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  // fallback: try parse dd-mm-yyyy
  const dmY = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmY) {
    const dd = dmY[1].padStart(2, "0");
    const mm = dmY[2].padStart(2, "0");
    const yyyy = dmY[3];
    return `${dd}/${mm}/${yyyy}`;
  }

  return "";
}

/** ===== NUMBER PARSE ===== */
export function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  // remove commas
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** ===== SERVICE ACCOUNT ===== */
function loadServiceAccount() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "Missing env GOOGLE_SERVICE_ACCOUNT_BASE64 (or GOOGLE_SERVICE_ACCOUNT_JSON)"
    );
  }

  let jsonText = raw.trim();
  if (!jsonText.startsWith("{")) {
    jsonText = Buffer.from(jsonText, "base64").toString("utf8");
  }

  const obj = JSON.parse(jsonText);

  // Fix common case: private_key contains "\\n"
  if (obj.private_key && typeof obj.private_key === "string") {
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  }

  return obj;
}

/** ===== SINGLETON CLIENT ===== */
let _cached = null;

export function getSheetsClient() {
  if (_cached) return _cached;

  const sa = loadServiceAccount();
  const spreadsheetId = parseSpreadsheetId(
    process.env.SPREADSHEET_ID || process.env.GOOGLE_SHEET_ID
  );
  if (!spreadsheetId) {
    throw new Error("Missing env SPREADSHEET_ID (or GOOGLE_SHEET_ID)");
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  _cached = { sheets, spreadsheetId };
  return _cached;
}

export async function getValues(range, opts = {}) {
  const { sheets, spreadsheetId } = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    // IMPORTANT: config date might become serial if UNFORMATTED.
    // We'll control by opts.valueRenderOption from caller.
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: opts.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res?.data?.values || [];
}