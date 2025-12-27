import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "@/app/lib/googleSheetsClient";
// nếu không có alias @ thì dùng: "../../lib/googleSheetsClient"

function norm(v) {
  return String(v || "").trim();
}

function findRangeForDate(configRows, date) {
  const d = norm(date);
  const hit = (configRows || []).find((r) => norm(r.date) === d);
  return hit?.range || "";
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

    const raw = await readSheetRange(range);

    return NextResponse.json({
      status: "success",
      date,
      range,
      raw,
      debug: {
        firstRow: raw?.[0] || null,
        secondRow: raw?.[1] || null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
