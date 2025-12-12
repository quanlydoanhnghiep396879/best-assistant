import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    /* ===============================
       1️⃣ GOOGLE AUTH
    =============================== */
    const privateKey = Buffer.from(
      process.env.GOOGLE_PRIVATE_KEY_BASE64,
      "base64"
    )
      .toString("utf8")
      .replace(/\r/g, "")
      .trim();

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    /* ===============================
       2️⃣ ĐỌC GOOGLE SHEET
    =============================== */
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

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

    const headers = [
      "Giờ",
      "Cắt",
      "In/Thêu",
      "May 1",
      "May 2",
      "Đính nút",
      "Đóng gói",
    ];

    /* ===============================
       3️⃣ TẠO ALERTS (DASHBOARD)
       ⚠️ PHẦN NÀY GIỮ NGUYÊN LOGIC CŨ
    =============================== */
    const alerts = [];

    for (let i = 0; i < kpi.length; i++) {
      const time = kpi[i][0];

      for (let col = 1; col < headers.length; col++) {
        const kpiValue = Number(kpi[i]?.[col] || 0);
        const realValue = Number(real[i]?.[col] || 0);
        const diff = realValue - kpiValue;

        alerts.push({
          time,
          step: headers[col],
          kpi: kpiValue,
          real: realValue,
          diff,
          status:
            diff === 0 ? "equal" : diff > 0 ? "over" : "lack",
          message:
            diff === 0
              ? "Đạt KPI"
              : diff > 0
              ? `Vượt ${diff}`
              : `Thiếu ${Math.abs(diff)}`,
        });
      }
    }

    /* ===============================
       4️⃣ GỬI MAIL THEO GIỜ
    =============================== */
    const currentHour = alerts.at(-1)?.time;
    const alertsThisHour = alerts.filter(a => a.time === currentHour);
    const hasProblemThisHour = alertsThisHour.some(a => a.diff !== 0);

    if (alertsThisHour.length > 0) {
      const rows = alertsThisHour
        .map(
          a => `
          <tr>
            <td>${a.step}</td>
            <td>${a.kpi}</td>
            <td>${a.real}</td>
            <td style="font-weight:bold;color:${
              a.diff < 0 ? "#dc2626" : a.diff > 0 ? "#f59e0b" : "#16a34a"
            }">
              ${
                a.diff < 0
                  ? `Thiếu ${Math.abs(a.diff)}`
                  : a.diff > 0
                  ? `Vượt ${a.diff}`
                  : "Đạt KPI"
              }
            </td>
          </tr>
        `
        )
        .join("");

      await sendMail({
        subject: hasProblemThisHour
          ? `🚨 KPI ${currentHour} – CẦN XỬ LÝ`
          : `🎉 KPI ${currentHour} – ĐẠT`,
        html: `
          <h3>${hasProblemThisHour ? "🚨 Cảnh báo KPI" : "🎉 KPI ĐẠT"} – ${currentHour}</h3>
          <table border="1" cellpadding="6">
            <tr>
              <th>Công đoạn</th>
              <th>KPI</th>
              <th>Thực tế</th>
              <th>Trạng thái</th>
            </tr>
            ${rows}
          </table>
          ${
            hasProblemThisHour
              ? "<p><b>👉 Gợi ý:</b> tăng nhân lực / điều chỉnh nhịp chuyền</p>"
              : "<p style='color:#16a34a'><b>✅ Nhịp chuyền ổn định</b></p>"
          }
          <p>— KPI Assistant</p>
        `,
      });
    }

    /* ===============================
       5️⃣ TỔNG KẾT 5 GIỜ
    =============================== */
    const workingHours = ["08:00", "09:00", "10:00", "11:00", "12:00"];
    const hoursDone = [...new Set(alerts.map(a => a.time))];
    const isFullDay = workingHours.every(h => hoursDone.includes(h));
    const hasAnyProblem = alerts.some(a => a.diff !== 0);

    if (isFullDay) {
      if (!hasAnyProblem) {
        await sendMail({
          subject: "🏆 CHÚC MỪNG! HOÀN THÀNH KPI NGÀY",
          html: `
            <h1 style="color:#16a34a">🏆 HOÀN THÀNH KPI NGÀY</h1>
            <p>🎉 Toàn bộ 5 khung giờ đều đạt KPI.</p>
            <ul>
              <li>✅ Không thiếu</li>
              <li>✅ Không vượt tồn</li>
              <li>✅ Nhịp chuyền ổn định</li>
            </ul>
            <p>— KPI Assistant</p>
          `,
        });
      } else {
        const rows = alerts
          .filter(a => a.diff !== 0)
          .map(
            a => `
            <tr>
              <td>${a.time}</td>
              <td>${a.step}</td>
              <td style="font-weight:bold;color:${
                a.diff < 0 ? "#dc2626" : "#f59e0b"
              }">
                ${a.diff < 0 ? `Thiếu ${Math.abs(a.diff)}` : `Vượt ${a.diff}`}
              </td>
            </tr>
          `
          )
          .join("");

        await sendMail({
          subject: "📊 TỔNG KẾT KPI NGÀY – CẦN CẢI THIỆN",
          html: `
            <h2>📊 Tổng kết KPI ngày</h2>
            <table border="1" cellpadding="6">
              <tr>
                <th>Giờ</th>
                <th>Công đoạn</th>
                <th>Trạng thái</th>
              </tr>
              ${rows}
            </table>
            <p>— KPI Assistant</p>
          `,
        });
      }
    }

    /* ===============================
       6️⃣ TRẢ JSON → DASHBOARD
       ⚠️ FRONTEND HIỂN THỊ NHƯ CŨ
    =============================== */
    return NextResponse.json({
      status: "success",
      alerts, // 👈 dashboard dùng cái này
    });
  } catch (err) {
    console.error("CHECK KPI ERROR:", err);
    return NextResponse.json({
      status: "error",
      message: err.message,
    });
  }
}

export function GET() {
  return NextResponse.json({
    message: "API chỉ hỗ trợ POST",
  });
}