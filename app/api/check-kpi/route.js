import { google } from "googleapis";
import { NextResponse } from "next/server";

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheetId = "1fexKo-eMpoeZo5Y1GU67TqBgHTfmCf9GlP9QAnY4lxU";

    // 1️⃣ Đọc KPI cả ngày (dòng 2)
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng KPI theo giờ!A2:G2",
    });

    const kpiRow = kpiRes.data.values?.[0] || [];

    // 2️⃣ Đọc sản lượng thực tế cả ngày (dòng 2)
    const realRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng sản lượng thực tế!A2:G2",
    });

    const realRow = realRes.data.values?.[0] || [];

    const steps = ["Cắt", "In/Thêu", "May 1", "May 2", "Đính nút", "Đóng gói"];
    const dailySummary = {};

    // 3️⃣ So sánh KPI – Real
    steps.forEach((step, i) => {
      const kpi = Number(kpiRow[i + 1] || 0);
      const real = Number(realRow[i + 1] || 0);
      const diff = real - kpi;

      dailySummary[step] = {
        kpi,
        real,
        diff,
        status: diff < 0 ? "lack" : diff > 0 ? "over" : "equal",
      };
    });

    // 4️⃣ Đọc KPI theo giờ (dòng 3–6)
    const hourKPIRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng KPI theo giờ!A2:G6",
    });

    const hourRealRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bảng sản lượng thực tế!A2:G6",
    });

    const hourKPI = hourKPIRes.data.values || [];
    const hourReal = hourRealRes.data.values || [];

    const alerts = [];

    // 5️⃣ Sinh cảnh báo so sánh theo giờ
    for (let r = 1; r < hourKPI.length; r++) {
      const time = hourKPI[r][0];
      for (let c = 1; c <= 6; c++) {
        const kpiVal = Number(hourKPI[r][c] || 0);
        const realVal = Number(hourReal[r][c] || 0);

        if (kpiVal === 0 && realVal === 0) continue;

        const diff = realVal - kpiVal;

        let msg = "đủ 0";
        if (diff < 0) msg = `thiếu ${Math.abs(diff)}`;
        if (diff > 0) msg = `vượt ${diff}`;

        alerts.push(`dòng ${r + 1}, cột ${c}: ${msg}`);
      }
    }

    return NextResponse.json({
      dailySummary,
      alerts,
    });

  } catch (err) {
    console.error("API ERROR:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
