// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

/** BẮT BUỘC: đặt env trên Vercel
 *  - GOOGLE_SHEET_ID
 *  - GOOGLE_SERVICE_ACCOUNT_BASE64  (base64 của JSON service account)
 */

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

let _sheets = null;

function getAuth() {
  const b64 = mustEnv("GOOGLE_SERVICE_ACCOUNT_BASE64");
  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  const sa = JSON.parse(jsonStr);

  return new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export function getSpreadsheetId() {
  return mustEnv("GOOGLE_SHEET_ID");
}

export async function getSheets() {
  if (_sheets) return _sheets;
  const auth = getAuth();
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

/** Đọc 1 range */
export async function readRange(range, opts = {}) {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    // Nếu bạn muốn DATE trả về dạng đẹp (23/12/2025) thì dùng FORMATTED_VALUE
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: opts.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res.data.values || [];
}

/** Batch đọc nhiều range */
export async function batchRead(ranges, opts = {}) {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: opts.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res.data.valueRanges || [];
}

/** ===== DATE helpers =====
 * Google Sheets serial: 46014 = 23/12/2025
 */
export function sheetSerialToDDMMYYYY(n) {
  // dùng UTC để không bị lệch múi giờ
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function normalizeDDMMYYYY(v) {
  if (v === null || v === undefined) return "";

  // nếu là số (hoặc chuỗi số) -> convert serial
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const num = Number(v);
    // serial hợp lý thường > 30000 (khoảng sau năm 1982)
    if (Number.isFinite(num) && num > 30000) return sheetSerialToDDMMYYYY(num);
  }

  // nếu là dd/MM/yyyy (hoặc d/M/yyyy) -> chuẩn hoá 2 chữ số
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = "20" + yyyy;
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
}

export function ddmmyyyySortKey(ddmmyyyy) {
  const s = normalizeDDMMYYYY(ddmmyyyy);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "0000-00-00";
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`; // sortable
}