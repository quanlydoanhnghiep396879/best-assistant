// app/lib/googleSheetsClient.js
import { google } from 'googleapis';

let cachedClient = null;

export async function getSheetsClient() {
  if (cachedClient) return cachedClient;

  const sheetId   = process.env.GOOGLE_SHEET_ID;
  const keyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const svcEmail  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (!sheetId || !keyBase64 || !svcEmail) {
    throw new Error(
      'Thiếu GOOGLE_SHEET_ID / GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SERVICE_ACCOUNT_EMAIL trong env'
    );
  }

  let creds;
  try {
    const jsonText = Buffer.from(keyBase64, 'base64').toString('utf8');
    creds = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY_BASE64 không phải JSON hợp lệ (base64 của file .json service account).'
    );
  }

  const jwt = new google.auth.JWT(
    creds.client_email || svcEmail,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );

  await jwt.authorize();

  const sheets = google.sheets({
    version: 'v4',
    auth: jwt,
  });

  cachedClient = { sheets, spreadsheetId: sheetId };
  return cachedClient;
}
