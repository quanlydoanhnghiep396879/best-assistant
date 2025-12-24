/* eslint-disable */
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========= CẤU HÌNH CỘT (TÍNH TỪ H5) =========
   Đọc range KPI!H5:T200  → index 0 = cột H  */
const COL_DM_DAY = 0;          // H: DM/NGÀY
const COL_DM_HOUR = 1;         // I: DM/H
const COL_9H = 2;              // J: 9h
const COL_10H = 3;             // K: 10h
const COL_11H = 4;             // L: 11h
const COL_12H30 = 5;           // M: 12h30
const COL_13H30 = 6;           // N: 13h30
const COL_14H30 = 7;           // O: 14h30
const COL_15H30 = 8;           // P: 15h30
const COL_16H30 = 9;           // Q: 16h30
const COL_TG_SX = 10;          // R: TG SX (giờ sản xuất)
const COL_EFF_DAY = 11;        // S: HIỆU SUẤT ĐẠT TRONG NGÀY (%)
const COL_TARGET_EFF_DAY = 12; // T: ĐỊNH MỨC HIỆU SUẤT NGÀY (%)

// mỗi cột giờ + số giờ lũy tiến tương ứng
const HOUR_COLUMNS = [
  { label: "9h",     index: COL_9H,     hours: 1 },
  { label: "10h",    index: COL_10H,    hours: 2 },
  { label: "11h",    index: COL_11H,    hours: 3 },
  { label: "12h30",  index: COL_12H30,  hours: 4 },
  { label: "13h30",  index: COL_13H30,  hours: 5 },
  { label: "14h30",  index: COL_14H30,  hours: 6 },
  { label: "15h30",  index: COL_15H30,  hours: 7 },
  { label: "16h30",  index: COL_16H30,  hours: 8 },
];

/* ========= HÀM PHỤ ========= */

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const t = String(v).replace(/,/g, "").trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

// "95.87%" -> 95.87
function toPercentNumber(v) {
  if (v === null || v === undefined) return 0;
  const t = String(v).replace("%", "").replace(",", ".").trim();
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/* ========= GOOGLE AUTH (BASE64 PRIVATE KEY) ========= */

async function getGoogleAuth() {
  const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (!base64Key) throw new Error("Missing GOOGLE_PRIVATE_KEY_BASE64");
  if (!email) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL");

  // decode base64 → PEM
  let privateKey = Buffer.from(base64Key, "base64")
    .toString("utf8")
    .replace(/\r/g, "");

  // chỉ lấy block PRIVATE KEY
  const match = privateKey.match(
    /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/
  );
  if (!match) {
    throw new Error("Decoded key does not contain a PRIVATE KEY block");
  }
  privateKey = match[0].trim();

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

/* ========= LOGIC CHÍNH ========= */

async function handleKpi() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID");

  const auth = await getGoogleAuth();
  await auth.authorize();

  const sheets = google.sheets({ version: "v4", auth });

  // tên chuyền ở cột B
  const namesRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "KPI!A4:A200",
  });

  // dữ liệu KPI ở cột H → T
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "KPI!H4:T200",
  });

  const names = namesRes.data.values || [];
  const rows = dataRes.data.values || [];

  const hourAlerts = [];
  const dayAlerts = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const chuyen = names[i]?.[0] || `Row ${i + 5}`;
    const dmHour = toNumber(row[COL_DM_HOUR]);
    const tgSx = toNumber(row[COL_TG_SX]);

    // ===== KIỂM SOÁT THEO GIỜ (LŨY TIẾN) =====
    for (const h of HOUR_COLUMNS) {
      const actual = toNumber(row[h.index]);
      if (actual === 0 && dmHour === 0) continue; // không có dữ liệu

      const target = dmHour * h.hours; // kế hoạch lũy tiến
      const diff = actual - target;
      const status = diff === 0 ? "equal" : diff > 0 ? "over" : "lack";

      hourAlerts.push({
        chuyen,
        hour: h.label,
        target,
        actual,
        diff,
        status,
        message:
          status === "equal"
            ? "Đủ kế hoạch"
            : status === "over"
            ? `Vượt ${diff} sp`
            : `Thiếu ${Math.abs(diff)} sp`,
      });
    }

    // ===== HIỆU SUẤT TRONG NGÀY (KHI TG SX ≥ 8 GIỜ) =====
    if (tgSx >= 8) {
      const effDay = toPercentNumber(row[COL_EFF_DAY]);
      const targetEffDay = toPercentNumber(row[COL_TARGET_EFF_DAY]);
      const statusDay = effDay >= targetEffDay ? "day_ok" : "day_fail";

      dayAlerts.push({
        chuyen,
        effDay,
        targetEffDay,
        status: statusDay,
      });
    }
  }

  return { hourAlerts, dayAlerts };
}

/* ========= ROUTES ========= */

export async function POST() {
  try {
    const result = await handleKpi();
    return NextResponse.json({
      status: "success",
      hourAlerts: result.hourAlerts,
      dayAlerts: result.dayAlerts,
    });
  } catch (err) {
    console.error("❌ KPI API ERROR:", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}