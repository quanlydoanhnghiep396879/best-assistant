// app/api/check-kpi/route.js
import { NextResponse } from 'next/server';
import { getSheetsClient } from '../../lib/googleSheetsClient';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');

  if (!date) {
    return NextResponse.json(
      { status: 'error', message: 'Thiếu query ?date=dd/mm/yyyy' },
      { status: 400 }
    );
  }

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const KPI_SHEET_NAME = process.env.KPI_SHEET_NAME || 'KPI';

    // Ở đây anh đang demo lấy full range; sau mình có thể lọc theo date
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
      { status: 500 }
    );
  }
}
