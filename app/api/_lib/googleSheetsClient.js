import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeServiceAccount() {
  const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (jsonRaw && jsonRaw.trim()) {
    return JSON.parse(jsonRaw);
  }
  if (b64 && b64.trim()) {
    const txt = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(txt);
  }
  throw new Error(
    "Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64"
  );
}

export function getSheetsClient() {
  const creds = decodeServiceAccount();

  // Fix private_key newline nếu env làm mất \n
  if (typeof creds.private_key === "string" && creds.private_key.includes("\\n")) {
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  }


  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function readRange(spreadsheetId, range) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  
  return res.data.values || [];
}
