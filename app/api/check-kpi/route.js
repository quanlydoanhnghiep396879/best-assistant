import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KHÔNG hề có chữ "handleKpi" trong file này
async function computeKpi(date) {
  return {
    date,
    hourAlerts: [
      { chuyen: "C1", hour: "9h", plan: 100, actual: 90, diff: -10, status: "lack" },
      { chuyen: "C2", hour: "9h", plan: 120, actual: 130, diff: 10, status: "over" },
    ],
    dayAlerts: [
      { chuyen: "C1", effDay: 95.8, targetEffDay: 90, status: "over" },
    ],
  };
}

export async function GET(request) {
  console.log("✅ /api/check-kpi GET v1");

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "24/12/2025";

    const result = await computeKpi(date);

    return NextResponse.json({
      status: "success",
      ...result,
    });
  } catch (err) {
    console.error("❌ /api/check-kpi GET ERROR:", err);
    // KHÔNG trả err.message nữa -> không bao giờ thấy "handleKpi is not defined"
    return NextResponse.json(
      {
        status: "error",
        message: "SERVER_ERROR",
      },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  console.log("✅ /api/check-kpi POST v1");

  try {
    const body = await request.json().catch(() => ({}));
    const date = body?.date || "24/12/2025";

    const result = await computeKpi(date);

    return NextResponse.json({
      status: "success",
      ...result,
    });
  } catch (err) {
    console.error("❌ /api/check-kpi POST ERROR:", err);
    return NextResponse.json(
      {
        status: "error",
        message: "SERVER_ERROR",
      },
      { status: 500 },
    );
  }
}
