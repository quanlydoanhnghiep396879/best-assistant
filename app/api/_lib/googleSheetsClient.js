import { google } from "googleapis";

/**
 * ENV supported (the ones you have on Vercel):
 * - GOOGLE_SHEET_ID
 * - GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64 JSON)
 * - GOOGLE_SERVICE_ACCOUNT_BASE64 (base64 JSON)
 * - GOOGLE_PRIVATE_KEY_BASE64 (optional if JSON already has private_key)
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL (optional)
 */

function decodeBase64(s) {
  return Buffer.from(String(s), "base64").toString("utf8");
}

function normalizePrivateKey(k) {
  if (!k) return "";
  // handle \n in env
  return String(k).replace(/\\n/g, "\n");
}

function loadServiceAccount() {
  // 1) GOOGLE_SERVICE_ACCOUNT_JSON (raw json or base64)
  const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonEnv && String(jsonEnv).trim()) {
    const raw = String(jsonEnv).trim();
    const text = raw.startsWith("{") ? raw : decodeBase64(raw);
    const obj = JSON.parse(text);
    if (obj.private_key) obj.private_key = normalizePrivateKey(obj.private_key);
    return obj;
  }

  // 2) GOOGLE_SERVICE_ACCOUNT_BASE64
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (b64 && String(b64).trim()) {
    const text = decodeBase64(b64);
    const obj = JSON.parse(text);
    if (obj.private_key) obj.private_key = normalizePrivateKey(obj.private_key);
    return obj;
  }

  // 3) fallback: email + private key
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let pk = process.env.GOOGLE_PRIVATE_KEY;

  const pkB64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!pk && pkB64) pk = decodeBase64(pkB64);

  pk = normalizePrivateKey(pk);

  if (email && pk) {
    return { client_email: email, private_key: pk };
  }

  return null;
}

function getAuth() {
  const sa = loadServiceAccount();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error(
      "Missing service account credentials. Provide GOOGLE_SERVICE_ACCOUNT_JSON (or BASE64) or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY(_BASE64)."
    );
  }

  return new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function readRangeA1(a1Range, options = {}) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1Range,
    valueRenderOption: options.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: options.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res.data.values || [];
}
