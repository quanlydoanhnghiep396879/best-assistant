import { google } from "googleapis";

export const runtime = "nodejs";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function loadServiceAccount() {
  // Khuyến nghị: để JSON service account dạng Base64 trong env
  const b64 = mustEnv("GOOGLE_SERVICE_ACCOUNT_BASE64");
  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  const creds = JSON.parse(jsonStr);

  return creds;
}

export function getSheetsClient() {
  const creds = loadServiceAccount();

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

export function getSpreadsheetId() {
  return mustEnv("GOOGLE_SHEET_ID");
}