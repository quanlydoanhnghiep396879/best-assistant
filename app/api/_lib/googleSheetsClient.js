// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function loadServiceAccount() {
  const b64 =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (!b64) throw new Error("Missing env GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");

  const jsonText = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(jsonText);
}

let cached = null;

export async function getSheetsClient() {
  if (cached) return cached;

  const sa = loadServiceAccount();
  const jwt = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  await jwt.authorize();
  cached = google.sheets({ version: "v4", auth: jwt });
  return cached;
}

export function getSpreadsheetId() {
  // Đây mới là Google Sheet ID (không phải base64)
  return mustEnv("SPREADSHEET_ID");
}