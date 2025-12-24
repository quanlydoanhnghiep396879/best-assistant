import { NextResponse } from "next/server";
import { google } from "googleapis";
import { sendMail } from "@/lib/sendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // ===== 1. AUTH GOOGLE =====
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

    // ===== 2. READ KPI SHEET =====
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "KPI!A4:J4",
    });

    const row = res.data.values[0];

    const dmNgay = Number(row[0]);
    const dmHour = Number(row[1]);
    const hours = [
      { key: ">9h", col: 2 },
      { key: ">10h", col: 3 },
      { key: ">11h", col: 4 },
      { key: ">12h30", col: 5 },
      { key: ">13h30", col: 6 },
      { key: ">14h30", col: 7 },
    ];

    // ===== 3. XÁC ĐỊNH GIỜ MỚI NHẤT =====
    let lastHourIndex = -1;
    for (let i = 0; i < hours.length; i++) {
      if (row[hours[i].col]) lastHourIndex = i;
    }

    if (lastHourIndex === -1) {
      return NextResponse.json({ message: "Chưa có dữ liệu giờ" });
    }

    const currentHour = hours[lastHourIndex];
    const currentValue = Number(row[currentHour.col]);
    const prevValue =
      lastHourIndex === 0
        ? 0
        : Number(row[hours[lastHourIndex - 1].col]);

    const realHour = currentValue - prevValue;
    const diff = realHour - dmHour;

    // ===== 4. GỬI MAIL THEO GIỜ =====
    await sendMail({
      subject:
        diff < 0
          ? `🚨 KPI ${currentHour.key} THIẾU`
          : diff > 0
          ? `⚠️ KPI ${currentHour.key} VƯỢT`
          : `🎉 KPI ${currentHour.key} ĐẠT`,
      html: `
        <h3>KPI ${currentHour.key}</h3>
        <p>ĐM/H: ${dmHour}</p>
        <p>Thực tế: ${realHour}</p>
        <b>${
          diff < 0
            ? `Thiếu ${Math.abs(diff)}`
            : diff > 0
            ? `Vượt ${diff}`
            : "Đạt chuẩn"
        }</b>
      `,
    });

    // ===== 5. CUỐI NGÀY =====
    if (lastHourIndex === hours.length - 1) {
      const hieuSuat = currentValue / dmNgay;

      await sendMail({
        subject:
          hieuSuat >= 1
            ? "🏆 HOÀN THÀNH KPI NGÀY"
            : "📊 KPI NGÀY KHÔNG ĐẠT",
        html: `
          <h2>Kết quả ngày</h2>
          <p>Sản lượng: ${currentValue}</p>
          <p>Định mức: ${dmNgay}</p>
          <b>Hiệu suất: ${(hieuSuat * 100).toFixed(2)}%</b>
        `,
      });
    }

    return NextResponse.json({ status: "OK" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message });
  }
}

export function GET() {
  return NextResponse.json({ message: "Use POST" });
}