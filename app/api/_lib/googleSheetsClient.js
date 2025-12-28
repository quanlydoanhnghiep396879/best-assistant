import { google } from "googleapis";

function loadServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (b64) {
    const jsonStr = Buffer.from(b64, "base64").toString("utf8");
    const obj = JSON.parse(jsonStr);
    if (obj.private_key) obj.private_key = obj.private_key.replace(/\\n/g, "\n");
    return obj;
  }

  if (raw) {
    const obj = JSON.parse(raw);
    if (obj.private_key) obj.private_key = obj.private_key.replace(/\\n/g, "\n");
    return obj;
  }

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
}

export async function getSheetsClient() {
  const sa = loadServiceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

export function getSheetIdEnv() {
  // bạn dùng GOOGLE_SHEET_ID (không phải GOOGLE_SHEETS_ID)
  return process.env.GOOGLE_SHEET_ID || "";
}
