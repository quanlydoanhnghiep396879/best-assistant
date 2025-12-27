import { NextResponse } from "next/server";
import sheetsClient from "../../lib/googleSheetsClient.js";

export const runtime = "nodejs";

export async function GET() {
  try {
    const configRows = await sheetsClient.readConfigRanges();
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
