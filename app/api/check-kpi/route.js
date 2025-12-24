import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CẤU HÌNH
 */
const WORKING_HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00"];
const KPI_RANGE = "KPI!A2:G100";
const REAL_RANGE = "PRODUCTION!A2:G100";
const LOG_RANGE = "SYSTEM_LOG!A2:B100"; // LOG: Giờ | Đã gửi mail (TRUE)

/**
 * POST /api/check-kpi
 */
export async function POST() {
  try {
    // ===== 1. GOOGLE AUTH =====
    const privateKey = Buffer.from(
      process.env.GOOGLE_PRIVATE_KEY_BASE64,
      "base64"
    ).toString("utf8");

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // ===== 2. READ DATA =====
    const [kpiRes, realRes, logRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: KPI_RANGE }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: REAL_RANGE }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: LOG_RANGE }),
    ]);

    const kpi = kpiRes.data.values || [];
    const real = realRes.data.values || [];
    const logs = logRes.data.values || [];

    const notifiedHours = logs.map(r => r[0]); // các giờ đã gửi mail

    // ===== 3. BUILD ALERTS =====
    const headers = ["Giờ", "Cắt", "In/Thêu", "May 1", "May 2", "Đính nút", "Đóng gói"];
    const alerts = [];

    for (let i = 0; i < kpi.length; i++) {
      const kpiVal = Number(kpi[i]?.[col] || 0);
      const realVal = Number(real[i]?.[col] || 0);
      if (kpiVal === 0 && realVal === 0) continue; // bỏ qua nếu cả 2 đều 0
      const time = kpi[i]?.[0];
      if (!WORKING_HOURS.includes(time)) continue;

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

    // ===== 4. XÁC ĐỊNH GIỜ VỪA THAY ĐỔI =====
    const hoursWithData = [...new Set(alerts.map(a => a.time))];
    const newHour = hoursWithData.find(
      h => !notifiedHours.includes(h)
    );

    // ❗ Chưa có giờ mới → KHÔNG GỬI MAIL
    if (!newHour) {
      return NextResponse.json({
        status: "ok",
        message: "No new hour updated → no mail sent",
      });
    }

    // ===== 5. MAIL THEO GIỜ =====
    const alertsThisHour = alerts.filter(a => a.time === newHour);
    const hasProblem = alertsThisHour.some(a => a.diff !== 0);

    const rows = alertsThisHour
      .map(a => `
        <tr>
          <td>${a.step}</td>
          <td>${a.kpi}</td>
          <td>${a.real}</td>
          <td style="color:${a.diff < 0 ? "#dc2626" : a.diff > 0 ? "#f59e0b" : "#16a34a"}">
            ${
              a.diff < 0
                ? `Thiếu ${Math.abs(a.diff)}`
                : a.diff > 0
                ? `Vượt ${a.diff}`
                : "Đạt KPI"
            }
          </td>
        </tr>
      `)
      .join("");

    await sendMail({
      subject: hasProblem
        ? `🚨 KPI ${newHour} – CẦN XỬ LÝ`
        : `🎉 KPI ${newHour} – ĐẠT`,
      html: `
        <h3>${hasProblem ? "🚨 Cảnh báo KPI" : "🎉 KPI ĐẠT"} – ${newHour}</h3>
        <table border="1" cellpadding="6">
          <tr>
            <th>Công đoạn</th><th>KPI</th><th>Thực tế</th><th>Trạng thái</th>
          </tr>
          ${rows}
        </table>
        ${
          hasProblem
            ? "<p><b>👉 Gợi ý:</b> tăng nhân lực / điều chỉnh nhịp chuyền</p>"
            : "<p style='color:#16a34a'><b>✔ Nhịp chuyền ổn định</b></p>"
        }
      `,
    });

    // ===== 6. GHI SYSTEM_LOG ĐÃ GỬI =====
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "SYSTEM_LOG!A:B",
      valueInputOption: "RAW",
      requestBody: {
        values: [[newHour, "TRUE"]],
      },
    });

    // ===== 7. CHECK HOÀN THÀNH NGÀY =====
    const finishedHours = [...notifiedHours, newHour];
    const isFullDay = WORKING_HOURS.every(h => finishedHours.includes(h));

    if (isFullDay) {
      const hasAnyProblem = alerts.some(a => a.diff !== 0);

      await sendMail({
        subject: hasAnyProblem
          ? "📊 TỔNG KẾT KPI NGÀY – CẦN CẢI THIỆN"
          : "🏆 CHÚC MỪNG! HOÀN THÀNH KPI NGÀY",
        html: hasAnyProblem
          ? "<h3>📊 Có vấn đề trong ngày – cần cải thiện</h3>"
          : "<h1 style='color:#16a34a'>🏆 HOÀN THÀNH KPI CẢ NGÀY</h1>",
      });
    }

    return NextResponse.json({
      status: "success",
      newHour,
      hasProblem,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ status: "error", message: err.message });
  }
}

export function GET() {
  return NextResponse.json({ message: "Use POST" });
}