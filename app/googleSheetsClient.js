import "server-only";
import { google } from "googleapis";

/** Lấy key JSON từ biến GOOGLE_PRIVATE_KEY_BASE64 (đã encode bằng base64) */
function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");

  let json;
  try {
    json = Buffer.from(base64, "base64").toString("utf8");
  } catch {
    throw new Error("GOOGLE_PRIVATE_KEY_BASE64 không phải chuỗi base64 hợp lệ");
  }

  let keyFile;
  try {
    keyFile = JSON.parse(json);
  } catch {
    throw new Error("GOOGLE_PRIVATE_KEY_BASE64 giải mã được nhưng không phải JSON");
  }

  return keyFile;
}

/** Tạo client Google Sheets dùng service account */
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
export async function readSheetRange(range) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

/** Đọc cấu hình ngày / range trong sheet CONFIG_KPI */
export async function readConfigRanges() {
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
  const rows = await readSheetRange(`${configSheetName}!A2:B200`);

  return (rows || [])
    .filter((r) => r?.[0] && r?.[1])
    .map((r) => ({
      date: String(r[0]).trim(),
      range: String(r[1]).trim(),
    }));
}

/** ✅ Export default để route import chắc chắn */
const sheetsClient = { readSheetRange, readConfigRanges };
export default sheetsClient;
