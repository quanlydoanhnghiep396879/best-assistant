// app/api/kpi-config/route.js
import { NextResponse } from "next/server";
import { getSheetsClient, getSpreadsheetId } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_SHEET = "CONFIG_KPI"; // đúng tên tab

function normDate(s) {
  return String(s || "").trim();
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list");
    const date = searchParams.get("date");

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${CONFIG_SHEET}!A2:B`,
    });

    const rows = res.data.values || [];
    const map = {};
    for (const r of rows) {
      const d = normDate(r?.[0]);
      const range = String(r?.[1] || "").trim();
      if (d && range) map[d] = range;
    }

    if (list === "1") {
      return NextResponse.json(
        { ok: true, dates: Object.keys(map) },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (date) {
      const range = map[date];
      return NextResponse.json(
        { ok: !!range, date, range: range || null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { ok: true, map },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}