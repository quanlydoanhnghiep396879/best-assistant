// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CONFIG_SHEET_NAME = "CONFIG_KPI"; // sheet chứa DATE / RANGE

function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;

  if (!email || !keyBase64 || !SHEET_ID) return null;

  let privateKey = Buffer.from(keyBase64, "base64").toString("utf8");
  privateKey = privateKey.replace(/\\n/g, "\n");

  return new google.auth.JWT(
    email,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const t = String(v).trim().replace(/,/g, "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

// đọc CONFIG_KPI -> tìm range theo date
async function getRangeFromConfig(sheets, dateStr) {
  const resCfg = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${CONFIG_SHEET_NAME}!A2:B`,
  });

  const rows = resCfg.data.values || [];
  const found = rows.find((r) => (r[0] || "").trim() === dateStr);
  if (!found) return null;

  return (found[1] || "").trim(); // ví dụ: "KPI!A4:AJ18"
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim();

    if (!date) {
      return NextResponse.json(
        { status: "error", message: "Thiếu query ?date=dd/mm/yyyy" },
        { status: 400 }
      );
    }

    const auth = getGoogleAuth();
    if (!auth) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SHEET_ID",
        },
        { status: 500 }
      );
    }

    const sheets = google.sheets({ version: "v4", auth });

    // 1) lấy range
    const range = await getRangeFromConfig(sheets, date);
    if (!range) {
      return NextResponse.json(
        {
          status: "error",
          message: `Không tìm thấy RANGE cho ngày ${date} trong sheet ${CONFIG_SHEET_NAME}`,
        },
        { status: 400 }
      );
    }

    // 2) đọc block KPI
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });

    const values = res.data.values || [];
    if (!values.length) {
      return NextResponse.json({
        status: "success",
        date,
        range,
        hourAlerts: [],
        dayAlerts: [],
        rawValues: [],
      });
    }

    const header = values[0] || [];
    const rows = values.slice(1);

    const lower = header.map((h) => String(h || "").toLowerCase());

    const idxHour = lower.findIndex((c) => c.includes("giờ"));
    const idxLine = lower.findIndex((c) => c.includes("chuyền"));
    const idxTarget = lower.findIndex((c) => c.includes("kế hoạch"));
    const idxActual = lower.findIndex((c) => c.includes("thực tế"));

    const hourAlerts = [];

    for (const row of rows) {
      const hour = idxHour >= 0 ? row[idxHour] || "" : "";
      const chuyen = idxLine >= 0 ? row[idxLine] || "" : "";
      const target = idxTarget >= 0 ? toNumberSafe(row[idxTarget]) : 0;
      const actual = idxActual >= 0 ? toNumberSafe(row[idxActual]) : 0;

      if (!hour && !chuyen) continue;

      const diff = actual - target;
      let status = "equal";
      let message = "Đủ kế hoạch";

      if (diff > 0) {
        status = "over";
        message = `Vượt ${diff} sp so với kế hoạch`;
      } else if (diff < 0) {
        status = "lack";
        message = `Thiếu ${-diff} sp so với kế hoạch`;
      }

      hourAlerts.push({
        hour,
        chuyen,
        target,
        actual,
        diff,
        status,
        message,
      });
    }

    // Tổng kết ngày
    const totalTarget = hourAlerts.reduce((s, r) => s + r.target, 0);
    const totalActual = hourAlerts.reduce((s, r) => s + r.actual, 0);
    const totalDiff = totalActual - totalTarget;

    let dayStatus = "equal";
    let dayMessage = "Cả ngày: đủ kế hoạch";

    if (totalDiff > 0) {
      dayStatus = "over";
      dayMessage = `Cả ngày: vượt ${totalDiff} sp`;
    } else if (totalDiff < 0) {
      dayStatus = "lack";
      dayMessage = `Cả ngày: thiếu ${-totalDiff} sp`;
    }

    const dayAlerts = [
      {
        date,
        target: totalTarget,
        actual: totalActual,
        diff: totalDiff,
        status: dayStatus,
        message: dayMessage,
      },
    ];

    return NextResponse.json({
      status: "success",
      date,
      range,
      hourAlerts,
      dayAlerts,
      rawValues: values,
    });
  } catch (err) {
    console.error("CHECK-KPI ERROR", err);
    return NextResponse.json(
      { status: "error", message: String(err) },
      { status: 500 }
    );
  }
}
