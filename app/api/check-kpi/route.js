// app/api/check-kpi/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ======== HÀM HANDLE KPI ĐƠN GIẢN =========
async function handleKpi(date) {
  // Tạm trả về data fake để test
  return {
    date,
    hourAlerts: [
      { chuyen: "C1", hour: "9h", plan: 100, actual: 90, diff: -10 },
      { chuyen: "C2", hour: "9h", plan: 120, actual: 130, diff: 10 },
    ],
    dayAlerts: [
      { chuyen: "C1", effDay: 95.8, targetEffDay: 90, status: "over" },
    ],
  };
}

// ======== GET /api/check-kpi?date=24/12/2025 =========
export async function GET(request) {
  console.log("✅ /api/check-kpi GET");

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "24/12/2025";

    const result = await handleKpi(date);

    return NextResponse.json({
      status: "success",
      ...result,
    });
  } catch (err) {
    console.error("❌ KPI API ERROR (GET):", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

// ======== POST /api/check-kpi =========
export async function POST(request) {
  console.log("✅ /api/check-kpi POST");

  try {
    const body = await request.json().catch(() => ({}));
    const date = body?.date || "24/12/2025";

    const result = await handleKpi(date);

    return NextResponse.json({
      status: "success",
      ...result,
    });
  } catch (err) {
    console.error("❌ KPI API ERROR (POST):", err);
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
