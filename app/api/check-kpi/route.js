// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========= HÀM DECODE PRIVATE KEY BASE64 ========= */
function getGoogleAuthConfig() {
  const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!base64Key || !clientEmail || !spreadsheetId) {
    throw new Error("Thiếu env: GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SHEET_ID");
  }

  const privateKey = Buffer.from(base64Key, "base64")
    .toString("utf8")
    .replace(/\r/g, "")
    .trim();

  return { privateKey, clientEmail, spreadsheetId };
}

/* ========= TẠO GOOGLE AUTH ========= */
async function createSheetsClient() {
  const { privateKey, clientEmail, spreadsheetId } = getGoogleAuthConfig();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  await auth.authorize();

  const sheets = google.sheets({ version: "v4", auth });

  return { sheets, spreadsheetId };
}

/* ========= HÀM ÉP KIỂU SỐ AN TOÀN ========= */
function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim().replace(/,/g, "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/* ========= LẤY RANGE THEO NGÀY TỪ SHEET DATE =========
   Sheet DATE có dạng:
   A1: DATE | B1: RANGE
   A2: 23/12/2025 | B2: KPI!A21:AJ37
   A3: 24/12/2025 | B3: KPI!A4:AJ18
*/
async function getRangeByDate(sheets, spreadsheetId, dateStr) {
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

    if (d === target) {
      return r; // ví dụ: "KPI!A4:AJ18"
    }
  }

  return null;
}

/* ========= CHUYỂN BẢNG KPI THÀNH DANH SÁCH CẢNH BÁO =========
   Giả sử range KPI chọn đúng block:
   - Hàng đầu: header: Giờ | Chuyền | Kế hoạch lũy tiến | Thực tế | Chênh lệch | Trạng thái ...
   - Từ hàng 2 trở đi là dữ liệu.
*/
function transformKpiValues(values) {
  const result = [];
  if (!values || values.length === 0) return result;

  const COL_HOUR = 0;   // cột A
  const COL_CHUYEN = 1; // cột B
  const COL_PLAN = 2;   // cột C – Kế hoạch lũy tiến
  const COL_ACTUAL = 3; // cột D – Thực tế
  const COL_DIFF = 4;   // cột E – Chênh lệch (có thể có hoặc không)
  // cột F thường là "Trạng thái" nhưng ta tự tính lại cho chắc.

  // Bỏ hàng header (index 0)
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const hour = row[COL_HOUR] || "";
    const chuyen = row[COL_CHUYEN] || "";

    if (!hour || !chuyen) continue; // bỏ dòng trống

    const plan = toNumberSafe(row[COL_PLAN]);
    const actual = toNumberSafe(row[COL_ACTUAL]);

    // Nếu sheet đã có chênh lệch thì dùng, không thì tự tính
    let diff = toNumberSafe(row[COL_DIFF]);
    if (diff === 0 && (plan || actual)) {
      diff = actual - plan;
    }

    let status = "equal";
    if (diff > 0) status = "over";
    else if (diff < 0) status = "lack";

    let message = "";
    if (status === "equal") message = "Đủ kế hoạch";
    else if (status === "over") message = `Vượt ${diff}`;
    else message = `Thiếu ${Math.abs(diff)}`;

    result.push({
      hour,
      chuyen,
      plan,
      actual,
      diff,
      status,
      message,
    });
  }

  return result;
}

/* ========= TÍNH TỔNG NGÀY THEO CHUYỀN ========= */
function buildDaySummary(hourAlerts) {
  const byChuyen = {};

  for (const row of hourAlerts) {
    if (!byChuyen[row.chuyen]) {
      byChuyen[row.chuyen] = {
        chuyen: row.chuyen,
        plan: 0,
        actual: 0,
      };
    }
    byChuyen[row.chuyen].plan += row.plan;
    byChuyen[row.chuyen].actual += row.actual;
  }

  const TARGET_EFF_DAY = 90; // % mục tiêu trong ngày – em chỉnh tuỳ ý

  return Object.values(byChuyen).map((item) => {
    const effDay = item.plan > 0 ? (item.actual / item.plan) * 100 : 0;
    let status = "equal";
    if (effDay > TARGET_EFF_DAY) status = "over";
    else if (effDay < TARGET_EFF_DAY) status = "lack";

    return {
      chuyen: item.chuyen,
      effDay: Number(effDay.toFixed(2)),
      targetEffDay: TARGET_EFF_DAY,
      status,
    };
  });
}

/* ========= HÀM CHÍNH XỬ LÝ KPI ========= */
async function handleKpi(dateStr) {
  const date = (dateStr || "").trim();
  if (!date) {
    throw new Error("Thiếu tham số date (vd: 24/12/2025)");
  }

  const { sheets, spreadsheetId } = await createSheetsClient();

  // 1) Tìm range tương ứng ngày trong sheet DATE
  const range = await getRangeByDate(sheets, spreadsheetId, date);
  if (!range) {
    throw new Error(`Không tìm thấy RANGE cho ngày ${date} trong sheet DATE`);
  }

  // 2) Lấy dữ liệu KPI theo range đó
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = res.data.values || [];

  // 3) Chuyển thành danh sách cảnh báo giờ
  const hourAlerts = transformKpiValues(values);

  // 4) Tổng hợp theo ngày
  const dayAlerts = buildDaySummary(hourAlerts);

  return {
    date,
    range,
    hourAlerts,
    dayAlerts,
  };
}

/* ========= ROUTES ========= */

// GET /api/check-kpi?date=24/12/2025
export async function GET(request) {
  console.log("✅ CHECK KPI API CALLED (GET)");

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "";

    const result = await handleKpi(date);
    return NextResponse.json({ status: "success", ...result });
  } catch (err) {
    console.error("❌ KPI API ERROR (GET):", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/check-kpi  (body: { "date": "24/12/2025" })
export async function POST(request) {
  console.log("✅ CHECK KPI API CALLED (POST)");

  try {
    const body = await request.json().catch(() => ({}));
    const date = body?.date || "";

    const result = await handleKpi(date);
    return NextResponse.json({ status: "success", ...result });
  } catch (err) {
    console.error("❌ KPI API ERROR (POST):", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
