import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "@/app/lib/googleSheetsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function findRangeForDate(configRows, date) {
  const key = String(date || "").trim();
  const row = (configRows || []).find((r) => String(r.date || "").trim() === key);
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
        { status: "error", message: "Không tìm thấy RANGE trong CONFIG_KPI cho ngày này" },
        { status: 404 }
      );
    }

    const values = await readSheetRange(range);

    return NextResponse.json({
      status: "success",
      date,
      range,
      raw: values,
      headerPreview: values?.[0] || [],
      rowsCount: values?.length || 0,
    });
  } catch (err) {
    console.error("CHECK-KPI ERROR:", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
