import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "auto";
export const revalidate = 0;

export async function POST() {
  try {
    // ==== DEBUG ENV GOOGLE KEY ====
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

    console.log("DEBUG GOOGLE EMAIL:", email);
    console.log("DEBUG HAS KEY:", !!rawKey);
    console.log("DEBUG KEY LENGTH:", rawKey ? rawKey.length : 0);

    if (!rawKey) {
      // Nếu vào đây thì chắc chắn env không load
      return NextResponse.json({
        status: "error",
        message: "SERVER: GOOGLE_PRIVATE_KEY is empty (env không có giá trị)",
      });
    }

    // Nếu key đang ở dạng có kí tự \n trong chuỗi thì replace, còn không thì để nguyên
    const privateKey = rawKey.includes("\\n")
      ? rawKey.replace(/\\n/g, "\n")
      : rawKey;

    // AUTH GOOGLE SHEETS
    const auth = new google.auth.JWT(
      email,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    );

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Đọc KPI
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A2:G100",
    });

    // Đọc sản lượng
    const realRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "PRODUCTION!A2:G100",
    });

    const kpi = kpiRes.data.values || [];
    const real = realRes.data.values || [];

    const headers = ["Giờ", "Cắt", "In/Thêu", "May 1", "May 2", "Đính nút", "Đóng gói"];
    const alerts = [];

    for (let i = 0; i < kpi.length; i++) {
      const time = kpi[i][0];

      for (let col = 1; col < headers.length; col++) {
        const step = headers[col];

        const kpiValue = Number(kpi[i]?.[col] || 0);
        const realValue = Number(real[i]?.[col] || 0);

        const diff = realValue - kpiValue;

        let status = "";
        let message = "";

        if (diff === 0) {
          status = "equal";
          message = "Đủ chỉ tiêu";
        } else if (diff > 0) {
          status = "over";
          message = `Vượt ${diff}`;
        } else {
          status = "lack";
          message = `Thiếu ${Math.abs(diff)}`;
        }

        alerts.push({ time, step, kpi: kpiValue, real: realValue, diff, status, message });
      }
    }

    return NextResponse.json({ status: "success", alerts });
  } catch (error) {
    console.error("❌ CHECK KPI ERROR:", error);
    return NextResponse.json({
      status: "error",
      message: error.message,
    });
  }
}

export function GET() {
  return NextResponse.json({
    status: "error",
    message: "API này chỉ hỗ trợ POST – không hỗ trợ GET",
  });
}