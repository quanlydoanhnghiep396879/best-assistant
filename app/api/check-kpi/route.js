// app/api/check-kpi/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  console.log("✅ /api/check-kpi GET vTEST-001");

  return NextResponse.json({
    status: "success",
    version: "vTEST-001",
  });
}
