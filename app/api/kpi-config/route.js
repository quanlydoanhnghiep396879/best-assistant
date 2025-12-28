// app/api/kpi-config/route.js
import { NextResponse } from "next/server";
import { listKpiDates } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const dates = await listKpiDates(); // already sorted ASC (23 then 24)
    return NextResponse.json({ ok: true, dates });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "KPI_CONFIG_ERROR", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}