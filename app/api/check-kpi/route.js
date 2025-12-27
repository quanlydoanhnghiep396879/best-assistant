import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "../../lib/googleSheetsClient.js";

export const runtime = "nodejs"; // bắt buộc để chạy googleapis

function findRangeForDate(configRows, date) {
  const d = String(date || "").trim();
  const row = (configRows || []).find((r) => String(r.date).trim() === d);
  return row?.range ? String(row.range).trim() : "";
}

export async function GET(request) {
  try {
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

    // 1) Đọc CONFIG_KPI để lấy range theo ngày
    const configRows = await readConfigRanges();
    const range = findRangeForDate(configRows, date);

    if (!range) {
      return NextResponse.json(
        {
          status: "error",
          message: "Không tìm thấy ngày trong CONFIG_KPI",
          date: String(date).trim(),
        },
        { status: 404 }
      );
    }

    // 2) Đọc dữ liệu KPI theo range
    const values = await readSheetRange(range);

    return NextResponse.json({
      status: "success",
      date: String(date).trim(),
      range,
      raw: values, // ✅ khớp với KpiDashboardClient (data.raw)
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
