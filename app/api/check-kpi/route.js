import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKING_HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00"];
const HEADERS = ["Cắt", "In", "May 1", "May 2", "Đóng gói"];

function icon(diff) {
  if (diff < 0) return ❌ Thiếu ${Math.abs(diff)};
  if (diff > 0) return 👍 Vượt chỉ tiêu ${diff};
  return "✅ Đạt KPI";
}

export async function POST() {
  try {
    /* ================= GOOGLE AUTH ================= */
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: Buffer.from(
        process.env.GOOGLE_PRIVATE_KEY_BASE64,
        "base64"
      ).toString("utf8"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
       await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    /* ================= READ DATA ================= */
    const [kpiRes, realRes, logRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "KPI!A2:F6" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "PRODUCTION!A2:F6" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "MAIL_LOG!A2:B20" }),
    ]);

    const kpi = kpiRes.data.values || [];
    const real = realRes.data.values || [];
    const log = logRes.data.values || [];

    const sentHours = new Set(log.filter(r => r[1] === "TRUE").map(r => r[0]));

    /* ================= DETECT UPDATED HOUR ================= */
    let targetHour = null;

    for (let i = 0; i < kpi.length; i++) {
      const hour = kpi[i][0];
      if (!WORKING_HOURS.includes(hour)) continue;
      if (sentHours.has(hour)) continue;

      let changed = false;
      for (let c = 1; c <= HEADERS.length; c++) {
        if (Number(real[i]?.[c] || 0) !== 0) {
          changed = true;
        }
      }
      if (changed) {
        targetHour = { index: i, hour };
        break;
      }
    }

    if (!targetHour) {
      return NextResponse.json({ status: "no-update" });
    }

    /* ================= BUILD ALERT ================= */
    const rows = [];
    let hasProblem = false;

    for (let c = 1; c <= HEADERS.length; c++) {
      const diff =
        Number(real[targetHour.index][c] || 0) -
        Number(kpi[targetHour.index][c] || 0);

      if (diff !== 0) hasProblem = true;

      rows.push(`
        <tr>
          <td>${HEADERS[c - 1]}</td>
          <td>${kpi[targetHour.index][c]}</td>
          <td>${real[targetHour.index][c]}</td>
          <td><b>${icon(diff)}</b></td>
        </tr>
      `);
    }

    /* ================= SEND MAIL ================= */
    await sendMail({
      subject: hasProblem
        ? `🚨 KPI ${targetHour.hour} – CẦN XỬ LÝ`
        : `🎉 KPI ${targetHour.hour} – ĐẠT`,
      html: `<h3>${hasProblem ? "🚨 Cảnh báo KPI" : "🎉 KPI đạt"} – ${targetHour.hour}</h3>
        <table border="1" cellpadding="6">
          <tr>
            <th>Công đoạn</th><th>KPI</th><th>Thực tế</th><th>Trạng thái</th>
          </tr>
          ${rows.join("")}
        </table>
        ${
          hasProblem
            ? "<p><b>👉 Gợi ý:</b> Điều chỉnh nhân lực / cân chuyền</p>"
            : "<p><b>👍 Nhịp chuyền ổn định, tiếp tục duy trì</b></p>"
        }
      `,
    });

    /* ================= WRITE LOG ================= */
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "MAIL_LOG!A:C",
      valueInputOption: "RAW",
      requestBody: {
        values: [[targetHour.hour, "TRUE", new Date().toLocaleString()]],
      },
    });

    /* ================= FULL DAY CHECK ================= */
    const sentAfter = new Set([...sentHours, targetHour.hour]);
    if (WORKING_HOURS.every(h => sentAfter.has(h))) {
      await sendMail({
        subject: "🏆 CHÚC MỪNG – HOÀN THÀNH KPI NGÀY",
        html: `
          <h1 style="color:green">🏆 HOÀN THÀNH KPI NGÀY</h1>
          <p>🎉 Tất cả 5 khung giờ đều đã hoàn thành KPI.</p>
        `,
      });
    }

    return NextResponse.json({ status: "sent", hour: targetHour.hour });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ status: "error", message: err.message });
  }
}export function GET() {
  return NextResponse.json({ message: "Use POST" });
}