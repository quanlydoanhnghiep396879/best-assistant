// app/api/kpi-config/route.js
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
  privateKey = privateKey.replace(/\\n/g, "\n"); // phòng khi base64 kiểu có \\n

  return new google.auth.JWT(
    email,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  );
}

export async function GET() {
  try {
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

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_SHEET_NAME}!A2:B`, // A: DATE, B: RANGE
    });

    const rows = res.data.values || [];

    const dates = rows
      .map((r) => (r[0] || "").trim())
      .filter((d) => d.length > 0);

    return NextResponse.json({
      status: "success",
      dates,
      rows, // giữ lại để debug nếu cần
    });
  } catch (err) {
    console.error("KPI-CONFIG ERROR", err);
    return NextResponse.json(
      { status: "error", message: String(err) },
      { status: 500 }
    );
  }
}
