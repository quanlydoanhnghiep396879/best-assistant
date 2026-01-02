// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function loadServiceAccount() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT ||
    "";

  if (!raw) {
    throw new Error(
      "Missing env GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT). Put full service account JSON here."
    );
  }

  // Vercel hay bị escape \n trong private_key
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error("Service account env is not valid JSON");
  }

  if (obj.private_key && typeof obj.private_key === "string") {
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  }

  if (!obj.client_email || !obj.private_key) {
    throw new Error("Service account JSON missing client_email/private_key");
  }

  return obj;
}

let cached = null;

export default async function getSheetsClient() {
  if (cached) return cached;

  const sa = loadServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  cached = sheets;
  return sheets;
}