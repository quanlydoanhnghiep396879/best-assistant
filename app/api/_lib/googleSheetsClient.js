import { google } from "googleapis";

export function mustEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return v;
  }
  throw new Error(`Missing env ${names.join(" or ")}`);
}

export function getServiceAccountJson() {
  // bạn nói bạn để base64 => ưu tiên GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (b64 && String(b64).trim()) {
    const jsonText = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(jsonText);
  }

  // fallback: để thẳng JSON (không khuyến khích nhưng vẫn hỗ trợ)
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && String(raw).trim()) return JSON.parse(raw);

  throw new Error("Missing env GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (or GOOGLE_SERVICE_ACCOUNT_JSON)");
}

export function sheetsClient() {
  const sa = getServiceAccountJson();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}