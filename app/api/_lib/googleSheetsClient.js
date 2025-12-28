
import { google } from "googleapis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function loadServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const json = Buffer.from(b64, "base64").toString("utf8");
    const obj = JSON.parse(json);
    if (obj.private_key) obj.private_key = obj.private_key.replace(/\\n/g, "\n");
    return obj;
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const obj = JSON.parse(raw);
    if (obj.private_key) obj.private_key = obj.private_key.replace(/\\n/g, "\n");
    return obj;
  }
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_SERVICE_ACCOUNT_JSON");
}

let _sheets = null;

export function getSpreadsheetId() {
  return mustEnv("GOOGLE_SHEET_ID");
}

export async function getSheets() {
  if (_sheets) return _sheets;

  const sa = loadServiceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export async function readRangeFormatted(rangeA1) {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}

export async function readRangeRaw(rangeA1) {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return res.data.values || [];
}