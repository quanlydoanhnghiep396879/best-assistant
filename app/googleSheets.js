// lib/googleSheetsClient.js
import { google } from "googleapis";

export async function getSheetsClient() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!base64) {
    throw new Error("GOOGLE_PRIVATE_KEY_BASE64 is empty");
  }
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is empty");
  }

  // Giải mã base64 -> JSON
  let key;
  try {
    const jsonStr = Buffer.from(base64, "base64").toString("utf8");
    key = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY_BASE64 is not valid base64 of Service Account JSON: " +
        err.message
    );
  }

  const auth = new google.auth.JWT(
    key.client_email,
    undefined,
    key.private_key,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  return { sheets, spreadsheetId };
}
