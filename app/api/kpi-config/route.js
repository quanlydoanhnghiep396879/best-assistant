// app/api/kpi-config/route.js
import { NextResponse } from 'next/server';
import { getSheetsClient } from '../../lib/googleSheetsClient';

export async function GET() {
  try {
    const { sheets, spreadsheetId } = await getSheetsClient();

    const CONFIG_SHEET_NAME =
      process.env.CONFIG_KPI_SHEET_NAME || 'CONFIG_KPI';

    // Lấy DATE + RANGE
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${CONFIG_SHEET_NAME}!A2:B`,
    });

    const rows = res.data.values || [];
    const dates = rows.map(r => r[0]).filter(Boolean);

    return NextResponse.json({
      status: 'success',
      dates,
      configRows: rows,
    });
  } catch (err) {
    console.error('KPI-CONFIG ERROR:', err);
    return NextResponse.json(
      { status: 'error', message: String(err?.message || err) },
      { status: 500 }
    );
  }
}
