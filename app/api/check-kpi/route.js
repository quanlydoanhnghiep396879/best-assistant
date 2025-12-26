// app/api/check-kpi/route.js
import { NextResponse } from 'next/server';
import { getSheetsClient } from '@/app/lib/googleSheetsClient';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json(
        {
          status: 'error',
          message: 'Thiếu query ?date=dd/mm/yyyy',
        },
        { status: 400 }
      );
    }

    const { sheets, spreadsheetId } = await getSheetsClient();

    const CONFIG_SHEET_NAME =
      process.env.CONFIG_KPI_SHEET_NAME || 'CONFIG_KPI';

    const configRange = `${CONFIG_SHEET_NAME}!A2:B1000`;

    const configRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: configRange,
    });

    const configRows = (configRes.data.values || []).filter(
      (r) => r[0] && r[1]
    );

    const match = configRows.find(
      (r) => (r[0] || '').trim() === date.trim()
    );

    if (!match) {
      return NextResponse.json(
        {
          status: 'error',
          message: `Không tìm thấy range cho ngày ${date} trong CONFIG_KPI`,
        },
        { status: 404 }
      );
    }

    const range = match[1];

    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const raw = kpiRes.data.values || [];

    return NextResponse.json(
      {
        status: 'success',
        date,
        range,
        raw,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('ERROR /api/check-kpi:', err);
    return NextResponse.json(
      {
        status: 'error',
        message:
          'check-kpi: ' + String(err?.message || err),
      },
      { status: 500 }
    );
  }
}
