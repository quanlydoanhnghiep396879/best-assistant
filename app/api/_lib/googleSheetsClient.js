import { google } from "googleapis";

let _sheets = null;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function pickEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return { name: n, value: v };
  }
  throw new Error(`Missing env: ${names.join(" or ")}`);
}

function decodeMaybeBase64ToUtf8(s) {
  const t = String(s).trim();

  // Nếu đã là JSON hoặc PEM thì trả luôn
  if (t.startsWith("{") || t.includes("BEGIN PRIVATE KEY") || t.includes("BEGIN RSA PRIVATE KEY")) {
    return t;
  }

  // Còn lại: coi như base64
  return Buffer.from(t, "base64").toString("utf8");
}

function normalizePrivateKey(pemOrRaw) {
  return String(pemOrRaw)
    .replace(/\r/g, "")        // bỏ CR
    .replace(/\\n/g, "\n")     // chuyển '\n' thành newline thật
    .trim();
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  // --- Ưu tiên: dùng service account JSON (base64 hoặc json text) ---
  const saEnv =
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let clientEmail = "";
  let privateKey = "";

  if (saEnv) {
    const jsonText = decodeMaybeBase64ToUtf8(saEnv);
    const creds = JSON.parse(jsonText);

    clientEmail = String(creds.client_email || "").trim();
    privateKey = normalizePrivateKey(creds.private_key || "");

    if (!clientEmail) throw new Error("Service account JSON missing client_email");
    if (!privateKey) throw new Error("Service account JSON missing private_key");
  } else {
    // --- Fallback: tách riêng email + key ---
    const emailPick = pickEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_CLIENT_EMAIL");
    const keyPick = pickEnv("GOOGLE_PRIVATE_KEY_BASE64", "GOOGLE_PRIVATE_KEY");

    clientEmail = String(emailPick.value).trim();

    const keyText = decodeMaybeBase64ToUtf8(keyPick.value);
    privateKey = normalizePrivateKey(keyText);
  }

  // Check PEM header
  if (!privateKey.includes("BEGIN")) {
    throw new Error("Private key decoded but missing PEM header (BEGIN ... PRIVATE KEY). Check env value.");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  // force check key now (để bắt lỗi rõ ràng)
  await auth.authorize();

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export async function readRangeA1(a1Range, opts = {}) {
  const sheets = await getSheetsClient();
  const spreadsheetId = requireEnv("GOOGLE_SHEET_ID").trim();

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