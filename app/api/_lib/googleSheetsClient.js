// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function parseServiceAccount() {
  // ưu tiên JSON base64, fallback raw JSON
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw);
  }

  const raw = mustEnv("GOOGLE_SERVICE_ACCOUNT_JSON");

  // đôi khi Vercel copy/paste bị thêm dấu nháy ngoài
  const cleaned = raw.trim().replace(/^\uFEFF/, "");
  return JSON.parse(cleaned);
}

let _cached = null;

export async function getGoogleSheetsClient() {
  if (_cached) return _cached;

  const sa = parseServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: (sa.private_key || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  _cached = sheets;
  return sheets;
}
