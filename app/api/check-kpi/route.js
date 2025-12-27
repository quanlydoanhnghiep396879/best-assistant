import { NextResponse } from "next/server";
import {
  readSheetRange,
  readConfigRanges,
} from "../../lib/googleSheetsClient";

function findRangeForDate(configRows, date) {
  const row = configRows.find((r) => r.date === date);
  return row?.range;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json(
      {
        status: "error",
        message: "Thiếu query ?date=dd/mm/yyyy",
      },
      { status: 400 }
    );
  }

  try {
    // Lấy danh sách ngày + range từ CONFIG_KPI
    const configRows = await readConfigRanges();
    const range = findRangeForDate(configRows, date);

    if (!range) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Range đang đọc: (không tìm thấy trong CONFIG_KPI)",
        },
        { status: 404 }
      );
    }

    // Đọc dữ liệu KPI theo range tìm được
    const values = await readSheetRange(range);

    return NextResponse.json({
      status: "success",
      date,
      range,
      values,
    });
  } catch (err) {
    console.error("CHECK-KPI ERROR:", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
