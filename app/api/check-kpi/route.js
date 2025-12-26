import { NextResponse } from "next/server";
import { readSheetRange } from "../../lib/googleSheetsClient";

const CONFIG_SHEET_NAME =
  process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";

export async function GET() {
  try {
    // Đọc A2:B1000 (DATE, RANGE)
    const rows = await readSheetRange(`${CONFIG_SHEET_NAME}!A2:B1000`);
    const configRows = (rows || []).filter((r) => r[0] && r[1]);

    if (!configRows.length) {
      return NextResponse.json(
        {
          status: "error",
          message: "Không có ngày nào trong CONFIG_KPI",
        },
        { status: 500 }
      );
    }

    const dates = configRows.map((r) => r[0]);

    return NextResponse.json({
      status: "success",
      dates,
      configRows, // [[date, range], ...]
    });
  } catch (err) {
    console.error("KPI-CONFIG ERROR:", err);
    return NextResponse.json(
      {
        status: "error",
          // ép về string cho chắc
        message: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}
