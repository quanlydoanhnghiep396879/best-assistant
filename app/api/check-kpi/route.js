import { NextResponse } from "next/server";
import { getGoogleSheet } from "@/utils/getServiceAccount";

const SHEET_ID = "1fexKo-eMpoeZo5Y1GU67TqBgHTfmCf9GlP9QAnY4lxU";
const KPI_SHEET = "Bảng KPI theo giờ!A1:G6";
const REAL_SHEET = "Bảng sản lượng thực tế!A1:G6";

export async function GET() {
  try {
    const sheets = await getGoogleSheet();

    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: KPI_SHEET,
    });

    const realRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: REAL_SHEET,
    });

    const kpi = kpiRes.data.values;
    const real = realRes.data.values;

    let alerts = [];
    let summary = {};

    for (let r = 2; r <= 6; r++) {
      for (let c = 1; c <= 6; c++) {
        const kpiVal = Number(kpi[r][c] || 0);
        const realVal = Number(real[r][c] || 0);
        const diff = realVal - kpiVal;

        let status =
          diff < 0 ? "lack" : diff > 0 ? "over" : "equal";

        alerts.push(
          `dòng ${r}, cột ${c}: ${
            status === "lack"
              ? "thiếu " + Math.abs(diff)
              : status === "over"
              ? "vượt " + diff
              : "đủ 0"
          }`
        );

        // Daily summary (total per step)
        const stepName = kpi[1][c];

        if (!summary[stepName]) {
          summary[stepName] = { kpi: 0, real: 0 };
        }

        summary[stepName].kpi += kpiVal;
        summary[stepName].real += realVal;
      }
    }

    // Compute summary diff + status
    Object.keys(summary).forEach((step) => {
      const s = summary[step];
      s.diff = s.real - s.kpi;
      s.status =
        s.diff < 0 ? "lack" : s.diff > 0 ? "over" : "equal";
    });

    return NextResponse.json({
      alerts,
      dailySummary: summary,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
