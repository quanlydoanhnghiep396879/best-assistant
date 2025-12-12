import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // =====================
    // 1️⃣ GOOGLE AUTH
    // =====================
    const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

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

    // =====================
    // 2️⃣ READ DATA
    // =====================
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

    // =====================
    // 3️⃣ BÁO THEO GIỜ
    // =====================
    const currentHour = alerts[0]?.time;
    const alertsThisHour = alerts.filter(a => a.time === currentHour);
    const hasProblemThisHour = alertsThisHour.some(a => a.diff !== 0);

    if (alertsThisHour.length > 0) {
      const rows = alertsThisHour.map(a => `
        <tr>
          <td>${a.step}</td>
          <td>${a.kpi}</td>
          <td>${a.real}</td>
          <td style="font-weight:bold;color:${
            a.diff < 0 ? "#dc2626" : a.diff > 0 ? "#f59e0b" : "#16a34a"
          }">
            ${a.diff < 0 ? `Thiếu ${Math.abs(a.diff)}` : a.diff > 0 ? `Vượt ${a.diff}` : "Đạt"}
          </td>
        </tr>
      `).join("");

      await sendMail({
        subject: hasProblemThisHour
          ? `🚨 KPI ${currentHour} – CẦN XỬ LÝ`
          : `🎉 KPI ${currentHour} – ĐẠT`,
        html: `
          <h3>${currentHour}</h3>
          <table border="1" cellpadding="6">
            <tr><th>Công đoạn</th><th>KPI</th><th>Thực tế</th><th>Trạng thái</th></tr>
            ${rows}
          </table>
        `,
      });
    }

    // =====================
    // 4️⃣ TỔNG KẾT CUỐI NGÀY
    // =====================
    const workingHours = ["08:00", "09:00", "10:00", "11:00", "12:00"];
    const hoursDone = [...new Set(alerts.map(a => a.time))];
    const isFullDay = workingHours.every(h => hoursDone.includes(h));
    const hasAnyProblem = alerts.some(a => a.diff !== 0);

    if (isFullDay) {
      await sendMail({
        subject: hasAnyProblem
          ? "📊 KPI NGÀY – CẦN CẢI THIỆN"
          : "🏆 KPI NGÀY – HOÀN THÀNH",
        html: hasAnyProblem
          ? "<h2>📊 Có công đoạn chưa đạt</h2>"
          : "<h1 style='color:#16a34a'>🏆 HOÀN THÀNH KPI NGÀY</h1>",
      });
    }

    return NextResponse.json({ status: "success" });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ status: "error", message: err.message });
  }
}

export function GET() {
  return NextResponse.json({ message: "Use POST" });
}