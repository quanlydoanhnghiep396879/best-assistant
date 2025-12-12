import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== TIỆN ÍCH =====
const WORKING_HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00"];

function buildHash(items) {
  return items
    .map(i => ${i.step}:${i.kpi}-${i.real})
    .join("|");
}

export async function POST() {
  try {
    // ===== ENV =====
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
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // ===== READ DATA =====
    const [kpiRes, realRes, logRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "KPI!A2:G100",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "PRODUCTION!A2:G100",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "SYSTEM_LOG!A2:B10",
      }),
    ]);

    const kpi = kpiRes.data.values || [];
    const real = realRes.data.values || [];
    const logs = logRes.data.values || [];

    const logMap = {};
    logs.forEach(([time, hash]) => {
      logMap[time] = hash;
    });

    const headers = ["Giờ", "Cắt", "In", "May1", "May2", "Đính", "Đóng gói"];
    const alerts = [];

    // ===== SO SÁNH KPI =====
    for (let i = 0; i < kpi.length; i++) {
      const time = kpi[i][0];
      for (let c = 1; c < headers.length; c++) {
        const k = Number(kpi[i][c] || 0);
        const r = Number(real[i]?.[c] || 0);
        const diff = r - k;

        alerts.push({
          time,
          step: headers[c],
          kpi: k,
          real: r,
          diff,
        });
      }
    }

    // ===== XỬ LÝ THEO TỪNG GIỜ =====
    for (const hour of WORKING_HOURS) {
      const hourItems = alerts.filter(a => a.time === hour);
      if (hourItems.length === 0) continue;

      const newHash = buildHash(hourItems);
      const oldHash = logMap[hour];

      // ❌ KHÔNG THAY ĐỔI → KHÔNG GỬI
      if (newHash === oldHash) continue;

      const problems = hourItems.filter(a => a.diff !== 0);

      // ===== GỬI MAIL =====
      if (problems.length > 0) {
        const rows = problems.map(p => `
          <tr>
            <td>${p.step}</td>
            <td>${p.kpi}</td>
            <td>${p.real}</td>
            <td style="color:${p.diff < 0 ? "red" : "orange"}">
              ${p.diff < 0 ? `Thiếu ${Math.abs(p.diff)}` : `Vượt ${p.diff}`}
            </td>
          </tr>
        `).join("");

        await sendMail({
          subject: `🚨 KPI ${hour} – CẦN XỬ LÝ`,
          html: `
            <h3>🚨 Cảnh báo KPI ${hour}</h3>
            <table border="1" cellpadding="6">
              <tr>
                <th>Công đoạn</th><th>KPI</th><th>Thực tế</th><th>Trạng thái</th>
              </tr>
              ${rows}
            </table>
            <p>👉 Gợi ý: điều chỉnh nhân lực / nhịp chuyền</p>
          `,
        });
      } else {
        await sendMail({
          subject: `🎉 KPI ${hour} – ĐẠT`,
          html: `<h3 style="color:green">🎉 KPI ${hour} đạt – Nhịp chuyền ổn định</h3>`,
        });
      }

      // ===== CẬP NHẬT LOG =====
      const rowIndex = WORKING_HOURS.indexOf(hour) + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `SYSTEM_LOG!A${rowIndex}:B${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[hour, newHash]],
        },
      });
    }

    // ===== TỔNG KẾT CUỐI NGÀY =====
    const hasAnyProblem = alerts.some(a => a.diff !== 0);
    const allLogged = WORKING_HOURS.every(h => logMap[h] && logMap[h] !== "INIT");

    if (allLogged && !hasAnyProblem) {
      await sendMail({
        subject: "🏆 CHÚC MỪNG! HOÀN THÀNH KPI CẢ NGÀY",
        html: `
          <h1 style="color:green">🏆 HOÀN THÀNH KPI NGÀY</h1>
          <p>🎉 Tất cả khung giờ đều đạt KPI.</p>
        `,
      });
    }

    // ===== TRẢ DASHBOARD =====
    return NextResponse.json({
      status: "success",
      alerts,
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
    status: "error",
    message: "POST only",
  });
}