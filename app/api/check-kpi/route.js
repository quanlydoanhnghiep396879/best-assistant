
import { google } from "googleapis";

// ==== KẾT NỐI GOOGLE SHEETS ====
function getGoogleClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google API credentials");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

// ==================================================================

export async function POST() {
  try {
    const sheets = getGoogleClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Lấy bảng KPI
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A1:G6",
    });

    // Lấy bảng thực tế
    const realRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "PRODUCTION!A1:G6",
    });

    const kpiData = kpiRes.data.values;
    const realData = realRes.data.values;

    const alerts = [];

    for (let row = 1; row < kpiData.length; row++) {
      const time = kpiData[row][0];

      for (let col = 1; col < kpiData[row].length; col++) {
        const stepName = kpiData[0][col] ?? "";
        const kpi = Number(kpiData[row][col]);
        const real = Number(realData[row][col]);

        if (!isNaN(kpi) && !isNaN(real)) {
          const diff = real - kpi;

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
            step: stepName,
            kpi,
            real,
            diff,
            status,
            message,
          });
        }
      }
    }

    return Response.json({
      status: "success",
      alerts,
    });

  } catch (error) {
    console.error("❌ ERROR CHECK KPI:", error);
    return Response.json({
      status: "error",
      message: error.message,
    });
  }
}

// CHO PHÉP TEST API TRÊN TRÌNH DUYỆT
export async function GET() {
  return Response.json({
    status: "error",
    message: "API này chỉ hỗ trợ POST – không hỗ trợ GET",
  });
}