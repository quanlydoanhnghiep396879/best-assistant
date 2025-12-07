import { google } from "googleapis";

export async function GET() {
  try {
    // Load environment variables
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!sheetId || !clientEmail || !privateKey) {
      return Response.json({ error: "Missing Google API credentials" }, { status: 500 });
    }

    // Create Google API client
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Read KPI Sheet
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Bảng KPI theo giờ!A1:G6",
    });

    // Read Real Output Sheet
    const realRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Bảng sản lượng thực tế!A1:G6",
    });

    const kpi = kpiRes.data.values;
    const real = realRes.data.values;

    if (!kpi || !real) {
      return Response.json({ error: "Cannot read sheets data" });
    }

    // ======== Daily Summary ========
    const summary = {};

    for (let col = 1; col < kpi[1].length; col++) {
      const step = kpi[0][col];
      const kpiValue = Number(kpi[1][col] || 0);
      const realValue = Number(real[1][col] || 0);
      const diff = realValue - kpiValue;

      summary[step] = {
        kpi: kpiValue,
        real: realValue,
        diff,
        status:
          diff < 0 ? "lack" :
          diff > 0 ? "over" :
          "equal"
      };
    }

    // ======== Hourly Alerts ========
    const alerts = [];

    for (let row = 2; row < kpi.length; row++) {
      for (let col = 1; col < kpi[row].length; col++) {
        const step = kpi[0][col];
        const time = kpi[row][0];
        const kpiVal = Number(kpi[row][col] || 0);
        const realVal = Number(real[row][col] || 0);
        const diff = realVal - kpiVal;

        if (diff !== 0) {
          alerts.push(`Giờ ${time} – ${step}: KPI ${kpiVal}, Thực tế ${realVal}, Chênh lệch ${diff}`);
        }
      }
    }

    return Response.json({
      dailySummary: summary,
      alerts,
    });

  } catch (e) {
    console.error("API error:", e);
    return Response.json({ error: e.message });
  }
}
