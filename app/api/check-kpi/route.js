// app/api/check-kpi/route.js
import { google } from "googleapis";

export const runtime = "nodejs";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function getConfigFromEnv() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";

  if (!email || !keyBase64 || !sheetId) {
    throw new Error(
      "Thiếu biến môi trường GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SHEET_ID"
    );
  }

  return { email, keyBase64, sheetId, configSheetName };
}

async function getAuthorizedSheets() {
  const { email, keyBase64, sheetId, configSheetName } = getConfigFromEnv();

  // Giải mã private key từ base64
  const privateKey = Buffer.from(keyBase64, "base64").toString("utf8");

  // Tạo JWT client
  const client = new google.auth.JWT(email, undefined, privateKey, SCOPES);

  // BẮT BUỘC phải authorize, nếu không sẽ ra lỗi "unregistered callers"
  await client.authorize();

  const sheets = google.sheets({ version: "v4", auth: client });

  return { sheets, sheetId, configSheetName };
}

async function readConfigDates() {
  const { sheets, sheetId, configSheetName } = await getAuthorizedSheets();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${configSheetName}!A2:B`, // cột A = DATE, cột B = RANGE
  });

  const rows = res.data.values || [];

  // rows: [ [ '23/12/2025', 'KPI!A21:AJ37' ], [ '24/12/2025', 'KPI!A4:AJ18' ], ... ]
  const dates = rows
    .map((r) => (r[0] || "").toString().trim())
    .filter((d) => d.length > 0);

  return { dates, rawRows: rows };
}

export async function GET() {
  try {
    const { dates, rawRows } = await readConfigDates();

    return new Response(
      JSON.stringify({
        status: "success",
        dates,
        configRows: rawRows,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("❌ CHECK-KPI API ERROR:", err);
    return new Response(
      JSON.stringify({
        status: "error",
        message: String(err.message || err),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
