import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKING_HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00"];
const KPI_RANGE = "KPI!A2:G100";
const PROD_RANGE = "PRODUCTION!A2:G100";
const SYSTEM_RANGE = "SYSTEM!A2:C2";

// ====== helpers ======
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeHour(h) {
  if (!h) return "";
  // chấp nhận "8:00" -> "08:00"
  const s = String(h).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  const hh = m[1].padStart(2, "0");
  return `${hh}:${m[2]}`;
}

function buildHourlyEmailHTML(currentHour, alertsThisHour) {
  const hasProblem = alertsThisHour.some((a) => a.diff !== 0);

  const rows = alertsThisHour
    .map((a) => {
      const color =
        a.diff < 0 ? "#dc2626" : a.diff > 0 ? "#f59e0b" : "#16a34a";
      const statusText =
        a.diff < 0
          ? `Thiếu ${Math.abs(a.diff)}`
          : a.diff > 0
          ? `Vượt ${a.diff}`
          : "Đạt KPI";

      return `
        <tr>
          <td>${a.step}</td>
          <td style="text-align:right">${a.kpi}</td>
          <td style="text-align:right">${a.real}</td>
          <td style="color:${color}; font-weight:700">${statusText}</td>
        </tr>
      `;
    })
    .join("");

  const advice = hasProblem
    ? `
      <h4>👉 Gợi ý xử lý nhanh</h4>
      <ul>
        <li><b>Thiếu</b>: tăng nhân lực / tăng tốc khâu trước / kiểm tra nghẽn máy, thiếu NPL</li>
        <li><b>Vượt</b>: điều tiết nhịp / tránh tồn bán thành phẩm / cân lại nhịp chuyền</li>
      </ul>
    `
    : `
      <p style="color:#16a34a; font-weight:700">🎉 Tất cả công đoạn giờ này đều đạt KPI. Duy trì nhịp chuyền hiện tại!</p>
    `;

  return `
    <h2>${hasProblem ? "🚨 CẢNH BÁO KPI" : "🎉 KPI ĐẠT"} — ${currentHour}</h2>
    <table border="1" cellpadding="8" style="border-collapse:collapse">
      <thead>
        <tr style="background:#f3f4f6">
          <th>Công đoạn</th>
          <th>KPI</th>
          <th>Thực tế</th>
          <th>Trạng thái</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${advice}
    <p style="margin-top:16px">— KPI Assistant</p>
  `;
}

