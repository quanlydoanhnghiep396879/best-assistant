import { google } from "googleapis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(Missing env ${name});
  return v;
}

function getSpreadsheetId() {
  return (
    process.env.GOOGLE_SHEET_ID ||
    process.env.SPREADSHEET_ID ||
    mustEnv("GOOGLE_SHEET_ID")
  );
}

function decodeServiceAccount() {
  const b64 = mustEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("Service account base64 is not valid JSON");
  }
}

export async function getSheetsClient() {
  const sa = decodeServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSpreadsheetId();

  return { sheets, spreadsheetId, serviceAccountEmail: sa.client_email };
}