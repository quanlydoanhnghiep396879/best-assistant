// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function loadServiceAccount() {
  let jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  // Nếu bạn dùng BASE64
  if (!jsonStr && process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    jsonStr = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
  }

  if (!jsonStr) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
  }

  let sa;
  try {
    sa = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("Service account JSON invalid (cannot JSON.parse).");
  }

  // Fix private_key bị \n
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");

  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON missing client_email/private_key");
  }

  return sa;
}

export function getSpreadsheetId() {
  // ✅ ĐỔI SANG GOOGLE_SHEET_ID cho giống tên biến của bạn
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

export function getSheetsClient() {
  const sa = loadServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId: getSpreadsheetId() };
}
