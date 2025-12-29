import { google } from "googleapis";

let _sheets = null;

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  const clientEmail = requireEnv("GOOGLE_CLIENT_EMAIL");
  const privateKeyRaw = requireEnv("GOOGLE_PRIVATE_KEY");
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

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
    // Quan trọng: lấy dạng hiển thị để DATE ra "23/12/2025" thay vì 46014
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
