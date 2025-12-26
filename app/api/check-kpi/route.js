import { NextResponse } from "next/server";
import { google } from "googleapis";

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Thiếu biến môi trường ${name}`);
  }
  return v;
}

async function createSheetsClient() {
  const email = getEnvOrThrow("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const keyBase64 = getEnvOrThrow("GOOGLE_PRIVATE_KEY_BASE64");

  // Giải mã base64 -> PEM
  const privateKey = Buffer.from(keyBase64, "base64").toString("utf8");

  const auth = new google.auth.JWT(
    email,
    undefined,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );

  return google.sheets({ version: "v4", auth });
}

export async function GET(req) {
  console.log("CHECK-KPI GET:", req.url);

  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date"); // có thể null

    const sheets = await createSheetsClient();

    const spreadsheetId   = getEnvOrThrow("GOOGLE_SHEET_ID");
    const configSheetName = getEnvOrThrow("CONFIG_KPI_SHEET_NAME");
    const kpiSheetName    = getEnvOrThrow("KPI_SHEET_NAME");

    // 1) Đọc bảng CONFIG_KPI
    const configRange = `${configSheetName}!A2:B`;
    console.log("Đọc CONFIG_KPI range:", configRange);

    const configRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: configRange,
    });

    const rows = configRes.data.values || [];
    const dateRangeMap = new Map();
    const dates = [];

    for (const row of rows) {
      const [cfgDate, cfgRange] = row;
      if (!cfgDate || !cfgRange) continue;
      dates.push(cfgDate);
      dateRangeMap.set(cfgDate, cfgRange);
    }

    // Nếu frontend chỉ hỏi danh sách ngày
    if (!date) {
      return NextResponse.json({ status: "success", dates });
    }

    // 2) Có date -> tìm range tương ứng
    const kpiRange = dateRangeMap.get(date);
    if (!kpiRange) {
      throw new Error(
        `Không tìm thấy RANGE cho ngày ${date} trong CONFIG_KPI.`
      );
    }

    console.log("Đọc KPI range:", kpiRange);

    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: kpiRange,
    });

    const kpiRows = kpiRes.data.values || [];
    // Ở đây anh trả thẳng raw dữ liệu, lát frontend muốn parse thế nào thì parse
    return NextResponse.json({
      status: "success",
      date,
      range: kpiRange,
      rows: kpiRows,
    });
  } catch (err) {
    console.error("CHECK-KPI ERROR:", err);
    return NextResponse.json(
      {
        status: "error",
        message: err.message || String(err),
      },
      { status: 500 }
    );
  }
}
