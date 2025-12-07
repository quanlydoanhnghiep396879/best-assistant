import { NextResponse } from "next/server";
import { google } from "googleapis";
import getServiceAccount from "@/utils/getServiceAccount";

export async function GET() {
  try {
    const auth = await getServiceAccount();
    const sheets = google.sheets({ version: "v4", auth });

    // ---------------------------
    // 1. LẤY KPI NGÀY
    // ---------------------------
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_KPI_ID,
      range: "KPI!A2:G2",  // Hàng KPI
    });

    const kpiRow = kpiRes.data.values?.[0] || [];

    const steps = ["Cắt", "In/Thêu", "May 1", "May 2", "Đính nút", "Đóng gói"];
    const kpiMap = {};
    steps.forEach((step, i) => (kpiMap[step] = Number(kpiRow[i + 1] || 0)));

    // ---------------------------
    // 2. LẤY SẢN LƯỢNG NGÀY
    // ---------------------------
    const realRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_KPI_ID,
      range: "SANLUONG!A2:G2", // Hàng sản lượng
    });

    const realRow = realRes.data.values?.[0] || [];

    const realMap = {};
    steps.forEach((step, i) => (realMap[step] = Number(realRow[i + 1] || 0)));

    // ---------------------------
    // 3. SO SÁNH KPI – THỰC TẾ
    // ---------------------------
    const dailySummary = {};

    steps.forEach((step) => {
      const kpi = kpiMap[step] || 0;
      const real = realMap[step] || 0;
      const diff = real - kpi;

      dailySummary[step] = {
        kpi,
        real,
        diff,
        status:
          diff < 0 ? "lack" : diff > 0 ? "over" : "equal",
      };
    });

    // ---------------------------
    // TRẢ JSON RA UI
    // ---------------------------
    return NextResponse.json({
      dailySummary,
      alerts: [], // để UI chạy không lỗi
    });
  } catch (err) {
    console.error("KPI API ERROR:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
