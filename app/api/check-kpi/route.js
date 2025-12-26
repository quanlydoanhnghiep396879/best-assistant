// app/api/check-kpi/route.js
import { google } from "googleapis";
import { NextResponse } from "next/server";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

/* ====== GOOGLE AUTH ====== */
function getPrivateKey() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const plain = process.env.GOOGLE_PRIVATE_KEY;

  if (base64) {
    return Buffer.from(base64, "base64").toString("utf8");
  }
  if (plain) {
    // nếu để dạng có \n trong .env
    return plain.replace(/\\n/g, "\n");
  }
  throw new Error(
    "Missing GOOGLE_PRIVATE_KEY_BASE64 or GOOGLE_PRIVATE_KEY env"
  );
}

function getJwtClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL env");
  }
  const key = getPrivateKey();

  return new google.auth.JWT(email, undefined, key, SCOPES);
}

async function getSheetsClient() {
  const auth = getJwtClient();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

/* ====== ĐỌC CONFIG_KPI ====== */
async function getConfigRows(sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEET_ID env");
  }

  const configSheet = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${configSheet}!A2:B`, // A: DATE, B: RANGE
  });

  return res.data.values || [];
}

/* ====== PARSE BẢNG KPI CHO 1 NGÀY ====== */
// Tìm dòng header có chữ "DM/NGAY" rồi suy ra các cột
function parseKpi(values) {
  // không có data
  if (!values || !values.length) {
    return { lines: [], raw: values };
  }

  // tìm dòng chứa "DM/NGAY"
  const headerIndex = values.findIndex((row) =>
    row?.some((cell) =>
      String(cell).toUpperCase().includes("DM/NGAY")
    )
  );

  if (headerIndex === -1) {
    // Không tìm được header => trả raw để debug
    return { lines: [], raw: values };
  }

  const headerRow = values[headerIndex];

  const colDmDay = headerRow.findIndex((c) =>
    String(c).toUpperCase().includes("DM/NGAY")
  );
  const colDmHour = headerRow.findIndex((c) =>
    String(c).toUpperCase().includes("DM/H")
  );

  const hourLabels = [
    "9h",
    "10h",
    "11h",
    "12h30",
    "13h30",
    "14h30",
    "15h30",
    "16h30",
  ];

  const hourCols = {};
  hourLabels.forEach((label) => {
    const idx = headerRow.findIndex(
      (c) =>
        String(c).replace(/\s/g, "").toLowerCase() ===
        label.toLowerCase()
    );
    if (idx !== -1) hourCols[label] = idx;
  });

  // dòng data bắt đầu: bỏ qua 1 dòng dưới header (dòng "DM", "H")
  const startRow = headerIndex + 2;
  const lines = [];

  for (let i = startRow; i < values.length; i++) {
    const row = values[i] || [];
    const chuyen = (row[0] || "").toString().trim();

    if (!chuyen) continue;
    // bỏ dòng tổng, dòng khác nếu có
    if (/^(TỔNG|TONG|TOTAL)/i.test(chuyen)) continue;

    const dmDay = Number((row[colDmDay] || "0").toString().replace(/,/g, ""));
    const dmHour = Number((row[colDmHour] || "0").toString().replace(/,/g, ""));

    const hours = hourLabels.map((label) => {
      const col = hourCols[label];
      const actual =
        col !== undefined
          ? Number(
              (row[col] || "0")
                .toString()
                .replace(/,/g, "")
            )
          : 0;
      return { label, actual };
    });

    lines.push({ chuyen, dmDay, dmHour, hours });
  }

  return { lines, raw: values };
}

/* ====== API GET /api/check-kpi ====== */
export async function GET(request) {
  console.log("✅ CHECK KPI API CALLED (GET)");

  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date") || "";

    const sheets = await getSheetsClient();
    const configRows = await getConfigRows(sheets);

    if (!configRows.length) {
      return NextResponse.json({
        status: "error",
        message: "Không có ngày nào trong CONFIG_KPI",
      });
    }

    const dates = configRows.map((r) => r[0]).filter(Boolean);

    // Nếu query ?date=... không khớp thì lấy dòng đầu tiên
    let date = dateParam && dates.includes(dateParam) ? dateParam : dates[0];

    const rangeRow = configRows.find((r) => r[0] === date);
    const range = rangeRow ? rangeRow[1] : null;

    if (!range) {
      return NextResponse.json({
        status: "error",
        message: `Không tìm thấy RANGE cho ngày ${date} trong CONFIG_KPI`,
        dates,
      });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range, // ví dụ: "KPI!A4:AJ18"
    });

    const values = res.data.values || [];
    const parsed = parseKpi(values); // { lines, raw }

    return NextResponse.json({
      status: "success",
      date,
      dates,
      range,
      ...parsed,
    });
  } catch (err) {
    console.error("❌ KPI API ERROR (GET):", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
