// app/lib/googleSheetsClient.js
import { google } from 'googleapis';

let cachedClient = null;

export async function getSheetsClient() {
  if (cachedClient) return cachedClient;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const keyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (!spreadsheetId || !keyBase64 || !serviceEmail) {
    throw new Error(
      'Thiếu GOOGLE_SHEET_ID / GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SERVICE_ACCOUNT_EMAIL trong env'
    );
  }

  // Giải mã base64 -> JSON
  let creds;
  try {
    const jsonText = Buffer.from(keyBase64, 'base64').toString('utf8');
    creds = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY_BASE64 không phải là base64 của file JSON Service Account.'
    );
  }

  const jwt = new google.auth.JWT(
    creds.client_email || serviceEmail,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );

  await jwt.authorize();

  const sheets = google.sheets({
    version: 'v4',
    auth: jwt,
  });

  cachedClient = { sheets, spreadsheetId };
  return cachedClient;
}
