import { getServiceAccount } from "@/utils/getServiceAccount";
import { getSheetsClient } from "@/app/googleSheets";

export async function POST() {
  try {
    const service = getServiceAccount();
    const sheets = await getSheetsClient(service);

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Lấy bảng KPI
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng KPI theo giờ!A1:G6",
    });

    // Lấy bảng sản lượng thực tế
    const realRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng sản lượng thực tế!A1:G6",
    });

    const kpiData = kpiRes.data.values;
    const realData = realRes.data.values;

    const alerts = [];

    for (let row = 1; row < kpiData.length; row++) {
      const time = kpiData[row][0];

      for (let col = 1; col < kpiData[row].length; col++) {
        const stepName = kpiData[0][col];
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
