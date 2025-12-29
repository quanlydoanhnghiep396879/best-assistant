import { google } from "googleapis";

let _sheets = null;

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizePem(pem) {
  let s = String(pem).trim();

  // bỏ dấu nháy nếu lỡ copy dính "...."
  s = s.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");

  // nếu đang là dạng có \n
  s = s.replace(/\\n/g, "\n");

  return s.trim();
}

// Ưu tiên: nếu env chứa PEM trực tiếp -> dùng luôn
// Nếu không có PEM -> coi là base64 và decode
function getPrivateKeyPem() {
  const raw = requireEnv("GOOGLE_PRIVATE_KEY_BASE64");

  // Nếu bạn vô tình dán PEM thẳng vào biến BASE64, vẫn xử lý được
  if (raw.includes("BEGIN") && raw.includes("PRIVATE KEY")) {
    const pem = normalizePem(raw);
    if (!pem.includes("BEGIN") || !pem.includes("END")) {
      throw new Error("Private key PEM không hợp lệ");
    }
    return pem;
  }

  // base64
  const b64 = raw.replace(/\s+/g, "");
  let pem = Buffer.from(b64, "base64").toString("utf8");
  pem = normalizePem(pem);

  // Google JWT thường cần PKCS8: -----BEGIN PRIVATE KEY-----
  if (!pem.includes("BEGIN PRIVATE KEY") || !pem.includes("END PRIVATE KEY")) {
    // Nếu ra RSA PRIVATE KEY (PKCS1) thì OpenSSL3 hay lỗi
    if (pem.includes("BEGIN RSA PRIVATE KEY")) {
      throw new Error(
        "Key đang là 'BEGIN RSA PRIVATE KEY' (PKCS1). Hãy đổi sang PKCS8 'BEGIN PRIVATE KEY' rồi base64 lại."
      );
    }
    throw new Error("GOOGLE_PRIVATE_KEY_BASE64 decode ra không phải PEM PRIVATE KEY hợp lệ");
  }

  return pem;
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  const clientEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = getPrivateKeyPem();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export async function readRangeA1(a1Range, opts = {}) {
  const sheets = await getSheetsClient();
  const spreadsheetId = requireEnv("GOOGLE_SHEET_ID");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1Range,
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: opts.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res.data.values || [];
}