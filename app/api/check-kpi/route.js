import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ====== CHỐNG GỬI MAIL LẶP ======
let lastHourHash = {};

export async function POST() {
  try {
    // =====================
    // 1️⃣ LOAD ENV
    // =====================
    const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!base64Key || !email || !spreadsheetId) {
      return NextResponse.json({ status: "error", message: "Missing env" });
    }

    const privateKey = Buffer.from(base64Key, "base64")
      .toString("utf8")
      .replace(/\r/g, "")
      .trim();

    // =====================
    // 2️⃣ AUTH GOOGLE
    // =====================
    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    // =====================
    // 3️⃣ READ SHEET
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

    // =====================
    // 4️⃣ SO SÁNH KPI
    // =====================
    for (let i = 0; i < kpi.length; i++) {
      const time = kpi[i][0];

      for (let col = 1; col < headers.length; col++) {
        const k = Number(kpi[i]?.[col] || 0);
        const r = Number(real[i]?.[col] || 0);
        const diff = r - k;

        alerts.push({
          time,
          step: headers[col],
          kpi: k,
          real: r,
          diff,
        });
      }
    }

    // =====================
    // 5️⃣ XÁC ĐỊNH GIỜ VỪA ĐƯỢC SỬA
    // =====================
    const currentHour = alerts.at(-1)?.time;
    const alertsThisHour = alerts.filter(a => a.time === currentHour);

    const hash = crypto
      .createHash("md5")
      .update(JSON.stringify(alertsThisHour))
      .digest("hex");

    if (lastHourHash[currentHour] !== hash) {
      lastHourHash[currentHour] = hash;

      const hasProblem = alertsThisHour.some(a => a.diff !== 0);

      // =====================
      // 6️⃣ MAIL THEO GIỜ
      // =====================
      if (hasProblem) {
        const rows = alertsThisHour
          .filter(a => a.diff !== 0)
          .map(a => `
            <tr>
              <td>${a.step}</td>
              <td>${a.kpi}</td>
              <td>${a.real}</td>
              <td style="color:${a.diff < 0 ? "#dc2626" : "#f59e0b"};font-weight:bold">
                ${a.diff < 0 ? `Thiếu ${Math.abs(a.diff)}` : `Vượt ${a.diff}`}
              </td>
            </tr>
          `).join("");

        await sendMail({
          subject: `🚨 KPI ${currentHour} – CẢNH BÁO`,
          html: `
            <h3>🚨 KPI giờ ${currentHour}</h3>
            <table border="1" cellpadding="6">
              <tr><th>Công đoạn</th><th>KPI</th><th>Thực tế</th><th>Trạng thái</th></tr>
              ${rows}
            </table>
            <p><b>👉 Giải pháp:</b> tăng nhân lực / điều chỉnh chuyền</p>
          `
        });
      } else {
        await sendMail({
          subject:`🎉 KPI ${currentHour} ĐẠT`,
          html: `
            <h3 style="color:#16a34a">🎉 KPI ${currentHour} ĐẠT</h3>
            <p>Tất cả công đoạn đạt chỉ tiêu.</p>
          `
        });
      }
    }

    // =====================
    // 7️⃣ TỔNG KẾT CUỐI NGÀY
    // =====================
    const workingHours = ["08:00", "09:00", "10:00", "11:00", "12:00"];
    const hoursDone = [...new Set(alerts.map(a => a.time))];

    if (
      workingHours.every(h => hoursDone.includes(h)) &&
      !alerts.some(a => a.diff !== 0)
    ) {
      await sendMail({
        subject: "🏆 CHÚC MỪNG – HOÀN THÀNH KPI NGÀY",
        html: `
          <h1 style="color:#16a34a">🏆 HOÀN THÀNH KPI NGÀY</h1>
          <p>🎉 Toàn bộ 5 khung giờ đều đạt KPI.</p>
        `
      });
    }

    // =====================
    // 8️⃣ TRẢ DASHBOARD
    // =====================
    return NextResponse.json({ status: "success", alerts });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ status: "error", message: err.message });
  }
}