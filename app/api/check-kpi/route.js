import { NextResponse } from "next/server";

export async function GET() {
  // GIẢ LẬP — Tí nữa em kết nối Google Sheet cho anh
  const alerts = [
    "dòng 2, cột 1: đủ 0",
    "dòng 2, cột 2: thiếu 20",
    "dòng 2, cột 3: vượt 15",
    "dòng 3, cột 2: thiếu 10",
    "dòng 4, cột 4: vượt 5"
  ];

  const dailySummary = {
    "Cắt": { kpi: 500, real: 480, diff: -20, status: "lack" },
    "In/Thêu": { kpi: 300, real: 320, diff: 20, status: "over" },
    "May 1": { kpi: 600, real: 600, diff: 0, status: "equal" }
  };

  return NextResponse.json({
    alerts,
    dailySummary,
  });
}
