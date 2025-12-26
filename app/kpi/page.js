import { NextResponse } from 'next/server';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// Lấy auth Google từ biến môi trường
function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!clientEmail || !privateKeyBase64 || !sheetId) {
    throw new Error(
      'Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY_BASE64 / GOOGLE_SHEET_ID'
    );
  }

  const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');

  const auth = new google.auth.JWT(clientEmail, undefined, privateKey, SCOPES);
  return { auth, sheetId };
}

// Đọc bảng CONFIG_KPI để lấy mapping ngày → range
async function getConfigRows(sheets, sheetId) {
  const configSheetName = process.env.CONFIG_KPI_SHEET_NAME || 'CONFIG_KPI';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${configSheetName}!A2:B200`, // A: DATE, B: RANGE
  });

  const rows = res.data.values || [];
  const cleaned = rows.filter((r) => (r[0] || '').toString().trim() !== '');

  return cleaned; // mỗi dòng: [date, range]
}

// Tìm cấu trúc 1 dòng chuyền trong block raw
function parseLineRow(row) {
  const lineName = (row[0] || '').toString().trim();

  // Tìm ô có chữ "Đạt" / "Thiếu"… làm trạng thái
  let status = '';
  let statusIdx = -1;
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    if (typeof v === 'string') {
      const text = v.normalize('NFC'); // để xử lý dấu tiếng Việt
      if (
        text.includes('Đạt') ||
        text.includes('đạt') ||
        text.includes('Thiếu') ||
        text.includes('thiếu')
      ) {
        status = text;
        statusIdx = i;
        break;
      }
    }
  }

  // Tìm 1 ô phần trăm gần trước trạng thái, coi như "hiệu suất ngày"
  let effDay = '';
  if (statusIdx > 0) {
    for (let i = statusIdx - 1; i >= 0; i--) {
      const v = row[i];
      if (typeof v === 'string' && v.includes('%')) {
        effDay = v;
        break;
      }
    }
  }

  // Lấy vài số cuối cùng làm thông tin sản lượng (chỉ để tham khảo)
  const nums = row
    .map((v) => (typeof v === 'string' ? v.replace(/,/g, '') : v))
    .filter((v) => !isNaN(Number(v)))
    .map((v) => Number(v));
  const prodToday = nums.length ? nums[nums.length - 1] : '';

  return {
    line: lineName,
    effDay,
    status,
    prodToday,
  };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date'); // dd/mm/yyyy

    const { auth, sheetId } = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1) Đọc CONFIG_KPI
    const configRows = await getConfigRows(sheets, sheetId);
    const dates = configRows.map((r) => (r[0] || '').toString().trim());

    if (!dates.length) {
      return NextResponse.json({
        status: 'success',
        date: null,
        dates: [],
        range: null,
        lines: [],
        raw: [],
        configRows,
      });
    }

    // Nếu không truyền date → lấy ngày đầu tiên trong CONFIG_KPI
    const date = (dateParam || dates[0]).toString().trim();

    const matched = configRows.find(
      (r) => (r[0] || '').toString().trim() === date
    );

    if (!matched) {
      return NextResponse.json(
        {
          status: 'error',
          message: `Ngày ${date} không có trong CONFIG_KPI`,
          dates,
        },
        { status: 400 }
      );
    }

    const range = (matched[1] || '').toString().trim();

    // 2) Đọc block KPI tương ứng ngày đó
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    const rows = res.data.values || [];

    // 3) Lọc các dòng chuyền (C1, C2, C3, …)
    const lineRows = rows.filter((row) => {
      const name = (row[0] || '').toString().trim();
      return /^C\d+/i.test(name); // chỉ lấy C1, C2, C3…
    });

    const lines = lineRows.map(parseLineRow);

    return NextResponse.json({
      status: 'success',
      date,
      dates,
      range,
      lines,
      raw: rows,      // để debug nếu cần
      configRows,     // để xem lại mapping ngày → range
    });
  } catch (err) {
    console.error('KPI API ERROR:', err);
    return NextResponse.json(
      {
        status: 'error',
        message: err.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
