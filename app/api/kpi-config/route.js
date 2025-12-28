// app/api/kpi-config/route.js
import { NextResponse } from "next/server";
import { getValues } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

function parseVNDateToTime(s) {
  const [d, m, y] = String(s || "").split("/").map(Number);
  if (!d || !m || !y) return NaN;
  return new Date(y, m - 1, d).getTime();
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list");
    const date = searchParams.get("date");

    // ✅ CONFIG_KPI phải lấy FORMATTED_VALUE để không ra 46015
    const rows = await getValues("CONFIG_KPI!A:B", "FORMATTED_VALUE");

    const map = [];
    for (let i = 1; i < rows.length; i++) {
      const d = String(rows[i]?.[0] ?? "").trim();   // "23/12/2025"
      const range = String(rows[i]?.[1] ?? "").trim();
      if (!d || !range) continue;
      map.push({ date: d, range });
    }

    if (list === "1") {
      const dates = map
        .map(x => x.date)
        .sort((a, b) => parseVNDateToTime(a) - parseVNDateToTime(b)); // ✅ 23 trước 24
      return NextResponse.json({ ok: true, dates });
    }

    if (date) {
      const found = map.find(x => x.date === date);
      if (!found) return NextResponse.json({ ok: false, error: "DATE_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ ok: true, date: found.date, range: found.range });
    }

    return NextResponse.json({ ok: true, map });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
