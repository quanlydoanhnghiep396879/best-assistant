import { NextResponse } from "next/server";
import { google } from "googleapis";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

// ====== Mốc giờ ======
const CHECKPOINT_HOURS = {
  "->9h": 1,
  "->10h": 2,
  "->11h": 3,
  "->12h30": 4,
  "->13h30": 5,
  "->14h30": 6,
  "->15h30": 7,
  "->16h30": 8,
};

const HOURLY_TOLERANCE = Number(process.env.HOURLY_TOLERANCE ?? 0.95);
const DAILY_TARGET = Number(process.env.DAILY_TARGET ?? 0.9);

// Option 2+ (khuyến nghị): vẫn FAIL nhưng số thay đổi lớn thì gửi update
const RESEND_FAIL_DELTA_PCT = Number(process.env.RESEND_FAIL_DELTA_PCT ?? 0.10); // 10%
const RESEND_FAIL_DELTA_MIN = Number(process.env.RESEND_FAIL_DELTA_MIN ?? 20);  // 20 sp

const LOG_SHEET = process.env.MAIL_LOG_SHEET_NAME || "MAIL_LOG";

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
function toNum(v) {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/,/g, "").replace("%", "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function vnDateStrNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("day")}/${get("month")}/${get("year")}`;
}

// ===== Google Sheets =====
function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
}
function getSheetsClient() {
  const keyFile = getServiceAccountKeyFile();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Thiếu env GOOGLE_SHEET_ID");

  // cần ghi MAIL_LOG => scope spreadsheets
  const auth = new google.auth.JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}
