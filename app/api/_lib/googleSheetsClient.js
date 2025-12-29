import { google } from "googleapis";

let _sheets = null;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getServiceAccount() {
  // Ưu tiên: base64 của toàn bộ JSON service account
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    const jsonText = Buffer.from(b64, "base64").toString("utf8");
    const sa = JSON.parse(jsonText);

    if (!sa.client_email) throw new Error("Service account JSON missing client_email");
    if (!sa.private_key) throw new Error("Service account JSON missing private_key");

    // Vercel đôi khi lưu \n thành \\n
    sa.private_key = String(sa.private_key).replace(/\\n/g, "\n").trim();
    return sa;
  }

  // Fallback nếu bạn muốn giữ kiểu cũ
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyB64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;

  if (clientEmail && privateKeyB64) {
    const key = Buffer.from(privateKeyB64, "base64").toString("utf8").replace(/\\n/g, "\n").trim();
    return { client_email: clientEmail, private_key: key };
  }

  throw new Error("Missing env: GOOGLE_SERVICE_ACCOUNT_BASE64 (recommended)");
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  const sa = getServiceAccount();

  // kiểm tra nhanh PEM
  if (!sa.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Invalid private_key: not a PEM key (BEGIN PRIVATE KEY not found)");
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
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