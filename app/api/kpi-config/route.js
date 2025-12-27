import { NextResponse } from "next/server";
import { readConfigRanges } from "../../lib/googleSheetsClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const configRows = await readConfigRanges();
    const dates = configRows.map((r) => r.date);

    return NextResponse.json({
      status: "success",
      dates,
      configRows,
    });
  } catch (err) {
    console.error("KPI-CONFIG ERROR:", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
