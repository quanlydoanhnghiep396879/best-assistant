import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function loadLib() {
  const mod = await import("../../lib/googleSheetsClient.js");
  const lib = mod.default ?? mod;
  return { mod, lib };
}

export async function GET() {
  try {
    const { mod, lib } = await loadLib();

    // ✅ nếu vẫn sai sẽ thấy ngay
    if (typeof lib.readConfigRanges !== "function") {
      return NextResponse.json(
        {
          status: "error",
          message: "readConfigRanges missing",
          debug: {
            keys: Object.keys(mod),
            defaultKeys: mod.default ? Object.keys(mod.default) : null,
            moduleId: lib.__MODULE_ID ?? null,
            typeof_readConfigRanges: typeof lib.readConfigRanges,
          },
        },
        { status: 500 }
      );
    }

    const configRows = await lib.readConfigRanges();
    const dates = configRows.map((r) => r.date);

    return NextResponse.json({
      status: "success",
      moduleId: lib.__MODULE_ID,
      dates,
      configRows,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
