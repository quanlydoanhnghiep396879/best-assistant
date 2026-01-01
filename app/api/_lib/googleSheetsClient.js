
import { google } from "googleapis";

function pickServiceAccount() {
  // Ưu tiên JSON (raw hoặc base64)
  const b64 =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (b64) {
    const jsonText = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(jsonText);
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    return JSON.parse(raw);
  }

  // Fallback: email + private key (raw hoặc base64)
  const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  let private_key = process.env.GOOGLE_PRIVATE_KEY || "";
  if (!private_key && process.env.GOOGLE_PRIVATE_KEY_BASE64) {
    private_key = Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }

  // Vercel hay lưu \n dạng text => đổi về xuống dòng thật
  private_key = private_key.replace(/\\n/g, "\n");

  if (!client_email || !private_key) {
    throw new Error("Missing service account credentials (email/private_key or json).");
  }

  return { client_email, private_key };
}

let _sheets = null;

export function getSheetsClient() {
  if (_sheets) return _sheets;

  const sa = pickServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export async function readValues(rangeA1) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return res.data.values || [];
}