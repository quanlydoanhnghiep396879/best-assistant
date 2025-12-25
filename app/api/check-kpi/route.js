import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RANGE THEO NGÀY
 * Em đã đo trong sheet:
 *   23/12/2025: KPI!A21:AJ37
 *   24/12/2025: KPI!A4:AJ18
 * Nếu sau này thêm ngày mới thì thêm vào đây.
 */
const DATE_MAP = {
  "2025-12-23": { range: "KPI!A21:AJ37" },
  "2025-12-24": { range: "KPI!A4:AJ18" },
};

/** CỘT (tính A = 0). Số cột nhớ chỉnh đúng theo sheet KPI. */
const COL_CHUYEN = 0;
const COL_DM_DAY = 6;       // DM/NGÀY (nếu cần sau này dùng)
const COL_DM_HOUR = 7;      // DM/H

const COL_9H = 8;
const COL_10H = 9;
const COL_11H = 10;
const COL_12H30 = 11;
const COL_13H30 = 12;
const COL_14H30 = 13;
const COL_15H30 = 14;
const COL_16H30 = 15;

const COL_EFF_DAY = 17;        // Hiệu suất đạt trong ngày
const COL_TARGET_EFF_DAY = 18; // Hiệu suất định mức trong ngày

// Cấu hình cột lũy tiến theo giờ
const HOUR_COLUMNS = [
  { label: "9h", index: COL_9H, hours: 1 },
  { label: "10h", index: COL_10H, hours: 2 },
  { label: "11h", index: COL_11H, hours: 3 },
  { label: "12h30", index: COL_12H30, hours: 4 },
  { label: "13h30", index: COL_13H30, hours: 5 },
  { label: "14h30", index: COL_14H30, hours: 6 },
  { label: "15h30", index: COL_15H30, hours: 7 },
  { label: "16h30", index: COL_16H30, hours: 8 },
];

/* ========= HÀM PHỤ ========= */
function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const t = String(v).trim();
  if (!t) return 0;
  const cleaned = t.replace("%", "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Xử lý 1 block dữ liệu của 1 ngày */
function buildKpiFromRows(rows) {
  const hourAlerts = [];
  const dayAlerts = [];

  for (const row of rows) {
    const chuyen = (row[COL_CHUYEN] || "").toString().trim();

    // Chỉ lấy C1, C2, ... C10; bỏ CẮT, KCS, HOÀN TẤT, NM...
    if (!/^C\d+/i.test(chuyen)) continue;

    const dmHour = toNumber(row[COL_DM_HOUR]);

    // ===== THEO GIỜ (LŨY TIẾN) =====
    for (const h of HOUR_COLUMNS) {
      const target = dmHour * h.hours;
      const actual = toNumber(row[h.index]);
      const diff = actual - target;

      let status = "equal";
      let message = "Đủ kế hoạch";

      if (diff > 0) {
        status = "over";
        message = `Vượt ${diff}`;
      } else if (diff < 0) {
        status = "lack";
        message = `Thiếu ${Math.abs(diff)}`;
      }

      hourAlerts.push({
        chuyen,
        hour: h.label,
        target,
        actual,
        diff,
        status,
        message,
      });
    }

    // ===== HIỆU SUẤT NGÀY =====
    let effDay = toNumber(row[COL_EFF_DAY]);
    let targetEffDay = toNumber(row[COL_TARGET_EFF_DAY]);

    // Nếu trong sheet là 0.95 thì chuyển thành 95 (%)
    if (effDay > 0 && effDay <= 1) effDay *= 100;
    if (targetEffDay > 0 && targetEffDay <= 1) targetEffDay *= 100;

    const statusDay = effDay >= targetEffDay ? "day_ok" : "day_fail";

    dayAlerts.push({
      chuyen,
      effDay,
      targetEffDay,
      status: statusDay,
    });
  }

  return { hourAlerts, dayAlerts };
}

/** Lấy dữ liệu từ Google Sheets cho 1 ngày */
async function handleRequest(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "2025-12-24";
  const result = await handleKpi(date);

  return NextResponse.json({
    status: "success",
    date,
    ...result,
  });
}

export async function POST(request) {
  console.log("✅ CHECK KPI API CALLED (POST)");
  try {
    return await handleRequest(request);
  } catch (err) {
    console.error("❌ KPI API ERROR (POST):", err);
    return NextResponse.json(
      { status: "error", message: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  console.log("✅ CHECK KPI API CALLED (GET)");
  try {
    return await handleRequest(request);
  } catch (err) {
    console.error("❌ KPI API ERROR (GET):", err);
    return NextResponse.json(
      { status: "error", message: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}