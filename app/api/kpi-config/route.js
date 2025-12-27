// app/api/kpi-config/route.js
import { NextResponse } from "next/server";
import { readConfigRanges } from "../../lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const configRows = await readConfigRanges();

    // lấy list date, lọc rỗng, unique, sort theo thời gian
    const dates = Array.from(
      new Set(configRows.map((r) => r.date).filter(Boolean))
    ).sort((a, b) => {
      // sort dd/mm/yyyy
      const toTime = (s) => {
        const [dd, mm, yyyy] = String(s).split("/").map(Number);
        return new Date(yyyy, mm - 1, dd).getTime();
      };
      return toTime(a) - toTime(b);
    });

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
