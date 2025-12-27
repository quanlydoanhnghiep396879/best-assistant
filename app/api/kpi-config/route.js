import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";

function getServiceAccountKeyFile() {
  const base64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (!base64) throw new Error("Thiếu env GOOGLE_PRIVATE_KEY_BASE64");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
}

function getSheetsClient() {
  const keyFile = getServiceAccountKeyFile();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("Thiếu env GOOGLE_SHEET_ID");

  const auth = new google.auth.JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

async function readRange(range) {
  const { sheets, spreadsheetId } = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

export async function GET() {
  try {
    const configSheet = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
    const rows = await readRange(`${configSheet}!A2:B500`);

    const configRows = (rows || [])
      .filter((r) => r?.[0] && r?.[1])
      .map((r) => ({
        date: String(r[0]).trim(),
        range: String(r[1]).trim(),
      }));

    const dates = configRows.map((r) => r.date);

    return NextResponse.json(
      { status: "success", dates, configRows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
