// app/api/_lib/googleSheetsClient.js
import { google } from "googleapis";

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (raw && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      // nếu bạn paste JSON có xuống dòng sai -> thử replace \n
      return JSON.parse(raw.replace(/\\n/g, "\n"));
    }
  }

  if (b64 && b64.trim()) {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  }

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
}

export async function getSheetsClient() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID");

  const sa = getServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

export async function readSheetRange(range) {
  const { sheets, spreadsheetId } = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    // QUAN TRỌNG: để DATE trả về dạng 24/12/2025 (không bị 46014)
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}

export async function readConfigRanges() {
  const configSheet = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
  const range = `${configSheet}!A1:B200`;

  const values = await readSheetRange(range);

  // values: [ ["DATE","RANGE"], ["23/12/2025","KPI!A20:AZ37"], ...]
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const date = (values[i]?.[0] || "").toString().trim();
    const r = (values[i]?.[1] || "").toString().trim();
    if (!date || !r) continue;
    rows.push({ date, range: r });
  }

  return rows;
}
