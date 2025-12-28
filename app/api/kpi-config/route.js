import { NextResponse } from "next/server";
import { readSheetRange } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const values = await readSheetRange("CONFIG_KPI!A2:B");

    const rows = values
      .map((r) => ({
        date: (r?.[0] || "").toString().trim(),
        range: (r?.[1] || "").toString().trim(),
      }))
      .filter((x) => x.date && x.range);

    const dates = rows.map((x) => x.date);

    return NextResponse.json({ dates, rows }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ message: e?.message || String(e) }, { status: 500 });
  }
}
