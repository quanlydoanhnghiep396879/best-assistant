import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "../../lib/googleSheetsClient";

export const runtime = "nodejs";

function findRangeForDate(configRows, date) {
  const row = configRows.find((r) => r.date === date);
  return row?.range;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json(
      { status: "error", message: "Thiếu query ?date=dd/mm/yyyy" },
      { status: 400 }
    );
  }

  try {
    const configRows = await readConfigRanges();
    const range = findRangeForDate(configRows, date);

    if (!range) {
      return NextResponse.json(
        { status: "error", message: "Không tìm thấy DATE trong CONFIG_KPI" },
        { status: 404 }
      );
    }

    const values = await readSheetRange(range);

    return NextResponse.json({
      status: "success",
      date,
      range,
      raw: values,     // QUAN TRỌNG: client của bạn đang đọc data.raw
      values,
    });
  } catch (err) {
    console.error("CHECK-KPI ERROR:", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
