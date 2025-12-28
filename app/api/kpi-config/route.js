import { NextResponse } from "next/server";
import { readRange } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function excelSerialToDateString(serial) {
  // Google sheet serial ~ Excel (1899-12-30)
  const base = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(base.getTime() + Number(serial) * 86400000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDate(x) {
  if (x == null) return "";
  const s = String(x).trim();
  if (!s) return "";
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToDateString(s);
  // nếu đã là dd/mm/yyyy
  return s;
}

export async function GET() {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json(
        { status: "error", message: "Missing GOOGLE_SHEET_ID" },
        { status: 500 }
      );
    }

    const values = await readRange(spreadsheetId, "CONFIG_KPI!A2:B");
    const map = {};
    const dates = [];

    for (const row of values) {
      const date = normalizeDate(row?.[0]);
      const range = String(row?.[1] || "").trim();
      if (!date || !range) continue;
      map[date] = range;
      dates.push(date);
    }

    
    return NextResponse.json(
      { status: "ok", dates, map },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}
