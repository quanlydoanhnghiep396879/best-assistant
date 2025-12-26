// app/api/check-kpi/route.js
import { google } from "googleapis";

export const runtime = "nodejs";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// ==== ĐỌC CONFIG TỪ ENV ====
function getConfigFromEnv() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";

  // Ưu tiên dùng GOOGLE_PRIVATE_KEY (raw), nếu không có thì fallback sang BASE64
  const keyRaw = process.env.GOOGLE_PRIVATE_KEY;
  const keyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;

  let privateKey = "";

  if (keyRaw && keyRaw.trim() !== "") {
    // Nếu trong env có dạng \n thì đổi về xuống dòng thật
    privateKey = keyRaw.replace(/\\n/g, "\n");
  } else if (keyBase64 && keyBase64.trim() !== "") {
    privateKey = Buffer.from(keyBase64, "base64").toString("utf8");
  }

  if (!email || !sheetId || !privateKey) {
    throw new Error(
      "Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SHEET_ID / GOOGLE_PRIVATE_KEY(_BASE64)"
    );
  }

  return { email, sheetId, privateKey, configSheetName };
}

// ==== TẠO CLIENT GOOGLE SHEETS ĐÃ AUTH ====
async function getAuthorizedSheets() {
  const { email, sheetId, privateKey, configSheetName } = getConfigFromEnv();

  const client = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: SCOPES,
  });

  // authorize bắt buộc – nếu thiếu sẽ bị lỗi unregistered callers
  await client.authorize();

  const sheets = google.sheets({ version: "v4", auth: client });
  return { sheets, sheetId, configSheetName };
}

// ==== ĐỌC BẢNG CONFIG_KPI!A2:B... ====
async function readConfigDates() {
  const { sheets, sheetId, configSheetName } = await getAuthorizedSheets();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${configSheetName}!A2:B`,
  });

  const rows = res.data.values || [];

  const dates = rows
    .map((r) => (r[0] || "").toString().trim())
    .filter((d) => d.length > 0);

  return { dates, rawRows: rows };
}

// ==== API GET /api/check-kpi ====
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
