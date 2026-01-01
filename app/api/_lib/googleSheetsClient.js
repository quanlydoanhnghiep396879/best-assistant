// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";
import { pickServiceAccount } from "./pickServiceAccount";

// ✅ Tên các sheet lấy từ ENV (nếu không có thì dùng mặc định)
export function sheetNames() {
  return {
    KPI_SHEET_NAME: process.env.KPI_SHEET_NAME || "KPI",
    CONFIG_KPI_SHEET_NAME: process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI",
    MAIL_LOG_SHEET_NAME: process.env.MAIL_LOG_SHEET_NAME || "MAIL_LOG",
  };
}

function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

let _cached = null;

export async function getSheetsClient() {
  if (_cached) return _cached;

  const sa = pickServiceAccount(); // { client_email, private_key }
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error("Missing service account email/private key (ENV not loaded)");
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: SCOPES,
  });

  const sheets = google.sheets({ version: "v4", auth });

  _cached = { sheets, spreadsheetId: getSpreadsheetId() };
  return _cached;
}

// ✅ Đọc dữ liệu A1 range
export async function readValues(rangeA1) {
  const { sheets, spreadsheetId } = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return res?.data?.values || [];
}
