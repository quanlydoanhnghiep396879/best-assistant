// app/api/check-kpi/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KHÔNG GOOGLE, KHÔNG KPI, KHÔNG handleKpi, KHÔNG try/catch
export async function GET() {
  console.log("✅ /api/check-kpi GET vTEST");

  return NextResponse.json({
    status: "success",
    route: "/api/check-kpi",
    version: "vTEST-001",
  });
}

export async function POST() {
  console.log("✅ /api/check-kpi POST vTEST");

  return NextResponse.json({
    status: "success",
    route: "/api/check-kpi",
    version: "vTEST-001",
  });
}
