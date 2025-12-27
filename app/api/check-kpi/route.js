import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function loadSheetsLib() {
  const mod = await import("../../lib/googleSheetsClient.js");

  const readConfigRanges =
    mod.readConfigRanges ?? mod.default?.readConfigRanges;

  const readSheetRange =
    mod.readSheetRange ?? mod.default?.readSheetRange;

  return {
    readConfigRanges,
    readSheetRange,
    __debug: {
      keys: Object.keys(mod),
      defaultKeys: mod.default ? Object.keys(mod.default) : null,
      typeof_readConfigRanges: typeof readConfigRanges,
      typeof_readSheetRange: typeof readSheetRange,
    },
  };
}

function findRangeForDate(configRows, date) {
  const d = String(date || "").trim();
  const row = (configRows || []).find((r) => String(r.date).trim() === d);
  return row?.range ? String(row.range).trim() : "";
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
    const lib = await loadSheetsLib();

    // Nếu import sai -> trả debug luôn để chốt lỗi
    if (
      typeof lib.readConfigRanges !== "function" ||
      typeof lib.readSheetRange !== "function"
    ) {
      return NextResponse.json(
        { status: "error", message: "Sheets lib missing", debug: lib.__debug },
        { status: 500 }
      );
    }

    const configRows = await lib.readConfigRanges();
    const range = findRangeForDate(configRows, date);

    if (!range) {
      return NextResponse.json(
        { status: "error", message: "Không tìm thấy ngày trong CONFIG_KPI", date: String(date).trim() },
        { status: 404 }
      );
    }

    const values = await lib.readSheetRange(range);

    return NextResponse.json({
      status: "success",
      date: String(date).trim(),
      range,
      raw: values, // khớp KpiDashboardClient (data.raw)
    });
  } catch (err) {
    console.error("CHECK-KPI ERROR:", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
