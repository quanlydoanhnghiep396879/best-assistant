import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============== API CŨ – CHỈ TRẢ THÔNG BÁO ===============
export async function GET() {
  console.log("🔴 /api/check-kpi (OLD) được gọi – stub");
  return NextResponse.json({
    status: "error",
    message: "API cũ. Vui lòng dùng /api/kpi-debug",
  });
}

export async function POST() {
  console.log("🔴 /api/check-kpi (OLD, POST) được gọi – stub");
  return NextResponse.json({
    status: "error",
    message: "API cũ. Vui lòng dùng /api/kpi-debug",
  });
}
