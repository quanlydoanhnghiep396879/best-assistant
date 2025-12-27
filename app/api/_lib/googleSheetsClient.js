import { google } from "googleapis";

function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");

  const jsonStr = Buffer.from(base64, "base64").toString("utf8");

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

/**
 * Đọc range Google Sheet.
 * Mặc định UNFORMATTED để số liệu là number chuẩn.
 */
export async function readSheetRange(range) {
  const { sheets, spreadsheetId } = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE", // ✅ giữ number chuẩn
  });

  return res.data.values || [];
}

/**
 * Convert serial date (Google Sheets/Excel) -> dd/mm/yyyy
 * Lưu ý base date: 1899-12-30 (chuẩn cho Excel/Sheets)
 */
function serialToDMY(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return String(serial);

  const epoch = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(epoch.getTime() + n * 86400000);

  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Đọc cấu hình DATE / RANGE trong CONFIG_KPI (A2:B200)
 * - Nếu DATE là serial number (vd 46014) -> convert dd/mm/yyyy
 * - Nếu DATE là text sẵn (vd 24/12/2025) -> giữ nguyên
 */
export async function readConfigRanges() {
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
  const rows = await readSheetRange(`${configSheetName}!A2:B200`);

  return (rows || [])
    .filter((r) => r?.[0] && r?.[1])
    .map((r) => {
      const rawDate = r[0];
      const date =
        typeof rawDate === "number" ? serialToDMY(rawDate) : String(rawDate).trim();

      return {
        date, // "24/12/2025"
        range: String(r[1]).trim(), // "KPI!A3:AJ18"
      };
    });
}

export default { getSheetsClient, readSheetRange, readConfigRanges };
