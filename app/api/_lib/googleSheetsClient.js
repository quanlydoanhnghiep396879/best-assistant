// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function loadServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (b64) {
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw);
  }
  if (jsonStr) return JSON.parse(jsonStr);

  throw new Error(
    "Missing GOOGLE_SERVICE_ACCOUNT_BASE64 or GOOGLE_SERVICE_ACCOUNT_JSON"
  );
}

export async function getSheetsClient() {
  const credentials = loadServiceAccount();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

export async function readSheetRange({ spreadsheetId, range }) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return res.data.values || [];
}
