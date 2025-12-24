import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKING_HOURS = ["09:00", "10:00", "11:00", "12:30", "13:30", "14:30", "15:30", "16:30"];
function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST() {
  try {
    // ================= AUTH GOOGLE =================
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: Buffer.from(
        process.env.GOOGLE_PRIVATE_KEY_BASE64,
        "base64"
      ).toString("utf8"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // ================= READ KPI =================
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A2:Z",
    });

    const rows = res.data.values || [];

    // Giả định:
    // A = Giờ
    // B = ĐM/Giờ
    // C = Thực tế lũy tiến
    // D = Hiệu suất ngày
    // E = Hiệu suất định mức ngày

    const alerts = rows.map(r => ({
      time: r[0],
      target: Number(r[1] || 0),
      actual: Number(r[2] || 0),
      effDay: Number(r[3] || 0),
      effTarget: Number(r[4] || 0),
      diff: Number(r[2] || 0) - Number(r[1] || 0),
    }));

    // ================= MAIL LOG =================
    const logRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "MAIL_LOG!A2:C",
    });

    const logs = logRes.data.values || [];
    const sent = (key) =>
      logs.some(r => r[0] === key && r[2] === today());

    const writeLog = async (key, type) => {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "MAIL_LOG!A:C",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[key, type, today()]],
        },
      });
    };

    // ================= THEO TỪNG GIỜ =================
    for (const a of alerts) {
      if (!WORKING_HOURS.includes(a.time)) continue;
      if (sent(a.time)) continue;

      if (a.actual === 0 && a.target === 0) continue;

      await sendMail({
        subject:
          a.diff === 0
            ? `🎉 KPI ${a.time} ĐẠT`
            : `🚨 KPI ${a.time} CẦN XỬ LÝ`,
        html: `
          <h3>${a.time}</h3>
          <ul>
            <li>ĐM/Giờ: ${a.target}</li>
            <li>Thực tế: ${a.actual}</li>
            <li><b>${a.diff === 0 ? "✅ Đạt" : a.diff < 0 ? `❌ Thiếu ${Math.abs(a.diff)}` : `⚠️ Vượt ${a.diff}`}</b></li>
          </ul>
          <p><b>Gợi ý:</b> ${a.diff < 0 ? "Tăng nhân lực / điều chỉnh nhịp" : a.diff > 0 ? "Điều tiết tránh tồn" : "Duy trì"}</p>
        `,
      });

      await writeLog(a.time, "hour");
    }

    // ================= CUỐI NGÀY =================
    const hasFullDay = WORKING_HOURS.every(h =>
      alerts.some(a => a.time === h && a.actual > 0)
    );

    if (hasFullDay && !sent("DAY")) {
      const last = alerts[alerts.length - 1];

      await sendMail({
        subject:
          last.effDay >= last.effTarget
            ? "🏆 HOÀN THÀNH KPI NGÀY"
            : "📊 KPI NGÀY CHƯA ĐẠT",
        html: `
          <h2>TỔNG KẾT NGÀY</h2>
          <ul>
            <li>Hiệu suất đạt: ${last.effDay}%</li>
            <li>Định mức: ${last.effTarget}%</li>
          </ul>
          <p><b>${last.effDay >= last.effTarget ? "🎉 Chúc mừng!" : "⚠️ Cần cải thiện"}</b></p>
        `,
      });

      await writeLog("DAY", "day");
    }

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
}
}