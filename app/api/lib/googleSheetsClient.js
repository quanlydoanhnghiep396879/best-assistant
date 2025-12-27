// app/api/lib/googleSheetsClient.js
import { google } from "googleapis";

let _sheets = null;

function getServiceAccount() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const rawB64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  let obj = null;

  if (rawJson) {
    obj = JSON.parse(rawJson);
  } else if (rawB64) {
    const decoded = Buffer.from(rawB64, "base64").toString("utf8");
    obj = JSON.parse(decoded);
  } else {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64"
    );
  }

  // fix private_key newline
  if (obj.private_key && obj.private_key.includes("\\n")) {
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  }
  return obj;
}

export async function getSheetsClient() {
  if (_sheets) return _sheets;

  const sa = getServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export async function readSheetRange(range, opts = {}) {
  const sheets = await getSheetsClient();

  const spreadsheetId =
    process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID || "";

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEET_ID (or SHEET_ID)");
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
  });

  return res.data.values || [];
}

// Google Sheets serial date -> dd/mm/yyyy
function serialToDDMMYYYY(serial) {
  // Google uses 1899-12-30 as day 0
  const base = new Date(Date.UTC(1899, 11, 30));
  const ms = base.getTime() + Number(serial) * 24 * 60 * 60 * 1000;
  const d = new Date(ms);

  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function readConfigRanges() {
  const cfgSheet = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";

  // đọc A:B (DATE, RANGE)
  const values = await readSheetRange(`${cfgSheet}!A:B`, {
    valueRenderOption: "FORMATTED_VALUE",
  });

  if (!values.length) return [];

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    let date = (r[0] ?? "").toString().trim();
    const range = (r[1] ?? "").toString().trim();

    if (!date || !range) continue;

    // nếu date bị trả về dạng số serial
    if (/^\d+(\.\d+)?$/.test(date)) {
      date = serialToDDMMYYYY(date);
    }

    rows.push({ date, range });
  }

  return rows;
}
