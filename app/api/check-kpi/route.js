import { google } from "googleapis";

export async function POST() {
  try {
    // AUTH GOOGLE SHEETS
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    );

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Đọc toàn bộ dữ liệu KPI
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A2:G100",     // đọc rộng hơn cho an toàn
    });

    // Đọc toàn bộ dữ liệu sản lượng thực tế
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

        alerts.push({
          time,
          step,
          kpi: kpiValue,
          real: realValue,
          diff,
          status,
          message,
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
    message: "API này chỉ hỗ trợ POST – không hỗ trợ GET",
  });
}