async function readRange(range) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}
async function appendRow(range, row) {
  const { sheets, spreadsheetId } = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

// ===== CONFIG_KPI date->range =====
async function getRangeForDate(dateStr) {
  const configSheet = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
  const rows = await readRange(`${configSheet}!A2:B500`);
  const found = rows.find(
    (r) => String(r?.[0] || "").trim() === String(dateStr).trim()
  );
  return found ? String(found[1]).trim() : "";
}

// ===== MAIL =====
function getMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("Thiếu SMTP env (SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}
async function sendEmail(subject, text) {
  const to = (process.env.ALERT_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!to.length) throw new Error("Thiếu env ALERT_TO");

  const from = process.env.ALERT_FROM || process.env.SMTP_USER;
  await getMailer().sendMail({ from, to, subject, text });
}

// ===== LOG (MAIL_LOG: timestamp | date | key | type | detail) =====
async function logSent(key, type, detail) {
  await appendRow(`${LOG_SHEET}!A:E`, [
    new Date().toISOString(),
    vnDateStrNow(),
    key,
    type,
    detail,
  ]);
}
async function getLastStatus(baseKey) {
  const rows = await readRange(`${LOG_SHEET}!A2:E5000`);
  for (let i = rows.length - 1; i >= 0; i--) {
    const k = String(rows[i]?.[2] || "").trim(); // col C
    if (k.startsWith(baseKey + "|")) {
      const status = k.split("|").pop();         // OK/FAIL
      const detail = String(rows[i]?.[4] || ""); // col E
      let lastActual = null;
      try { lastActual = JSON.parse(detail)?.actual ?? null; } catch {}
      return { status, lastActual };
    }
  }
  return null;
}

// ===== GET: Dashboard đọc data =====
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json(
      { status: "error", message: "Thiếu query ?date=dd/mm/yyyy" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const range = await getRangeForDate(date);
    if (!range) {
      return NextResponse.json(
        { status: "error", message: "Không tìm thấy date trong CONFIG_KPI" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    const values = await readRange(range);
    return NextResponse.json(
      { status: "success", date, range, raw: values },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// ===== POST: chỉ gọi khi dashboard phát hiện thay đổi lũy tiến =====
export async function POST(request) {
  try {
    const { date, changes } = await request.json();
    if (!date || !Array.isArray(changes) || !changes.length) {
      return NextResponse.json(
        { status: "error", message: "Thiếu date/changes" },
        { status: 400 }
      );
    }

    const rangeA1 = await getRangeForDate(date);
    if (!rangeA1) {
      return NextResponse.json(
        { status: "error", message: "Không tìm thấy date trong CONFIG_KPI" },
        { status: 404 }
      );
    }

    const values = await readRange(rangeA1);
    if (values.length < 2) {
      return NextResponse.json(
        { status: "error", message: "Range KPI rỗng" },
        { status: 500 }
      );
    }

    const header = values[0];
    const body = values.slice(1);

    const idx = {};
    header.forEach((h, i) => (idx[norm(h)] = i));

    const iLine =
      idx[norm("CHUYEN")] ??
      idx[norm("CHUYỀN")] ??
      idx[norm("LINE")] ??
      0;

    const iDMH = idx[norm("DM/H")] ?? idx[norm("ĐM/H")];
    const iDMD = idx[norm("DM/NGAY")] ?? idx[norm("ĐM/NGÀY")];

    const cpCol = {};
    header.forEach((h, i) => {
      const k = String(h || "").trim();
      if (CHECKPOINT_HOURS[k]) cpCol[k] = i;
    });

    const hourlyLines = [];
    const dailyLines = [];

    for (const ch of changes) {
      const checkpoint = String(ch.checkpoint || "").trim();
      const lineName = String(ch.lineName || "").trim();
      if (!CHECKPOINT_HOURS[checkpoint] || !lineName) continue;

      const col = cpCol[checkpoint];
      if (col == null) continue;

      const row = body.find(
        (r) => String(r?.[iLine] || "").trim() === lineName
      );
      if (!row) continue;

      const dmH = iDMH != null ? toNum(row[iDMH]) : 0;
      const dmD = iDMD != null ? toNum(row[iDMD]) : 0;
      const dmPerHour = dmH > 0 ? dmH : dmD > 0 ? dmD / 8 : 0;

      const hours = CHECKPOINT_HOURS[checkpoint];
      const actual = toNum(row[col]);
      const target = dmPerHour * hours;

      const baseKey = `${date}|HOURLY|${checkpoint}|${lineName}`;
      const statusNow =
        target > 0 && actual < target * HOURLY_TOLERANCE ? "FAIL" : "OK";
      const last = await getLastStatus(baseKey);

      let shouldSend = false;
      let mailType = "";

      if (!last) {
        if (statusNow === "FAIL") {
          shouldSend = true;
          mailType = "ALERT";
        }
      } else {
        if (last.status !== statusNow) {
          shouldSend = true;
          mailType = statusNow === "FAIL" ? "ALERT" : "RECOVER";
        } else if (statusNow === "FAIL") {
          const lastActual = last.lastActual ?? actual;
          const deltaAbs = Math.abs(lastActual - actual);
          const threshold = Math.max(
            RESEND_FAIL_DELTA_MIN,
            target * RESEND_FAIL_DELTA_PCT
          );
          if (deltaAbs >= threshold) {
            shouldSend = true;
            mailType = "UPDATE";
          }
        }
      }

      if (shouldSend) {
        const thieu = Math.round(target - actual);

        if (mailType === "ALERT") {
          hourlyLines.push(
            `[ALERT] ${checkpoint} | ${lineName}: ${actual}/${Math.round(target)} (thiếu ${thieu})`
          );
        } else if (mailType === "RECOVER") {
          hourlyLines.push(
            `[OK] ${checkpoint} | ${lineName}: ${actual}/${Math.round(target)}`
          );
        } else {
          hourlyLines.push(
            `[UPDATE] ${checkpoint} | ${lineName}: ${actual}/${Math.round(target)} (vẫn thiếu ${thieu})`
          );
        }

        await logSent(
          `${baseKey}|${statusNow}`,
          "HOURLY",
          JSON.stringify({ actual, target: Math.round(target) })
        );
      }

      // Daily: khi sửa ->16h30
      if (checkpoint === "->16h30" && dmD > 0) {
        const eff = actual / dmD;
        const ok = eff >= DAILY_TARGET;

        await logSent(
          `${date}|DAILY|${lineName}|${ok ? "OK" : "FAIL"}`,
          "DAILY",
          JSON.stringify({ actual, dmD, eff: Number((eff * 100).toFixed(2)) })
        );

        dailyLines.push(
          `${lineName}: ${actual}/${dmD} = ${(eff * 100).toFixed(2)}% => ${ok ? "ĐẠT" : "KHÔNG ĐẠT"}`
        );
      }
    }

    if (hourlyLines.length) {
      await sendEmail(
        `[KPI GIỜ] ${date} - cập nhật ${hourlyLines.length} dòng`,
        hourlyLines.join("\n")
      );
    }
    if (dailyLines.length) {
      await sendEmail(`[KPI CUỐI NGÀY] ${date}`, dailyLines.join("\n"));
    }

    return NextResponse.json({
      status: "success",
      hourly: hourlyLines.length,
      daily: dailyLines.length,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
