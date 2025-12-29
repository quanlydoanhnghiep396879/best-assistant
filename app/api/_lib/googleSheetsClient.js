import { google } from "googleapis";

let _sheets = null;

/** Lấy env bắt buộc */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Lấy env theo nhiều tên (đỡ bị lệch tên biến) */
function requireEnvAny(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env: ${names.join(" or ")}`);
}

/** Chuẩn hoá private key (base64 hoặc raw) về PEM hợp lệ */
function loadPrivateKeyPem() {
  // Ưu tiên base64
  const b64 = process.env.GOOGLE_PRIVATE_KEY_BASE64 || process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    const pem = Buffer.from(b64, "base64").toString("utf8");
    return sanitizePem(pem);
  }

  // Fallback raw PEM
  const raw = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY_PEM;
  if (raw) return sanitizePem(raw);

  throw new Error(
    "Missing env: GOOGLE_PRIVATE_KEY_BASE64 (recommended) or GOOGLE_PRIVATE_KEY"
  );
}

/** Loại bỏ nháy, sửa \\n thành \n, trim... */
function sanitizePem(s) {
  let out = String(s).trim();

  // Nếu ai đó lỡ copy có dấu " ở đầu/cuối
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1);
  }

  // Vercel thường lưu \n dạng chuỗi -> chuyển thành newline thật
  out = out.replace(/\\n/g, "\n").trim();

  return out;
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  // hỗ trợ cả 2 kiểu đặt tên email
  const clientEmail = requireEnvAny([
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_CLIENT_EMAIL",
  ]);

  const privateKey = loadPrivateKeyPem();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  // Gọi authorize để phát hiện lỗi key ngay tại đây (dễ debug)
  await auth.authorize();

  const sheets = google.sheets({ version: "v4", auth });
  _sheets = sheets;
  return sheets;
}

export async function readRangeA1(a1Range, opts = {}) {
  const sheets = await getSheetsClient();
  const spreadsheetId = requireEnvAny(["GOOGLE_SHEET_ID", "GOOGLE_SPREADSHEET_ID"]);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1Range,
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: opts.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res.data.values || [];
}

// Parse dd/mm/yyyy -> time
export function parseVNDateToTime(s) {
  if (!s) return 0;
  const [dd, mm, yyyy] = String(s).split("/").map((x) => parseInt(x, 10));
  if (!dd || !mm || !yyyy) return 0;
  return new Date(yyyy, mm - 1, dd).getTime();
}