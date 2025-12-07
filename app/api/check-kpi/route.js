import { NextResponse } from "next/server";
import { getKPIDataFromGoogleSheet } from "@/utils/getServiceAccount";

export async function GET() {
  try {
    const result = await getKPIDataFromGoogleSheet();

    return NextResponse.json({
      status: "success",
      alerts: result.alerts,
      dailySummary: result.dailySummary
    });
  } catch (error) {
    console.error("API /check-kpi error:", error);
    return NextResponse.json(
      { status: "error", message: error.message },
      { status: 500 }
    );
  }
}
