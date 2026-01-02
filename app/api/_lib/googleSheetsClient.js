// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function loadServiceAccount() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT;

  if (!raw) {
    throw new Error(
      "Missing env: GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_BASE64 / GOOGLE_SERVICE_ACCOUNT)"
    );
  }

  // raw có thể là JSON string hoặc base64(JSON)
  const jsonStr = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  const creds = JSON.parse(jsonStr);

  // fix private_key bị escape \n
  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");

  if (!creds.client_email || !creds.private_key) {
    throw new Error("Service account JSON thiếu client_email hoặc private_key");
  }
  return creds;
}

const creds = loadServiceAccount();

const auth = new google.auth.JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: "v4", auth });

export default sheets;
export { sheets };