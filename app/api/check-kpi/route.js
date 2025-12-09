import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  console.log("✅ CHECK KPI API CALLED");

  try {
    // ==== LOAD ENV ====
    const rawkey = process.env.GOOGLE_PRIVATE_KEY;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

    console.log("DEBUG GOOGLE EMAIL:", email);
    console.log("DEBUG HAS KEY:", !!rawkey);
    console.log("DEBUG RAW KEY LENGTH:", rawkey ? rawkey.length : 0);

    if (!rawkey) {
      return NextResponse.json({
        status: "error",
        message: "SERVER: GOOGLE_PRIVATE_KEY is empty",
      });
    }

    // ==== FIX PRIVATE KEY FORMAT ====
    const privatekey = rawkey.includes("\\n")
      ? rawkey.replace(/\\n/g, "\n")
      : rawkey;

    console.log("DEBUG FIXED KEY LENGTH:", privatekey.length);
    console.log("PRIVATE KEY FIRST 30:", privatekey.substring(0, 30));
    console.log("PRIVATE KEY LAST 30:", privatekey.substring(privatekey.length - 30));

    // ==== AUTH GOOGLE SHEETS ====
    const auth = new google.auth.JWT(
      email,
      null,
      privatekey, // đúng biến
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    );

    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // ==== READ KPI ====
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A2:G100",
    });

    // ==== READ REAL ====
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

        const status = diff === 0 ? "equal" : diff > 0 ? "over" : "lack";
        const message =
          diff === 0
            ? "Đủ chỉ tiêu"
            : diff > 0
            ? Vượt `${diff}`
            : Thiếu `${Math.abs(diff)}`;

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
    message: "API này chỉ hỗ trợ POST",
  });
}