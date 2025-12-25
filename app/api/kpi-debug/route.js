// app/api/kpi-debug/route.js

import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== GOOGLE AUTH =====
function getGoogleAuth() {
  const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (!base64Key || !email) {
    throw new Error("Missing GOOGLE_PRIVATE_KEY_BASE64 or GOOGLE_SERVICE_ACCOUNT_EMAIL");
  }

  const privateKey = Buffer.from(base64Key, "base64")
    .toString("utf8")
    .replace(/\r/g, "")
    .trim();

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

// ===== HÀM CHÍNH LẤY KPI =====
async function handleKpi(date) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEET_ID");
  }

  // Map ngày -> range trong sheet KPI
  const DATE_RANGES = {
    "23/12/2025": "KPI!A21:AJ37",
    "24/12/2025": "KPI!A4:AJ18",
  };

  const range = DATE_RANGES[date] || DATE_RANGES["24/12/2025"];

  const auth = getGoogleAuth();
  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = res.data.values || [];
  if (values.length === 0) {
    return { hourAlerts: [], dayAlerts: [] };
  }

  // Giả sử header: Giờ | Chuyền | Kế hoạch LT | Thực tế | Chênh lệch | Trạng thái
  const [header, ...rows] = values;

  const idxHour = header.indexOf("Giờ");
  const idxChuyen = header.indexOf("Chuyền");
  const idxTarget = header.indexOf("Kế hoạch lũy tiến");
  const idxActual = header.indexOf("Thực tế");
  const idxDiff = header.indexOf("Chênh lệch");
  const idxStatus = header.indexOf("Trạng thái");

  const hourAlerts = rows
    .filter((r) => r[idxChuyen]) // bỏ dòng trống
    .map((r) => {
      const target = Number(r[idxTarget] || 0);
      const actual = Number(r[idxActual] || 0);
      const diff = Number.isFinite(Number(r[idxDiff])) ? Number(r[idxDiff]) : actual - target;
      const statusCell = (r[idxStatus] || "").toString();

      let status = "equal";
      if (diff > 0) status = "over";
      if (diff < 0) status = "lack";

      return {
        chuyen: r[idxChuyen] || "",
        hour: r[idxHour] || "",
        target,
        actual,
        diff,
        status,
        message: statusCell || (status === "equal"
          ? "Đủ kế hoạch"
          : status === "over"
          ? `Vượt ${diff}`
          : `Thiếu ${Math.abs(diff)}`),
      };
    });

  // Tạm thời chưa tính dayAlerts, em có thể bổ sung sau
  const dayAlerts = [];

  return { hourAlerts, dayAlerts };
}

// ===== ROUTES =====
export async function GET(request) {
  console.log("✅ KPI-DEBUG API CALLED (GET)");

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "24/12/2025";

    const result = await handleKpi(date);
    return NextResponse.json({ status: "success", ...result });
  } catch (err) {
    console.error("❌ KPI-DEBUG API ERROR (GET):", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  console.log("✅ KPI-DEBUG API CALLED (POST)");

  try {
    const body = await request.json().catch(() => ({}));
    const date = body?.date || "24/12/2025";

    const result = await handleKpi(date);
    return NextResponse.json({ status: "success", ...result });
  } catch (err) {
    console.error("❌ KPI-DEBUG API ERROR (POST):", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
