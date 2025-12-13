import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // ===== ENV =====
    const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!base64Key || !email || !spreadsheetId) {
      return NextResponse.json({ error: "Missing env" }, { status: 500 });
    }

    // ===== AUTH =====
    const privateKey = Buffer.from(base64Key, "base64")
      .toString("utf8")
      .replace(/\r/g, "")
      .trim();

    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    // ===== READ SHEET =====
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A2:G100",
    });

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
      if (!time) continue;

      for (let col = 1; col < headers.length; col++) {
        const diff = Number(real[i]?.[col] || 0) - Number(kpi[i]?.[col] || 0);

        alerts.push({
          time,
          step: headers[col],
          kpi: Number(kpi[i]?.[col] || 0),
          real: Number(real[i]?.[col] || 0),
          diff,
        });
      }
    }

    // ===== CHỐNG GỬI MAIL KHI CHƯA CẬP NHẬT =====
    const changed = alerts.some(a => a.diff !== 0);
    if (!changed) {
      return NextResponse.json({ status: "no-change", alerts });
    }

    // ===== BÁO THEO GIỜ =====
    const currentHour = alerts[0].time;
    const alertsThisHour = alerts.filter(a => a.time === currentHour);
    const hasProblem = alertsThisHour.some(a => a.diff !== 0);

    const rows = alertsThisHour.map(a => `
      <tr>
        <td>${a.step}</td>
        <td>${a.kpi}</td>
        <td>${a.real}</td>
        <td style="font-weight:bold;color:${a.diff < 0 ? "#dc2626" : a.diff > 0 ? "#f59e0b" : "#16a34a"}">
          ${a.diff < 0 ? `Thiếu ${Math.abs(a.diff)}` : a.diff > 0 ? `Vượt ${a.diff}` : "Đạt"}
        </td>
      </tr>
    `).join("");

    await sendMail({
      subject: hasProblem
        ? `🚨 KPI ${currentHour} – CẦN XỬ LÝ`
        : `🎉 KPI ${currentHour} – ĐẠT`,
      html: `
        <h3>${hasProblem ? "🚨 Cảnh báo KPI" : "🎉 KPI đạt"} – ${currentHour}</h3>
        <table border="1" cellpadding="6">
          <tr><th>Công đoạn</th><th>KPI</th><th>Thực tế</th><th>Trạng thái</th></tr>
          ${rows}
        </table>
      `
    });

    return NextResponse.json({ status: "success", alerts });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ message: "Use POST" });
}