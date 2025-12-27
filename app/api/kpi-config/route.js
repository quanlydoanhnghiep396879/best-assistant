import { NextResponse } from "next/server";
import * as Sheets from "../../lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickFn(name) {
  return Sheets[name] || Sheets.default?.[name];
}

export async function GET() {
  try {
    const readConfigRanges = pickFn("readConfigRanges");

    if (typeof readConfigRanges !== "function") {
      return NextResponse.json(
        {
          status: "error",
          message: "readConfigRanges missing (import/export mismatch)",
          debug: {
            keys: Object.keys(Sheets),
            defaultKeys: Sheets.default ? Object.keys(Sheets.default) : null,
            typeof_readConfigRanges: typeof Sheets.readConfigRanges,
            typeof_default_readConfigRanges: typeof Sheets.default?.readConfigRanges,
          },
        },
        { status: 500 }
      );
    }

    const configRows = await readConfigRanges();
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
