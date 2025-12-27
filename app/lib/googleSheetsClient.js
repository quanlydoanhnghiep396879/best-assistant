// app/lib/googleSheetsClient.js
import { google } from "googleapis";

/** Convert Google/Excel serial date -> dd/mm/yyyy */
function serialToDMY(serial) {
  // Google Sheets/Excel date serial base: 1899-12-30
  const base = new Date(Date.UTC(1899, 11, 30));
  const ms = Number(serial) * 24 * 60 * 60 * 1000;
  const d = new Date(base.getTime() + ms);

  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDateValue(v) {
  if (v == null) return "";
  // nếu là số kiểu 46014
  if (typeof v === "number") return serialToDMY(v);

  const s = String(v).trim();
  // nếu là string số "46014"
  if (/^\d{4,6}$/.test(s)) return serialToDMY(Number(s));
  // nếu đã là dd/mm/yyyy thì giữ nguyên
  return s;
}

function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");

  const json = Buffer.from(base64, "base64").toString("utf8");
  const keyFile = JSON.parse(json);
  return keyFile;
}

function getSheetsClient() {
  const keyFile = getServiceAccountKeyFile();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Thiếu env GOOGLE_SHEET_ID");

  const auth = new google.auth.JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

/** Đọc 1 range bất kỳ trong Google Sheet */
export async function readSheetRange(range, opts = {}) {
  const { sheets, spreadsheetId } = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: opts.valueRenderOption || "FORMATTED_VALUE",
    dateTimeRenderOption: opts.dateTimeRenderOption || "FORMATTED_STRING",
  });

  return res.data.values || [];
}

/** Đọc cấu hình ngày / range trong sheet CONFIG_KPI */
export async function readConfigRanges() {
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";

  // đọc rộng để lấy cả header
  const rows = await readSheetRange(`${configSheetName}!A1:B500`, {
    valueRenderOption: "FORMATTED_VALUE",
  });

  if (!rows.length) return [];

  // detect header
  const h0 = String(rows[0]?.[0] || "").trim().toUpperCase();
  const h1 = String(rows[0]?.[1] || "").trim().toUpperCase();
  const hasHeader = h0.includes("DATE") && h1.includes("RANGE");

  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .filter((r) => r && r[0] && r[1])
    .map((r) => ({
      date: normalizeDateValue(r[0]), // "24/12/2025" hoặc "46014" -> normalize
      range: String(r[1]).trim(),     // "KPI!A3:AJ18"
    }));
}
