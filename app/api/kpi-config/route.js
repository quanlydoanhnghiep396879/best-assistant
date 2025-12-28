// app/api/kpi-config/route.js
import { NextResponse } from "next/server";
import { getValues } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

function parseVNDateToTime(s) {
  // "23/12/2025"
  const [d, m, y] = String(s || "").split("/").map(Number);
  if (!d || !m || !y) return NaN;
  return new Date(y, m - 1, d).getTime();
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list"); // ?list=1
    const date = searchParams.get("date"); // ?date=24/12/2025

    // Sheet CONFIG_KPI: cột A=DATE, B=RANGE
    const rows = await getValues("CONFIG_KPI!A:B");

    const map = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const d = (r[0] ?? "").toString().trim();
      const range = (r[1] ?? "").toString().trim();
      if (!d || !range) continue;
      map.push({ date: d, range });
    }

    // ✅ LIST ngày: sort tăng dần (23 trước 24)
    if (list === "1") {
      const dates = map
        .map(x => x.date)
        .sort((a, b) => parseVNDateToTime(a) - parseVNDateToTime(b));

      return NextResponse.json({ ok: true, dates });
    }

    // ✅ Lấy range theo ngày
    if (date) {
      const found = map.find(x => x.date === date);
      if (!found) return NextResponse.json({ ok: false, error: "DATE_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ ok: true, date: found.date, range: found.range });
    }

    // default: trả hết map
    return NextResponse.json({ ok: true, map });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}