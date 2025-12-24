import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "success", source: "check-kpi test" });
}

export async function POST() {
  return GET();
}
