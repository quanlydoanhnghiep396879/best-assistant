import { google } from "googleapis";

function loadServiceAccountFromEnv() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let jsonText = null;

  if (b64 && String(b64).trim()) {
    try {
      jsonText = Buffer.from(String(b64).trim(), "base64").toString("utf8");
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_BASE64 decode failed");
    }
  } else if (raw && String(raw).trim()) {
    jsonText = String(raw).trim();
  } else {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
  }

  let cred;
  try {
    cred = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("Service account JSON parse failed");
  }

  // Fix private_key \n
  if (cred.private_key && typeof cred.private_key === "string") {
    cred.private_key = cred.private_key.replace(/\\n/g, "\n");
  }

  return cred;
}

export function getSpreadsheetId() {
  // hỗ trợ cả tên cũ nếu bạn lỡ set
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

export async function getSheetsClient() {
  const credentials = loadServiceAccountFromEnv();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

export async function readRange(range, opts = {}) {
  const spreadsheetId = getSpreadsheetId();
  const sheets = await getSheetsClient();

  const valueRenderOption = opts.valueRenderOption || "UNFORMATTED_VALUE"; // số/percent dạng số
  const dateTimeRenderOption = opts.dateTimeRenderOption || "FORMATTED_STRING";

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption,
    dateTimeRenderOption,
  });

  return res.data.values || [];
}
