// lib/googleSheetsClient.js
import { google } from "googleapis";

let cached = null;

function loadServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let jsonText = null;
  if (b64) jsonText = Buffer.from(b64, "base64").toString("utf8");
  else if (raw) jsonText = raw;

  if (!jsonText) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_B64 (or GOOGLE_SERVICE_ACCOUNT_JSON)"
    );
  }

  const creds = JSON.parse(jsonText);

  // Fix newline for private_key if needed
  if (creds.private_key && typeof creds.private_key === "string") {
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  }

  return creds;
}

export async function getSheetsClient() {
  if (cached) return cached;

  const creds = loadServiceAccount();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  cached = sheets;
  return sheets;
}
