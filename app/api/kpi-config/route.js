import { NextResponse } from "next/server";
import { getSheetsClient, getSpreadsheetId } from "../_lib/googleSheetsClient";

function excelSerialToDMY(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  const d = new Date(ms);
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function normDate(s) {
  let t = (s ?? "").toString().trim().replace(/\s+/g, "").replace(/-/g, "/");
  // nếu là serial 46015
  if (/^\d+(\.\d+)?$/.test(t)) {
    const dmy = excelSerialToDMY(t);
    if (dmy) t = dmy.replace(/\s+/g, "");
  }
  return t;
}

function parseDMY(dmy) {
  const [dd, mm, yy] = (dmy || "").split("/").map(Number);
  if (!dd || !mm || !yy) return NaN;
  return new Date(yy, mm - 1, dd).getTime();
}

export async function GET(req) {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CONFIG_KPI!A2:B",
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const rows = r.data.values || [];
    const dates = [];

    for (const row of rows) {
      const d = normDate(row?.[0]);
      const range = row?.[1];
      if (d && range) dates.push(d);
    }

    const uniq = Array.from(new Set(dates)).sort((a, b) => parseDMY(a) - parseDMY(b));

    return NextResponse.json({ ok: true, dates: uniq });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}