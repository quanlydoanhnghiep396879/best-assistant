// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

/** Hỗ trợ env JSON thường hoặc base64 */
function parseServiceAccount() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT ||
    "";

  if (!raw) {
    throw new Error(
      "Missing env GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT)"
    );
  }

  // thử parse trực tiếp
  try {
    return JSON.parse(raw);
  } catch (_) {
    // thử base64
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    return JSON.parse(decoded);
  }
}

export function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEET_ID; // ✅ bạn muốn tên này
  if (!id) throw new Error("Missing env GOOGLE_SHEET_ID");
  return id;
}

export async function getSheetsClient() {
  const sa = parseServiceAccount();

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: sa.client_email,
      private_key: sa.private_key,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

/**
 * Lấy values từ A1 range. Ví dụ: "KPI!A1:ZZ2000"
 */
export async function getValues(rangeA1) {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}