import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  console.log("✅ CHECK KPI API CALLED");

  try {
    // === LOAD ENV ===
    const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    console.log("DEBUG EMAIL:", email);
    console.log("HAS BASE64 KEY:", !!base64Key);
    console.log("BASE64 LENGTH:", base64Key?.length);

    if (!base64Key) {
      return NextResponse.json({
        status: "error",
        message: "Missing GOOGLE_PRIVATE_KEY_BASE64",
      });
    }
    // === DECODE BASE64 → PEM KEY ===
    const privateKey = Buffer.from(base64Key, "base64").toString("utf8");

    console.log("PEM FIRST LINE:", privateKey.split("\n")[0]);
    console.log("PEM LAST LINE:", privateKey.split("\n").slice(-1)[0]);

    // === AUTH GOOGLE SHEETS ===
    const auth = new google.auth.JWT(
      email,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    );

    console.log("🔥 TRY AUTH...");
    await auth.authorize();
    console.log("✅ AUTH OK");

    const sheets = google.sheets({ version: "v4", auth });

    // === READ KPI ===
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A2:G100",
    });

    // === READ PRODUCTION ===
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

        alerts.push({
          time,
          step,
          kpi: kpiValue,
          real: realValue,
          diff,
          status: diff === 0 ? "equal" : diff > 0 ? "over" : "lack",
          message:
            diff === 0
              ? "Đủ chỉ tiêu"
              : diff > 0
              ? `Vượt ${diff}`
              : `Thiếu ${Math.abs(diff)}`,
        });
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