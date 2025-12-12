import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  console.log("✅ CHECK KPI API CALLED");

  try {
    const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    console.log("DEBUG EMAIL:", email);
    console.log("HAS BASE64 KEY:", !!base64Key);
    console.log("BASE64 LENGTH:", base64Key?.length);

    if (!base64Key) {
      return NextResponse.json({
        status: "error",
        message: "Missing GOOGLE_PRIVATE_KEY_BASE64",
      });
    }

    // DECODE BASE64 -> PEM
    const privateKey = Buffer.from(base64Key, "base64")
      .toString("utf8")
      .replace(/\r/g, "")
      .trim();

    console.log("PEM FIRST LINE:", privateKey.split("\n")[0]);
    console.log("PEM LAST LINE:", privateKey.split("\n").slice(-1)[0]);

    // CORRECT GOOGLE AUTH FORMAT
    const auth = new google.auth.JWT({
      email: email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    console.log("🔥 TRY AUTH...");
    await auth.authorize();
    console.log("✅ AUTH OK");

    const sheets = google.sheets({ version: "v4", auth });

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
        const step = headers[col];
        const kpiValue = Number(kpi[i]?.[col] || 0);
        const realValue = Number(real[i]?.[col] || 0);
        const diff = realValue - kpiValue;

        alerts.push({
          time,
          step,
          kpi: kpiValue,
          real: realValue,
          diff,
          status: diff === 0 ? "equal" : diff > 0 ? "over" : "lack",
          message:
            diff === 0
              ? "Đủ chỉ tiêu"
              : diff > 0
              ? `Vượt ${diff}`
              : `Thiếu ${Math.abs(diff)}`,
        });
      }
    }

    return NextResponse.json({ status: "success", alerts });
  } catch (error) {
    console.error("❌ CHECK KPI ERROR:", error);
    return NextResponse.json({
      status: "error",
      message: error.message,
    });
  }
}

// alerts = [
//   { time, step, kpi, real, diff }
// ]

const workingHours = ["08:00", "09:00", "10:00", "11:00", "12:00"];
const currentHour = alerts[0]?.time;

// =======================
// 🔔 BÁO THEO TỪNG GIỜ
// =======================
const alertsThisHour = alerts.filter(a => a.time === currentHour);
const hasProblemThisHour = alertsThisHour.some(a => a.diff !== 0);

if (alertsThisHour.length > 0) {
  const rows = alertsThisHour.map(a => `
    <tr>
      <td>${a.step}</td>
      <td>${a.kpi}</td>
      <td>${a.real}</td>
      <td style="color:${a.diff < 0 ? "#dc2626" : a.diff > 0 ? "#f59e0b" : "#16a34a"};
                  font-weight:bold">
        ${
          a.diff < 0
            ? `Thiếu ${Math.abs(a.diff)}`
            : a.diff > 0
            ? `Vượt ${a.diff}`
            : "Đạt KPI"
        }
      </td>
    </tr>
  `).join("");

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
          : "<p style='color:#16a34a'><b>🎉 Nhịp chuyền ổn định, tiếp tục duy trì</b></p>"
      }

      <p>— KPI Assistant</p>
    `
  });
}

// =======================
// 🏁 TỔNG KẾT CUỐI NGÀY
// =======================
const hoursDone = [...new Set(alerts.map(a => a.time))];
const isFullDay = workingHours.every(h => hoursDone.includes(h));
const hasAnyProblem = alerts.some(a => a.diff !== 0);

if (isFullDay) {
  if (!hasAnyProblem) {
    // 🏆 CHÚC MỪNG LỚN
    await sendMail({
      subject: "🏆 CHÚC MỪNG! HOÀN THÀNH KPI NGÀY HÔM NAY",
      html: `
        <h1 style="color:#16a34a">🏆 HOÀN THÀNH KPI NGÀY</h1>
        <p>🎉 Toàn bộ 5 khung giờ đều đạt KPI.</p>

        <ul>
          <li>✅ Không thiếu công đoạn</li>
          <li>✅ Không vượt gây tồn</li>
          <li>✅ Nhịp chuyền ổn định</li>
        </ul>

        <p><b>👉 Đề xuất:</b> duy trì cấu hình chuyền hiện tại.</p>
        <p>— KPI Assistant</p>
      `
    });
  } else {
    // 📊 TỔNG KẾT CÓ VẤN ĐỀ
    const problemRows = alerts
      .filter(a => a.diff !== 0)
      .map(a => `
        <tr>
          <td>${a.time}</td>
          <td>${a.step}</td>
          <td style="color:${a.diff < 0 ? "#dc2626" : "#f59e0b"};font-weight:bold">
            ${a.diff < 0 ? `Thiếu ${Math.abs(a.diff)}` : `Vượt ${a.diff}`}
          </td>
        </tr>
      `)
      .join("");

    await sendMail({
      subject: "📊 TỔNG KẾT KPI NGÀY – CẦN CẢI THIỆN",
      html: `
        <h2>📊 Tổng kết KPI trong ngày</h2>
        <table border="1" cellpadding="6">
          <tr>
            <th>Giờ</th>
            <th>Công đoạn</th>
            <th>Trạng thái</th>
          </tr>
          ${problemRows}
        </table>

        <p><b>👉 Gợi ý:</b></p>
        <ul>
          <li>Thiếu → tăng nhân lực / giảm chuyển chuyền</li>
          <li>Vượt → điều tiết nhịp / tránh tồn</li>
        </ul>

        <p>— KPI Assistant</p>
      `
    });
  }
}
export function GET() {
  return NextResponse.json({
    status: "error",
    message: "API này chỉ hỗ trợ POST",
  });
}