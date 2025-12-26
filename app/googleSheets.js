// lib/googleSheetsClient.js
import { google } from "googleapis";

function getServiceAccountFromEnv() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!base64) {
    throw new Error("GOOGLE_PRIVATE_KEY_BASE64 is not set");
  }
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is not set");
  }

  let keyJson;
  try {
    const jsonStr = Buffer.from(base64, "base64").toString("utf8");
    keyJson = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY_BASE64 is not valid base64 of Service Account JSON: " +
        err.message
    );
  }

  if (!keyJson.client_email || !keyJson.private_key) {
    throw new Error(
      "Service Account JSON is missing client_email or private_key"
    );
  }

  return { keyJson, spreadsheetId };
}

export async function getSheetsClient() {
  const { keyJson, spreadsheetId } = getServiceAccountFromEnv();

  const auth = new google.auth.GoogleAuth({
    credentials: keyJson, // dùng full JSON
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  return { sheets, spreadsheetId };
}
