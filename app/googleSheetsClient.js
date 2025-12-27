import "server-only";
import { google } from "googleapis";

export const __MODULE_ID = "googleSheetsClient_OK_2025_12_27";

function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");

  const json = Buffer.from(base64, "base64").toString("utf8");
  const keyFile = JSON.parse(json);
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

export async function readSheetRange(range) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

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

export default { readSheetRange, readConfigRanges, getSheetsClient, __MODULE_ID };
