// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

// ====== đọc service account từ ENV (nhiều kiểu) ======
// Ưu tiên 1: GOOGLE_SERVICE_ACCOUNT_JSON (json string)
// Ưu tiên 2: GOOGLE_SERVICE_ACCOUNT_BASE64 (base64 json)
// Ưu tiên 3: GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY

function loadServiceAccount() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.trim()) {
    try {
      return JSON.parse(rawJson);
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ");
    }
  }

  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (b64 && b64.trim()) {
    try {
      const jsonStr = Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(jsonStr);
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_BASE64 không decode/parse được");
    }
  }

  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  let private_key = process.env.GOOGLE_PRIVATE_KEY;

  if (client_email && private_key) {
    // Vercel thường lưu key dạng \n -> phải replace
    private_key = private_key.replace(/\\n/g, "\n");
    return { client_email, private_key };
  }

  throw new Error(
    "Thiếu ENV Service Account. Cần 1 trong: GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SERVICE_ACCOUNT_BASE64 / (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY)"
  );
}

// cache client để khỏi tạo lại nhiều lần
let _cached = null;

export default async function getSheetsClient() {
  if (_cached) return _cached;

  const sa = loadServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  // test auth (optional, nhưng giúp bắt lỗi key nhanh)
  await auth.authorize();

  // Đây mới là “Sheets client” đúng kiểu có spreadsheets.values.get
  const sheets = google.sheets({ version: "v4", auth });

  _cached = sheets;
  return sheets;
}