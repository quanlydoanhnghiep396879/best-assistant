import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ==== 1. LẤY CONFIG GOOGLE ==== */
function getGoogleConfig() {
  const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!base64Key || !clientEmail || !spreadsheetId) {
    throw new Error(
      "Thiếu env: GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SHEET_ID"
    );
  }

  const privateKey = Buffer.from(base64Key, "base64")
    .toString("utf8")
    .replace(/\r/g, "")
    .trim();

  return { privateKey, clientEmail, spreadsheetId };
}

/* ==== 2. TẠO GOOGLE SHEETS CLIENT ==== */
async function getSheetsClient() {
  const { privateKey, clientEmail, spreadsheetId } = getGoogleConfig();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });

  return { sheets, spreadsheetId };
}

/* ==== 3. ÉP KIỂU SỐ AN TOÀN ==== */
function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim().replace(/,/g, "").replace("%", "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/* ==== 4. LẤY RANGE THEO NGÀY TỪ SHEET DATE ==== */
async function getRangeForDate(sheets, spreadsheetId, dateStr) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "DATE!A2:B200",
  });

  const rows = res.data.values || [];
  const target = (dateStr || "").trim();

  for (const row of rows) {
    const d = (row[0] || "").trim();
    const r = (row[1] || "").trim();
    if (!d || !r) continue;
    if (d === target) return r;
  }

  return null;
}

/* ==== 5. CHUYỂN BLOCK KPI → ALERT GIỜ ==== */
function buildHourAlerts(values) {
  const alerts = [];
  if (!values || values.length < 2) return alerts;

  // CHỈ SỐ CỘT (tuỳ sheet của em):
  const COL_HOUR = 0;    // A: Giờ
  const COL_CHUYEN = 1;  // B: Chuyền
  const COL_PLAN = 2;    // C: Kế hoạch lũy tiến
  const COL_ACTUAL = 3;  // D: Thực tế
  const COL_DIFF = 4;    // E: Chênh lệch (nếu có)

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const hour = row[COL_HOUR] || "";
    const chuyen = row[COL_CHUYEN] || "";
    if (!hour || !chuyen) continue;

    const plan = toNumberSafe(row[COL_PLAN]);
    const actual = toNumberSafe(row[COL_ACTUAL]);
    let diff = toNumberSafe(row[COL_DIFF]);
    if (diff === 0 && (plan || actual)) diff = actual - plan;

    let status = "equal";
    if (diff > 0) status = "over";
    else if (diff < 0) status = "lack";

    let message = "";
    if (status === "equal") message = "Đủ kế hoạch";
    else if (status === "over") message = `Vượt ${diff}`;
    else message = `Thiếu ${Math.abs(diff)}`;

    alerts.push({
      hour,
      chuyen,
      plan,
      actual,
      diff,
      status,
      message,
    });
  }

  return alerts;
}

/* ==== 6. TỔNG HỢP THEO NGÀY ==== */
function buildDaySummary(hourAlerts) {
  const byChuyen = {};
  for (const item of hourAlerts) {
    if (!byChuyen[item.chuyen]) {
      byChuyen[item.chuyen] = { chuyen: item.chuyen, plan: 0, actual: 0 };
    }
    byChuyen[item.chuyen].plan += item.plan;
    byChuyen[item.chuyen].actual += item.actual;
  }

  const TARGET = 90; // % target

  return Object.values(byChuyen).map((item) => {
    const effDay =
      item.plan > 0 ? Number(((item.actual / item.plan) * 100).toFixed(2)) : 0;

    let status = "equal";
    if (effDay > TARGET) status = "over";
    else if (effDay < TARGET) status = "lack";

    return {
      chuyen: item.chuyen,
      effDay,
      targetEffDay: TARGET,
      status,
    };
  });
}

/* ==== 7. HÀM CHÍNH: computeKpi (KHÔNG PHẢI handleKpi) ==== */
async function computeKpi(dateStr) {
  const date = (dateStr || "").trim();
  if (!date) throw new Error("Thiếu tham số date (vd: 24/12/2025)");

  const { sheets, spreadsheetId } = await getSheetsClient();

  // 1) Tìm range trong sheet DATE
  const range = await getRangeForDate(sheets, spreadsheetId, date);
  if (!range) throw new Error(`Không tìm thấy RANGE cho ngày ${date}`);

  console.log("🔎 KPI V2:", { date, range });

  // 2) Lấy dữ liệu KPI block
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = res.data.values || [];

  // 3) Alert theo giờ
  const hourAlerts = buildHourAlerts(values);

  // 4) Tổng hợp ngày
  const dayAlerts = buildDaySummary(hourAlerts);

  return { date, range, hourAlerts, dayAlerts };
}

/* ==== 8. GET /api/kpi-v2?date=24/12/2025 ==== */
export async function GET(request) {
  console.log("✅ KPI V2 GET CALLED");

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "";

    const data = await computeKpi(date);

    return NextResponse.json({
      status: "success",
      ...data,
    });
  } catch (err) {
    console.error("❌ KPI V2 GET ERROR:", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "SERVER_ERROR",
      },
      { status: 500 },
    );
  }
}

/* ==== 9. POST /api/kpi-v2 ==== */
export async function POST(request) {
  console.log("✅ KPI V2 POST CALLED");

  try {
    const body = await request.json().catch(() => ({}));
    const date = body?.date || "";

    const data = await computeKpi(date);

    return NextResponse.json({
      status: "success",
      ...data,
    });
  } catch (err) {
    console.error("❌ KPI V2 POST ERROR:", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "SERVER_ERROR",
      },
      { status: 500 },
    );
  }
}