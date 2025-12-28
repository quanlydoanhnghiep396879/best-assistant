import { google } from "googleapis";

function getServiceAccount() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (rawJson && rawJson.trim()) {
    try {
      return JSON.parse(rawJson);
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON parse lỗi (JSON không hợp lệ).");
    }
  }

  if (b64 && b64.trim()) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      return JSON.parse(decoded);
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_BASE64 decode/parse lỗi.");
    }
  }

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
}

export function getSheetsClient() {
  const sheetId = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEETS_ID; // fallback nếu lỡ đặt tên cũ
  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const sa = getServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: (sa.private_key || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, sheetId };
}
