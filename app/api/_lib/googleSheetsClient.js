// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

let cached = null;

function parseServiceAccount() {
  // Cách 1: nhét cả JSON vào env (khuyến nghị)
  // - GOOGLE_SERVICE_ACCOUNT_JSON: JSON string hoặc base64(JSON)
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    const t = raw.trim();
    try {
      return JSON.parse(t);
    } catch {
      // thử base64
      const decoded = Buffer.from(t, "base64").toString("utf8");
      return JSON.parse(decoded);
    }
  }

  // Cách 2: tách email + private_key
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY;

  if (private_key) private_key = private_key.replace(/\\n/g, "\n");

  if (client_email && private_key) {
    return { client_email, private_key };
  }

  return null;
}

export async function getSheetsClient() {
  if (cached) return cached;

  const sa = parseServiceAccount();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error(
      "Thiếu Service Account. Cần GOOGLE_SERVICE_ACCOUNT_JSON (JSON/base64) hoặc GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY"
    );
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  cached = sheets;
  return sheets;
}