
// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function pickEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return String(v);
  }
  return "";
}

function loadServiceAccount() {
  // bạn có thể lưu raw JSON hoặc base64 JSON
  const raw =
    pickEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT") ||
    "";

  if (!raw) {
    throw new Error("Missing env GOOGLE_SERVICE_ACCOUNT_JSON");
  }

  let jsonText = raw.trim();

  // nếu là base64
  if (!jsonText.startsWith("{")) {
    try {
      jsonText = Buffer.from(jsonText, "base64").toString("utf8");
    } catch {
      // ignore
    }
  }

  let sa;
  try {
    sa = JSON.parse(jsonText);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON/base64 JSON");
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON missing client_email/private_key");
  }

  return sa;
}

const sa = loadServiceAccount();

const auth = new google.auth.JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

export default sheets;