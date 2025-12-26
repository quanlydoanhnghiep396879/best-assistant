// app/api/check-kpi/route.js
import { NextResponse } from 'next/server';
import { getSheetsClient } from '@/app/lib/googleSheetsClient';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // dd/mm/yyyy

  if (!date) {
    return NextResponse.json(
      { status: 'error', message: 'Thiếu query ?date=dd/mm/yyyy' },
      { status: 400 },
    );
  }

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();

    const KPI_SHEET_NAME = process.env.KPI_SHEET_NAME || 'KPI';

    // Tạm thời đọc nguyên block KPI để kiểm tra đã auth được chưa
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${KPI_SHEET_NAME}!A1:AJ200`,
    });

    return NextResponse.json({
      status: 'success',
      date,
      raw: res.data.values || [],
    });
  } catch (err) {
    console.error('CHECK-KPI ERROR:', err);
    return NextResponse.json(
      { status: 'error', message: String(err?.message || err) },
      { status: 500 },
    );
  }
}
