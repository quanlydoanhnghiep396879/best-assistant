// app/_lib/googleSheetsClient.js
import { google } from "googleapis";

/** ========= helpers: env ========= */
function mustEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return null;
  return String(v);
}

function pickEnv(...names) {
  for (const n of names) {
    const v = mustEnv(n);
    if (v) return v;
  }
  return null;
}

function decodeBase64ToUtf8(b64) {
  // Vercel env có thể dính khoảng trắng/newline => trim
  const clean = String(b64 || "").trim();
  if (!clean) return "";
  return Buffer.from(clean, "base64").toString("utf8");
}

function normalizePrivateKey(key) {
  if (!key) return "";
  // nhiều người lưu key dạng \n => phải đổi lại thành newline thật
  return String(key).replace(/\\n/g, "\n");
}

/** ========= service account resolver ========= */
function getServiceAccountFromEnv() {
  // 1) full JSON base64
  const saB64 = pickEnv("GOOGLE_SERVICE_ACCOUNT_BASE64");
  if (saB64) {
    const jsonText = decodeBase64ToUtf8(saB64);
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_BASE64 is not valid JSON after base64 decode.");
    }
  }

  // 2) full JSON raw
  const saJson = pickEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (saJson) {
    try {
      return JSON.parse(saJson);
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }

  // 3) email + private key (raw or base64)
  const email = pickEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_CLIENT_EMAIL");
  const keyRaw = pickEnv("GOOGLE_PRIVATE_KEY");
  const keyB64 = pickEnv("GOOGLE_PRIVATE_KEY_BASE64");

  const privateKey =
    keyRaw ? normalizePrivateKey(keyRaw) :
    keyB64 ? normalizePrivateKey(decodeBase64ToUtf8(keyB64)) :
    "";

  if (email && privateKey) {
    return { client_email: email, private_key: privateKey };
  }

  // không có gì
  const missing = [];
  if (!saB64 && !saJson) {
    if (!email) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    if (!keyRaw && !keyB64) missing.push("GOOGLE_PRIVATE_KEY or GOOGLE_PRIVATE_KEY_BASE64");
  }

  throw new Error(
    `Missing service account credentials. Provide GOOGLE_SERVICE_ACCOUNT_BASE64 (recommended) OR GOOGLE_SERVICE_ACCOUNT_JSON OR GOOGLE_SERVICE_ACCOUNT_EMAIL + (GOOGLE_PRIVATE_KEY/GOOGLE_PRIVATE_KEY_BASE64). Missing: ${missing.join(", ")}`
  );
}

/** ========= sheets client ========= */
let _cached = null;

export function getSheetsClient() {
  if (_cached) return _cached;

  const sa = getServiceAccountFromEnv();

  const clientEmail = sa.client_email;
  const privateKey = normalizePrivateKey(sa.private_key);

  if (!clientEmail || !privateKey) {
    throw new Error("Service account JSON missing client_email or private_key.");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  _cached = sheets;
  return sheets;
}

export function getSpreadsheetId() {
  const id = pickEnv("GOOGLE_SHEET_ID", "SPREADSHEET_ID");
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID.");
  return id;
}

export function getKpiSheetName() {
  // bạn có thể đổi đúng tên biến bạn đang dùng ở đây
  return pickEnv("KPI_SHEET_NAME", "KPI_SHEET_TAB", "KPI_SHEET") || "KPI";
}

/** ========= convenience read ========= */
export async function readRange(rangeA1) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}