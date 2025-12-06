import { google } from "googleapis";
import { getServiceAccount } from "@/utils/getServiceAccount";
import { getSheetsClient } from "@/app/googleSheets";

export async function POST() {
  try {
    // Load service account
    const service = getServiceAccount();
    const sheets = await getSheetsClient(service);

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // 1️⃣ Lấy dữ liệu KPI
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng KPI theo giờ!A1:G6",
    });

    // 2️⃣ Lấy dữ liệu Sản lượng thực tế
    const sanluongRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng sản lượng thực tế!A1:G6",
    });

    const kpiData = kpiRes.data.values;
    const realData = sanluongRes.data.values;

    let alerts = [];

    // 3️⃣ So sánh từng dòng & từng cột
    for (let row = 1; row < kpiData.length; row++) {
      for (let col = 1; col < kpiData[row].length; col++) {
        const kpi = Number(kpiData[row][col]);
        const real = Number(realData[row][col]);

        if (!isNaN(kpi) && !isNaN(real)) {
          if (real < kpi) {
            alerts.push(
              `❌ Thiếu KPI tại dòng ${row + 1}, cột ${col + 1}: thiếu ${kpi - real}`
            );
          } else if (real > kpi) {
            alerts.push(
              `⚠️ Vượt KPI tại dòng ${row + 1}, cột ${col + 1}: vượt ${real - kpi}`
            );
          }
        }
      }
    }

    return Response.json({
      status: "success",
      alerts,
    });

  } catch (error) {
    console.error("❌ ERROR:", error);
    return Response.json({
      status: "error",
      message: error.message,
    });
  }
}
