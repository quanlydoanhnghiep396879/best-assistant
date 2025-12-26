// app/lib/googleSheetsClient.js
import { google } from 'googleapis';

let cachedClient = null;

export async function getSheetsClient() {
  if (cachedClient) return cachedClient;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const emailEnv = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (!sheetId) {
    throw new Error('Thiếu GOOGLE_SHEET_ID');
  }
  if (!base64) {
    throw new Error('Thiếu GOOGLE_PRIVATE_KEY_BASE64');
  }

  // ===== Giải mã base64 =====
  const decoded = Buffer.from(base64, 'base64').toString('utf8');

  let clientEmail = emailEnv || null;
  let privateKey = null;

  // 1) Thử coi nó có phải JSON của file service account không
  try {
    const maybeJson = JSON.parse(decoded);
    if (maybeJson.private_key && maybeJson.client_email) {
      privateKey = maybeJson.private_key;
      clientEmail = maybeJson.client_email;
    }
  } catch {
    // không phải JSON → bỏ qua, xử lý ở bước 2
  }

  // 2) Nếu vẫn chưa có privateKey thì coi như base64 là của riêng private_key
  if (!privateKey) {
    privateKey = decoded;
  }

  if (!clientEmail || !privateKey) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY_BASE64 decode được nhưng không tìm thấy client_email/private_key. ' +
        'Hãy kiểm tra lại biến môi trường hoặc copy thiếu chuỗi base64.'
    );
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  cachedClient = { sheets, sheetId };
  return cachedClient;
}
