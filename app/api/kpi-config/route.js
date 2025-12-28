import { NextResponse } from "next/server";
import { getSheetsClient, getSheetIdEnv } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

function serialToDDMMYYYY(serial) {
  // Google Sheets serial date ~ Excel serial (base 1899-12-30)
  const base = Date.UTC(1899, 11, 30);
  const ms = base + Number(serial) * 86400000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDateCell(v) {
  if (v == null || v === "") return null;
  // numeric date
  if (typeof v === "number" || /^[0-9]+(\.[0-9]+)?$/.test(String(v))) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1000) return serialToDDMMYYYY(n);
  }
  // string date
  const s = String(v).trim();
  if (!s) return null;
  return s;
}

export async function GET() {
  try {
    const spreadsheetId = getSheetIdEnv();
    if (!spreadsheetId) {
      return NextResponse.json({ status: "error", message: "Missing GOOGLE_SHEET_ID" }, { status: 400 });
    }

    const configSheet = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
    const sheets = await getSheetsClient();

    const range = `${configSheet}!A:B`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });

    const values = res.data.values || [];
    // Expect:
    // A1=DATE, B1=RANGE
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const a = values[i]?.[0];
      const b = values[i]?.[1];
      const dateStr = normalizeDateCell(a);
      const rangeStr = b ? String(b).trim() : "";
      if (dateStr && rangeStr) rows.push({ date: dateStr, range: rangeStr });
    }

    // sort by date (dd/mm/yyyy)
    const toKey = (d) => {
      const [dd, mm, yyyy] = d.split("/").map((x) => Number(x));
      return yyyy * 10000 + mm * 100 + dd;
    };
    rows.sort((x, y) => toKey(x.date) - toKey(y.date));

    return NextResponse.json({
      status: "success",
      configSheet,
      dates: rows.map((r) => r.date),
      configRows: rows,
    }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (e) {
    return NextResponse.json({ status: "error", message: String(e?.message || e) }, { status: 500 });
  }
}
