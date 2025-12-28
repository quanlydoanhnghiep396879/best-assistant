import { google } from "googleapis";

function getServiceAccountFromEnv() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64?.trim();
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

  if (b64) {
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw);
  }
  if (json) return JSON.parse(json);

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
}

export async function readSheetRange(rangeA1) {
  const sheetId = (process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEETS_ID || "").trim();
  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const sa = getServiceAccountFromEnv();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: (sa.private_key || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: rangeA1,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return resp.data.values || [];
}
