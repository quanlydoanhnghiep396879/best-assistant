// app/lib/googleSheetsClient.js
import { google } from "googleapis";

let cachedSheets = null;

/**
 * Lấy client Google Sheets dùng Service Account (dùng base64 JSON).
 */
export async function getSheetsClient() {
  if (cachedSheets) return cachedSheets;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;

  if (!sheetId || !email || !keyBase64) {
    throw new Error(
      "Thiếu GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY_BASE64"
    );
  }

  let keyJson;
  try {
    // Giải mã base64 -> JSON
    const jsonStr = Buffer.from(keyBase64, "base64").toString("utf8");
    keyJson = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY_BASE64 không phải là base64 của file JSON Service Account: " +
        err.message
    );
  }

  // (không bắt buộc, chỉ để cảnh báo)
  if (keyJson.client_email && keyJson.client_email !== email) {
    console.warn(
      "Cảnh báo: GOOGLE_SERVICE_ACCOUNT_EMAIL khác client_email trong file JSON."
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  // Lấy client trước, nếu lỗi sẽ ném lỗi luôn ở đây
  const authClient = await auth.getClient();

  cachedSheets = google.sheets({
    version: "v4",
    auth: authClient,
  });

  return cachedSheets;
}

/**
 * Đọc 1 range trong Google Sheet.
 */
export async function readSheetRange(range) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return res.data.values || [];
}
