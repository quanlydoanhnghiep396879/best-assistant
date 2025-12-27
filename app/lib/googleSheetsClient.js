// app/lib/googleSheetsClient.js
import { google } from "googleapis";

function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");

  const json = Buffer.from(base64, "base64").toString("utf8");
  const keyFile = JSON.parse(json);

  // rất hay bị \n dạng string khi copy
  if (keyFile.private_key && typeof keyFile.private_key === "string") {
    keyFile.private_key = keyFile.private_key.replace(/\\n/g, "\n");
  }
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

export async function readSheetRange(range) {
  const { sheets, spreadsheetId } = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}

// convert serial date kiểu 46014 -> dd/mm/yyyy (Google date serial: 1899-12-30)
function serialToDMY(serial) {
  const base = Date.UTC(1899, 11, 30);
  const ms = base + Number(serial) * 86400000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDateStr(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";

  // nếu là serial date
  if (/^\d{4,6}$/.test(s)) return serialToDMY(s);

  // nếu dạng yyyy-mm-dd
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m1) {
    const yyyy = m1[1];
    const mm = m1[2].padStart(2, "0");
    const dd = m1[3].padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  // nếu dạng dd/mm/yyyy hoặc d/m/yyyy
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const dd = m2[1].padStart(2, "0");
    const mm = m2[2].padStart(2, "0");
    const yyyy = m2[3];
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
}

export async function readConfigRanges() {
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
  // A=DATE, B=RANGE
  const rows = await readSheetRange(`${configSheetName}!A2:B200`);

  return (rows || [])
    .filter((r) => r && r[0] && r[1])
    .map((r) => ({
      date: normalizeDateStr(r[0]),
      range: String(r[1]).trim(),
    }));
}
