// app/api/kpi-config/route.js
import { NextResponse } from 'next/server';
import { getSheetsClient } from '@/app/lib/googleSheetsClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { sheets, spreadsheetId } = await getSheetsClient();

    const CONFIG_SHEET_NAME =
      process.env.CONFIG_KPI_SHEET_NAME || 'CONFIG_KPI';

    const range = `${CONFIG_SHEET_NAME}!A2:B1000`;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = res.data.values || [];
    const configRows = rows.filter((r) => r[0] && r[1]);
    const dates = configRows.map((r) => r[0]);

    return NextResponse.json(
      {
        status: 'success',
        dates,
        configRows,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('ERROR /api/kpi-config:', err);
    return NextResponse.json(
      {
        status: 'error',
        message:
          'kpi-config: ' + String(err?.message || err),
      },
      { status: 500 }
    );
  }
}
