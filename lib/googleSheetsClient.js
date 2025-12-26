// app/lib/googleSheetsClient.js
import { google } from 'googleapis';

let cachedClient = null;

export async function getSheetsClient() {
  if (cachedClient) return cachedClient;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const keyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;

  if (!sheetId || !keyBase64) {
    throw new Error(
      'Thiếu GOOGLE_SHEET_ID hoặc GOOGLE_PRIVATE_KEY_BASE64 trong env'
    );
  }

  // Giải mã base64 -> JSON service account
  let creds;
  try {
    const jsonText = Buffer.from(keyBase64, 'base64').toString('utf8');
    creds = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY_BASE64 không phải JSON hợp lệ. Kiểm tra lại chuỗi base64.'
    );
  }

  // Tạo auth từ JSON service account
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  cachedClient = { sheets, spreadsheetId: sheetId };
  return cachedClient;
}
