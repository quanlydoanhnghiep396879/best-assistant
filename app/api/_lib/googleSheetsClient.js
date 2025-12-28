// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(Missing ${name});
  return v;
}

function loadServiceAccount() {
  // ưu tiên GOOGLE_SERVICE_ACCOUNT_JSON_B64
  const b64 =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;

  if (!b64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_B64");

  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  const sa = JSON.parse(jsonStr);

  // sửa newline private_key nếu bị mất \n
  if (sa.private_key && typeof sa.private_key === "string") {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }
  return sa;
}

let cached = null;

export async function getSheetsClient() {
  if (cached) return cached;

  const sa = loadServiceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  cached = { sheets, clientEmail: sa.client_email };
  return cached;
}

export async function readValues(rangeA1, spreadsheetId = null) {
  const sid =
    spreadsheetId ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.GOOGLE_SHEETS_ID;

  if (!sid) throw new Error("Missing GOOGLE_SHEET_ID");

  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: rangeA1,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}
