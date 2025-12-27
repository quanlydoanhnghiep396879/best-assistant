// app/api/kpi-config/route.js
import { NextResponse } from "next/server";
import { readConfigRanges } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const configRows = await readConfigRanges();
    const dates = configRows.map((x) => x.date);

    return NextResponse.json(
      { status: "success", dates, configRows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e?.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
