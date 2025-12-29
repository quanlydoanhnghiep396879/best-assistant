import { google } from "googleapis";

let _sheets = null;

/** Bắt buộc có env */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Lấy env theo nhiều tên (để tương thích nhiều cách đặt biến) */
export function requireEnvAny(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return String(v);
  }
  throw new Error(`Missing env: ${names.join(" OR ")}`);
}

/**
 * Chuẩn hóa private key:
 * - Ưu tiên BASE64 nếu có
 * - Nếu không có base64 thì lấy raw key
 * - Tự thay \\n -> \n
 * - Trim để bỏ khoảng trắng thừa
 */
function loadPrivateKey() {
  // 1) Base64 key
  const b64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (b64 && String(b64).trim() !== "") {
    try {
      const decoded = Buffer.from(String(b64).trim(), "base64").toString("utf8");
      const key = decoded.replace(/\\n/g, "\n").trim();
      if (!key.includes("BEGIN PRIVATE KEY")) {
        throw new Error("Decoded key does not look like a PEM private key");
      }
      return key;
    } catch (e) {
      // lỗi base64 sai format hay có ký tự lạ sẽ rơi vào đây
      throw new Error(
        `GOOGLE_PRIVATE_KEY_BASE64 decode failed: ${e?.message || e}`
      );
    }
  }

  // 2) Raw key
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (raw && String(raw).trim() !== "") {
    const key = String(raw).replace(/\\n/g, "\n").trim();
    if (!key.includes("BEGIN PRIVATE KEY")) {
      throw new Error("GOOGLE_PRIVATE_KEY does not look like a PEM private key");
    }
    return key;
  }

  throw new Error(
    "Missing env: GOOGLE_PRIVATE_KEY_BASE64 or GOOGLE_PRIVATE_KEY"
  );
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  // Email service account
  const clientEmail = requireEnvAny([
    "GOOGLE_CLIENT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  ]);

  // Private key (base64 hoặc raw)
  const privateKey = loadPrivateKey();

  // Sheet ID
  const spreadsheetId = requireEnvAny(["GOOGLE_SHEET_ID", "SPREADSHEET_ID"]);

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  // Gọi authorize để bắt lỗi key/email ngay tại đây
  await auth.authorize();

  const sheets = google.sheets({ version: "v4", auth });

  // cache + cũng giữ lại spreadsheetId để dùng chung
  _sheets = { sheets, spreadsheetId };
  return _sheets;
}

export async function readRangeA1(a1Range, opts = {}) {
  const { sheets, spreadsheetId } = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1Range,
    // Lấy dạng hiển thị để DATE ra "23/12/2025" thay vì 46014
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: opts.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res.data.values || [];
}

// Parse dd/mm/yyyy -> time (ms)
export function parseVNDateToTime(s) {
  if (!s) return 0;
  const [dd, mm, yyyy] = String(s).split("/").map((x) => parseInt(x, 10));
  if (!dd || !mm || !yyyy) return 0;
  return new Date(yyyy, mm - 1, dd).getTime();
}