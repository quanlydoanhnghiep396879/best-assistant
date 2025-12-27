import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function loadSheetsLib() {
  const mod = await import("../../lib/googleSheetsClient.js");

  const readConfigRanges =
    mod.readConfigRanges ?? mod.default?.readConfigRanges;

  return {
    readConfigRanges,
    __debug: {
      keys: Object.keys(mod),
      defaultKeys: mod.default ? Object.keys(mod.default) : null,
      typeof_readConfigRanges: typeof readConfigRanges,
    },
  };
}

export async function GET() {
  try {
    const lib = await loadSheetsLib();

    // Nếu import sai -> trả debug luôn để chốt lỗi
    if (typeof lib.readConfigRanges !== "function") {
      return NextResponse.json(
        { status: "error", message: "readConfigRanges missing", debug: lib.__debug },
        { status: 500 }
      );
    }

    const configRows = await lib.readConfigRanges();
    const dates = configRows.map((r) => String(r.date).trim());

    return NextResponse.json({ status: "success", dates, configRows });
  } catch (err) {
    console.error("KPI-CONFIG ERROR:", err);
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