function buildDailySummaryHTML(alerts) {
  const hasAnyProblem = alerts.some((a) => a.diff !== 0);
  if (!hasAnyProblem) {
    return `
      <h1 style="color:#16a34a">🏆 HOÀN THÀNH KPI NGÀY HÔM NAY</h1>
      <p>🎉 Chúc mừng! Tất cả 5 khung giờ đều đạt KPI.</p>
      <ul>
        <li>✅ Không thiếu công đoạn</li>
        <li>✅ Không vượt gây tồn</li>
        <li>✅ Nhịp chuyền ổn định</li>
      </ul>
      <p><b>👉 Đề xuất:</b> Duy trì phân bổ nhân lực & nhịp chuyền hiện tại.</p>
      <p style="margin-top:16px">— KPI Assistant</p>
    `;
  }

  const problems = alerts.filter((a) => a.diff !== 0);
  const rows = problems
    .map((a) => {
      const color = a.diff < 0 ? "#dc2626" : "#f59e0b";
      const text =
        a.diff < 0 ? `Thiếu ${Math.abs(a.diff)}` : `Vượt ${a.diff}`;

      return `
        <tr>
          <td>${a.time}</td>
          <td>${a.step}</td>
          <td style="color:${color}; font-weight:700">${text}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <h2>📊 TỔNG KẾT KPI NGÀY — CẦN CẢI THIỆN</h2>
    <table border="1" cellpadding="8" style="border-collapse:collapse">
      <thead>
        <tr style="background:#f3f4f6">
          <th>Giờ</th>
          <th>Công đoạn</th>
          <th>Trạng thái</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <h4>👉 Gợi ý xử lý</h4>
    <ul>
      <li><b>Thiếu</b> → tăng nhân lực / giảm đổi chuyền / kiểm tra nghẽn & thiếu NPL</li>
      <li><b>Vượt</b> → điều tiết nhịp / tránh tồn / cân bằng WIP giữa các công đoạn</li>
    </ul>

    <p style="margin-top:16px">— KPI Assistant</p>
  `;
}

// ====== main ======
export async function POST() {
  console.log("✅ CHECK KPI API CALLED");

  try {
    const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Gmail sender credentials (để sendMail dùng)
    // (sendMail.js sẽ lấy 2 biến này)
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    // recipient cố định (mail của em)
    const recipient = "vietduc20042020@gmail.com";

    if (!base64Key || !email || !spreadsheetId) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Missing env: GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SHEET_ID",
        },
        { status: 500 }
      );
    }

    if (!gmailUser || !gmailPass) {
      return NextResponse.json(
        {
          status: "error",
          message: "Missing env: GMAIL_USER / GMAIL_APP_PASSWORD",
        },
        { status: 500 }
      );
    }

    // Decode base64 -> PEM
    const privateKey = Buffer.from(base64Key, "base64")
      .toString("utf8")
      .replace(/\r/g, "")
      .trim();

    // Auth Google Sheets
    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    await auth.authorize();
    const sheets = google.sheets({ version: "v4", auth });

    // ====== Read KPI & Production ======
    const [kpiRes, prodRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: KPI_RANGE }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: PROD_RANGE }),
    ]);

    const kpi = kpiRes.data.values || [];
    const prod = prodRes.data.values || [];

    const headers = [
      "Giờ",
      "Cắt",
      "In/Thêu",
      "May 1",
      "May 2",
      "Đính nút",
      "Đóng gói",
    ];

    const alerts = [];

    for (let i = 0; i < kpi.length; i++) {
      const time = normalizeHour(kpi[i]?.[0]);
      if (!time) continue;

      for (let col = 1; col < headers.length; col++) {
        const step = headers[col];
        const kpiValue = toNumber(kpi[i]?.[col]);
        const realValue = toNumber(prod[i]?.[col]);
        const diff = realValue - kpiValue;

        alerts.push({
          time,
          step,
          kpi: kpiValue,
          real: realValue,
          diff,
        });
      }
    }

    // Không có dữ liệu -> chỉ trả dashboard
    if (alerts.length === 0) {
      return NextResponse.json({ status: "success", alerts, mailed: false });
    }

    // ====== Read SYSTEM state ======
    let systemValues = [];
    try {
      const sys = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: SYSTEM_RANGE,
      });
      systemValues = sys.data.values?.[0] || [];
    } catch (e) {
      // nếu chưa có sheet SYSTEM -> báo rõ
      return NextResponse.json(
        {
          status: "error",
          message:
            "Missing SYSTEM sheet. Please create sheet 'SYSTEM' with A1..C2 as instructed.",
        },
        { status: 500 }
      );
    }

    let lastNotifiedHour = normalizeHour(systemValues[0] || "");
    let lastNotifiedDate = String(systemValues[1] || "");
    let fullDayNotified = String(systemValues[2] || "FALSE").toUpperCase();

    const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd

    // ====== Detect updated hour (demo-friendly) ======
    // Quy ước demo: "giờ vừa cập nhật" = giờ mới nhất trong dữ liệu PRODUCTION
    // (Nếu em muốn phát hiện chính xác theo "dòng vừa thay đổi" thì phải lưu hash từng giờ; demo này đủ dùng)
    const hoursPresent = [...new Set(alerts.map((a) => a.time))].sort();
    const currentHour = hoursPresent.at(-1); // giờ lớn nhất hiện có

    // ====== Block spam on page open ======
    // Nếu mở dashboard nhiều lần nhưng data chưa đổi -> không gửi
    // Điều kiện: cùng ngày + cùng giờ đã gửi
    const alreadySentThisHour =
      today === lastNotifiedDate && currentHour === lastNotifiedHour;

    // ====== Prepare hourly alerts ======
    const alertsThisHour = alerts.filter((a) => a.time === currentHour);

    // ====== Send hourly mail ONLY if "new hour" ======
    let mailedHourly = false;
    if (!alreadySentThisHour && alertsThisHour.length > 0) {
      const hasProblem = alertsThisHour.some((a) => a.diff !== 0);

      await sendMail({
        to: recipient,
        subject: hasProblem
          ? `🚨 KPI ${currentHour} — CẦN XỬ LÝ`
          :`🎉 KPI ${currentHour} — ĐẠT`,
        html: buildHourlyEmailHTML(currentHour, alertsThisHour),
      });

      mailedHourly = true;

      // Update SYSTEM A2/B2 with last notified hour/date
      // ⚠️ Update cần scope write; để đơn giản: dùng "spreadsheets" scope viết.
      // Nếu em đang để readonly, anh sẽ chỉ cách chỉnh scope ở phần "LÀM GÌ TIẾP" bên dưới.
      const authWrite = new google.auth.JWT({
        email,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      await authWrite.authorize();
      const sheetsWrite = google.sheets({ version: "v4", auth: authWrite });

      // reset day if date changed
      if (lastNotifiedDate !== today) {
        await sheetsWrite.spreadsheets.values.update({
          spreadsheetId,
          range: "SYSTEM!A2:C2",
          valueInputOption: "RAW",
          requestBody: { values: [["", today, "FALSE"]] },
        });

        lastNotifiedDate = today;
        fullDayNotified = "FALSE";
        lastNotifiedHour = "";
      }

      await sheetsWrite.spreadsheets.values.update({
        spreadsheetId,
        range: "SYSTEM!A2:B2",
        valueInputOption: "RAW",
        requestBody: { values: [[currentHour, today]] },
      });

      lastNotifiedHour = currentHour;
      lastNotifiedDate = today;
    }

    // ====== Full day summary ======
    const isFullDay = WORKING_HOURS.every((h) => hoursPresent.includes(h));

    let mailedDaily = false;
    if (isFullDay && fullDayNotified !== "TRUE") {
      const hasAnyProblem = alerts.some((a) => a.diff !== 0);

      await sendMail({
        to: recipient,
        subject: hasAnyProblem
          ? "📊 TỔNG KẾT KPI NGÀY — CẦN CẢI THIỆN"
          : "🏆 CHÚC MỪNG! HOÀN THÀNH KPI NGÀY HÔM NAY",
        html: buildDailySummaryHTML(alerts),
      });

      mailedDaily = true;

      // Mark full_day_notified = TRUE
      const authWrite = new google.auth.JWT({
        email,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      await authWrite.authorize();
      const sheetsWrite = google.sheets({ version: "v4", auth: authWrite });

      await sheetsWrite.spreadsheets.values.update({
        spreadsheetId,
        range: "SYSTEM!C2",
        valueInputOption: "RAW",
        requestBody: { values: [["TRUE"]] },
      });

      fullDayNotified = "TRUE";
    }

    // ====== Return dashboard data (UI vẫn dùng alerts như cũ) ======
    return NextResponse.json({
      status: "success",
      alerts,
      meta: {
        today,
        currentHour,
        hoursPresent,
        mailedHourly,
        mailedDaily,
        alreadySentThisHour,
        system: { lastNotifiedHour, lastNotifiedDate, fullDayNotified },
      },
    });
  } catch (error) {
    console.error("❌ CHECK KPI ERROR:", error);
    return NextResponse.json(
      { status: "error", message: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({
    status: "error",
    message: "API này chỉ hỗ trợ POST",
  });
}