import { google } from "googleapis";

let _sheets = null;

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function decodePrivateKeyFromEnv() {
  const raw = requireEnv("GOOGLE_PRIVATE_KEY_BASE64");

  // base64 đôi khi có xuống dòng/spaces → bỏ hết whitespace
  const b64 = raw.replace(/\s+/g, "");

  let pem = Buffer.from(b64, "base64").toString("utf8");

  // đề phòng bạn đã lưu dạng có \\n
  pem = pem.replace(/\\n/g, "\n");

  // check nhanh format
  if (!pem.includes("BEGIN PRIVATE KEY") || !pem.includes("END PRIVATE KEY")) {
    throw new Error("GOOGLE_PRIVATE_KEY_BASE64 decode ra không phải PEM PRIVATE KEY hợp lệ");
  }

  return pem;
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  // Nhớ: env name phải khớp đúng cái bạn set trên Vercel
  const clientEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = decodePrivateKeyFromEnv();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  _sheets = sheets;
  return sheets;
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

// Parse dd/mm/yyyy
export function parseVNDateToTime(s) {
  if (!s) return 0;
  const [dd, mm, yyyy] = String(s).split("/").map((x) => parseInt(x, 10));
  if (!dd || !mm || !yyyy) return 0;
  return new Date(yyyy, mm - 1, dd).getTime();
}