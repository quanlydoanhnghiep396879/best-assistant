// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { google } from "googleapis";

const CONFIG_SHEET_NAME = "CONFIG_KPI";

/* ====== AUTH GOOGLE ====== */
function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!clientEmail || !privateKeyBase64 || !sheetId) {
    console.error("Missing env", {
      hasEmail: !!clientEmail,
      hasKey: !!privateKeyBase64,
      hasSheet: !!sheetId,
    });
    return null;
  }

  const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf8");

  const auth = new google.auth.JWT(
    clientEmail,
    undefined,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  );

  return auth;
}

/* ====== ĐỌC CONFIG_KPI: map ngày -> range ====== */
async function getDateRangeMap(auth) {
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${CONFIG_SHEET_NAME}!A2:B`,
  });

  const rows = res.data.values || [];
  const dateRangeMap = {};
  const dates = [];

  for (const row of rows) {
    const [dateCell, rangeCell] = row;
    if (!dateCell || !rangeCell) continue;

    const date = String(dateCell).trim();
    const range = String(rangeCell).trim();

    if (!date || !range) continue;

    dates.push(date);
    dateRangeMap[date] = range;
  }

  return { dates, dateRangeMap };
}

/* ====== HÀM ÉP SỐ AN TOÀN ====== */
function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v).trim().replace(/,/g, "");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/* ====== PHÂN TÍCH BẢNG KPI (range 1 ngày) ====== */
function parseKpi(values) {
  if (!values || values.length < 2) {
    return { hourAlerts: [], dayAlerts: [] };
  }

  const header = values[0].map((h) => (h || "").toString().trim());

  const idxHour = header.findIndex((h) => /^giờ$/i.test(h));
  const idxLine = header.findIndex((h) => /^chuyền$/i.test(h));
  const idxPlan = header.findIndex((h) => /kế hoạch/i.test(h));
  const idxActual = header.findIndex((h) => /thực tế/i.test(h));

  if (idxHour === -1 || idxLine === -1 || idxPlan === -1 || idxActual === -1) {
    console.warn("Không tìm thấy đủ cột Giờ/Chuyền/Kế hoạch/Thực tế");
    return { hourAlerts: [], dayAlerts: [] };
  }

  const hourAlerts = [];
  const aggByLine = new Map();

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const hour = row[idxHour];
    const line = row[idxLine];

    if (!hour || !line) continue;

    const plan = toNumberSafe(row[idxPlan]);
    const actual = toNumberSafe(row[idxActual]);
    const diff = actual - plan;

    let status;
    let message;

    if (diff === 0) {
      status = "equal";
      message = "Đủ kế hoạch";
    } else if (diff > 0) {
      status = "over";
      message = `Vượt ${diff} SP`;
    } else {
      status = "lack";
      message = `Thiếu ${-diff} SP`;
    }

    hourAlerts.push({
      chuyen: line,
      hour,
      target: plan,
      actual,
      diff,
      status,
      message,
    });

    const agg = aggByLine.get(line) || { chuyen: line, target: 0, actual: 0 };
    agg.target += plan;
    agg.actual += actual;
    aggByLine.set(line, agg);
  }

  const dayAlerts = [];
  for (const agg of aggByLine.values()) {
    const diff = agg.actual - agg.target;
    let status;
    let message;

    if (diff === 0) {
      status = "equal";
      message = "Đủ kế hoạch ngày";
    } else if (diff > 0) {
      status = "over";
      message = `Vượt ${diff} SP trong ngày`;
    } else {
      status = "lack";
      message = `Thiếu ${-diff} SP trong ngày`;
    }

    dayAlerts.push({ ...agg, diff, status, message });
  }

  return { hourAlerts, dayAlerts };
}

/* ====== API GET /api/check-kpi ====== */
export async function GET(request) {
  console.log("✅ CHECK KPI API CALLED (GET)");

  const url = new URL(request.url);
  const date = url.searchParams.get("date"); // có thể null

  const auth = getGoogleAuth();
  if (!auth) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "Thiếu biến môi trường GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SHEET_ID",
      },
      { status: 500 },
    );
  }

  try {
    await auth.authorize();

    const { dates, dateRangeMap } = await getDateRangeMap(auth);

    // Nếu chỉ gọi /api/check-kpi để lấy danh sách ngày
    if (!date) {
      if (!dates.length) {
        return NextResponse.json({
          status: "error",
          message: "Không có ngày nào trong CONFIG_KPI",
          dates: [],
        });
      }

      return NextResponse.json({
        status: "success",
        dates,
      });
    }

    // Có date → lấy range tương ứng
    const range = dateRangeMap[date];
    if (!range) {
      return NextResponse.json(
        {
          status: "error",
          message: `Không tìm thấy ngày ${date} trong CONFIG_KPI`,
          dates,
        },
        { status: 404 },
      );
    }

    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range,
    });

    const values = res.data.values || [];
    const { hourAlerts, dayAlerts } = parseKpi(values);

    return NextResponse.json({
      status: "success",
      date,
      range,
      hourAlerts,
      dayAlerts,
      rawValues: values, // để debug nếu cần
    });
  } catch (err) {
    console.error("❌ KPI API ERROR (GET):", err);
    return NextResponse.json(
      {
        status: "error",
        message: err.message || String(err),
      },
      { status: 500 },
    );
  }
}
