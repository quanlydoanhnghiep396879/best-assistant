import { NextResponse } from "next/server";
import * as Sheets from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickFn(name) {
  return Sheets[name] || Sheets.default?.[name];
}

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
    const readConfigRanges = pickFn("readConfigRanges");
    const readSheetRange = pickFn("readSheetRange");

    if (typeof readConfigRanges !== "function" || typeof readSheetRange !== "function") {
      return NextResponse.json(
        {
          status: "error",
          message: "Sheets functions missing (import/export mismatch)",
          debug: {
            keys: Object.keys(Sheets),
            defaultKeys: Sheets.default ? Object.keys(Sheets.default) : null,
            typeof_readConfigRanges: typeof Sheets.readConfigRanges,
            typeof_readSheetRange: typeof Sheets.readSheetRange,
            typeof_default_readConfigRanges: typeof Sheets.default?.readConfigRanges,
            typeof_default_readSheetRange: typeof Sheets.default?.readSheetRange,
          },
        },
        { status: 500 }
      );
    }

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
      raw: values,
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
