// lib/googleSheetsClient.js
import { google } from "googleapis";

/**
 * Đọc JSON service account từ biến môi trường GOOGLE_PRIVATE_KEY_BASE64
 * và trả về client Sheets + spreadsheetId
 */
function getServiceAccountFromEnv() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!base64) {
    throw new Error("ENV_MISSING: GOOGLE_PRIVATE_KEY_BASE64");
  }
  if (!spreadsheetId) {
    throw new Error("ENV_MISSING: GOOGLE_SHEET_ID");
  }

  let keyJson;
  try {
    const jsonStr = Buffer.from(base64, "base64").toString("utf8");
    keyJson = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      "ENV_INVALID_BASE64: " + err.message
    );
  }

  if (!keyJson.client_email || !keyJson.private_key) {
    throw new Error(
      "ENV_BAD_JSON: missing client_email or private_key"
    );
  }

  return { keyJson, spreadsheetId };
}

export async function getSheetsClient() {
  const { keyJson, spreadsheetId } = getServiceAccountFromEnv();

  // Dùng trực tiếp JWT thay vì GoogleAuth → không còn message "No key or keyFile set"
  const auth = new google.auth.JWT(
    keyJson.client_email,
    undefined,
    keyJson.private_key,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  return { sheets, spreadsheetId };
}
