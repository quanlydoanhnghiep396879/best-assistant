import { google } from "googleapis";

let _sheets = null;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  // === EMAIL ===
  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL;
  if (!clientEmail) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL");

  // === PRIVATE KEY ===
  const b64Key = requireEnv("GOOGLE_PRIVATE_KEY_BASE64");

  // ✅ GIẢI MÃ BASE64 ĐÚNG CÁCH
  const privateKey = Buffer.from(b64Key, "base64")
    .toString("utf8")
    .replace(/\\n/g, "\n")
    .trim();

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Decoded private key is invalid format");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  await auth.authorize();

  const sheets = google.sheets({ version: "v4", auth });
  _sheets = sheets;
  return sheets;
}

export async function readRangeA1(a1Range, opts = {}) {
  const sheets = await getSheetsClient();
  const spreadsheetId = requireEnv("GOOGLE_SHEET_ID");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1Range,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}