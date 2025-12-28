// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function extractSpreadsheetId(maybeIdOrUrl) {
  const s = (maybeIdOrUrl || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m?.[1]) return m[1];
  return s;
}

function loadServiceAccount() {
  const b64 = mustEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  const jsonText = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(jsonText);
}

export function getSpreadsheetId() {
  const raw =
    process.env.SPREADSHEET_ID ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.SHEET_ID ||
    "";
  if (!raw) throw new Error("Missing env SPREADSHEET_ID (or GOOGLE_SHEET_ID / SHEET_ID)");
  return extractSpreadsheetId(raw);
}

export async function getSheetsClient() {
  const sa = loadServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

/**
 * valueRenderOption:
 * - "FORMATTED_VALUE"  -> lấy đúng dd/mm/yyyy trong CONFIG_KPI
 * - "UNFORMATTED_VALUE"-> lấy số thô cho KPI (tính toán tốt)
 */
export async function getValues(rangeA1, valueRenderOption = "UNFORMATTED_VALUE") {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption,
  });

  return res.data.values || [];
}
