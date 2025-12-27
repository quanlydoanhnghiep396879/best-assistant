import { google } from "googleapis";

/** Decode service account JSON từ base64 */
function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");

  let jsonStr = Buffer.from(base64, "base64").toString("utf8");

  let keyFile;
  try {
    keyFile = JSON.parse(jsonStr);
  } catch {
    throw new Error("GOOGLE_PRIVATE_KEY_BASE64 giải mã được nhưng không phải JSON");
  }

  // Fix private_key bị \\n
  if (typeof keyFile.private_key === "string") {
    keyFile.private_key = keyFile.private_key.replace(/\\n/g, "\n");
  }

  return keyFile;
}

/** Tạo Google Sheets client */
export function getSheetsClient() {
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

/** Đọc 1 range bất kỳ */
export async function readSheetRange(range) {
  const { sheets, spreadsheetId } = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return res.data.values || [];
}

/** Đọc cấu hình DATE/RANGE trong CONFIG_KPI */
export async function readConfigRanges() {
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
  const rows = await readSheetRange(`${configSheetName}!A2:B200`);

  return (rows || [])
    .filter((r) => r?.[0] && r?.[1])
    .map((r) => ({
      date: String(r[0]).trim(),   // "24/12/2025"
      range: String(r[1]).trim(),  // "KPI!A3:AJ18"
    }));
}

/** Export default để tránh lỗi import sai kiểu */
export default {
  getSheetsClient,
  readSheetRange,
  readConfigRanges,
};
