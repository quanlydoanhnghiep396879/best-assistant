import { google } from "googleapis";

function mustEnvAny(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  throw new Error(`Missing env: one of [${names.join(", ")}]`);
}

export function getSpreadsheetId() {
  return mustEnvAny(["GOOGLE_SHEETS_ID", "GOOGLE_SHEET_ID", "SPREADSHEET_ID"]);
}

function getServiceAccountJson() {
  const b64 = mustEnvAny([
    "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
    "GOOGLE_SERVICE_ACCOUNT_BASE64",
    "SERVICE_ACCOUNT_JSON_BASE64",
  ]);

  // base64 -> json
  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(jsonStr);
}

export function getSheetsClient() {
  const sa = getServiceAccountJson();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}