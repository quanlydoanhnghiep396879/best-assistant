
import { NextResponse } from "next/server";
import { getSheetsClient } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

const CONFIG_SHEET = "CONFIG_KPI";
const CONFIG_RANGE = `${CONFIG_SHEET}!A:B`; // A=DATE, B=RANGE

function normDate(s) {
  return String(s || "").trim();
}

export async function GET(req) {
  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const { searchParams } = new URL(req.url);
    const date = normDate(searchParams.get("date"));
    const list = searchParams.get("list");

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: CONFIG_RANGE,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = res.data.values || [];
    const body = rows.slice(1) // bỏ header
      .map(r => ({ date: normDate(r?.[0]), range: normDate(r?.[1]) }))
      .filter(x => x.date && x.range);

    const dates = body.map(x => x.date);

    if (list === "1") {
      return NextResponse.json({ ok: true, dates });
    }

    if (!date) {
      return NextResponse.json({ ok: true, dates, hint: "Pass ?date=dd/MM/yyyy" });
    }

    const found = body.find(x => x.date === date);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: `No RANGE found for date: ${date}, dates`},
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, date, range: found.range, dates });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}