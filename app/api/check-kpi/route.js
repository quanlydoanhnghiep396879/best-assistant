// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ====== HÀM PHỤ ====== */

// nhận diện ô có dạng dd/mm/yyyy
function isDateString(v) {
  if (!v) return false;
  const s = String(v).trim();
  return /\d{1,2}\/\d{1,2}\/\d{4}/.test(s);
}

// tìm block dữ liệu theo ngày trong sheet KPI!A1:Z200
function extractBlockForDate(values, targetDate) {
  const dateStr = String(targetDate).trim();
  let dateRow = -1;
  let nextDateRow = values.length;

  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const v0 = row[0];

    if (isDateString(v0)) {
      const thisDate = String(v0).trim();

      if (thisDate === dateStr && dateRow === -1) {
        // gặp đúng ngày cần lấy
        dateRow = i;
      } else if (dateRow !== -1 && thisDate !== dateStr) {
        // đã đi qua block của ngày cần lấy, gặp ngày tiếp theo -> dừng
        nextDateRow = i;
        break;
      }
    }
  }

  if (dateRow === -1) {
    // không tìm thấy ngày
    return { header: [], rows: [] };
  }

  const headerRowIndex = dateRow + 1;      // dòng tiêu đề (Giờ, Chuyền,...)
  const dataStartIndex = dateRow + 2;      // bắt đầu data
  const dataEndIndex = nextDateRow;        // kết thúc trước ngày tiếp theo

  const header = values[headerRowIndex] || [];
  const rows = values.slice(dataStartIndex, dataEndIndex);

  return { header, rows };
}

// map từng dòng thành object alert
function buildHourAlerts(rows) {
  const result = [];

  for (const row of rows) {
    const hour = row[0] || "";
    const chuyen = row[1] || "";

    // bỏ qua dòng trống
    if (!hour && !chuyen) continue;

    const target = Number(row[2] || 0); // Kế hoạch lũy tiến
    const actual = Number(row[3] || 0); // Thực tế
    const diff = actual - target;

    let status = "equal";
    let message = "Đủ kế hoạch";

    if (diff > 0) {
      status = "over";
      message = `Vượt ${diff} sp`;
    } else if (diff < 0) {
      status = "lack";
      message = `Thiếu ${Math.abs(diff)} sp`;
    }

    result.push({
      hour,
      chuyen,
      target,
      actual,
      diff,
      status,
      message,
    });
  }

  return result;
}

/* ====== GOOGLE AUTH ====== */

function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!clientEmail || !privateKeyBase64 || !spreadsheetId) {
    throw new Error(
      "Thiếu biến môi trường GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SHEET_ID"
    );
  }

  const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf8");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return { auth, spreadsheetId };
}

/* ====== GET /api/check-kpi ====== */

export async function GET(req) {
  console.log("✅ KPI API CALLED (GET)");

  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim(); // ví dụ "24/12/2025"

    console.log("👉 Requested date:", date);

    if (!date) {
      return NextResponse.json(
        { status: "error", message: "Thiếu query ?date=dd/mm/yyyy" },
        { status: 400 }
      );
    }

    const { auth, spreadsheetId } = getGoogleAuth();
    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    // 👉 Đảm bảo tên tab đúng y chang trong Google Sheet (ví dụ: KPI)
    const SHEET_NAME = "KPI";

    const raw = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:Z200`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = raw.data.values || [];
    console.log("📄 Tổng số dòng đọc được:", values.length);

    const { header, rows } = extractBlockForDate(values, date);
    console.log("📄 Số dòng trong block ngày:", rows.length);

    const hourAlerts = buildHourAlerts(rows);

    // tổng hợp theo chuyền: lấy dòng cuối cùng của mỗi chuyền trong ngày
    const dayMap = new Map();
    for (const row of hourAlerts) {
      dayMap.set(row.chuyen, row);
    }
    const dayAlerts = Array.from(dayMap.values());

    return NextResponse.json({
      status: "success",
      hourAlerts,
      dayAlerts,
      debug: {
        date,
        totalRows: values.length,
        blockRows: rows.length,
        header,
      },
    });
  } catch (err) {
    console.error("❌ KPI API ERROR (GET):", err);
    return NextResponse.json(
      {
        status: "error",
        message: err.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

/* ====== POST (không dùng) ====== */

export async function POST() {
  return NextResponse.json({
    status: "error",
    message: "API này chỉ hỗ trợ GET",
  });
}
