// app/api/kpi-config/route.js
import { NextResponse } from "next/server";
import { readRange, normalizeDDMMYYYY, ddmmyyyySortKey } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list");

    // CONFIG_KPI có cột DATE và RANGE, ví dụ:
    // A: DATE, B: RANGE
    const rows = await readRange("CONFIG_KPI!A2:B", {
      // FORMATTED_VALUE để ưu tiên ra 23/12/2025,
      // nhưng vẫn normalize được nếu lỡ ra serial.
      valueRenderOption: "FORMATTED_VALUE",
    });

    const items = [];
    for (const r of rows) {
      const rawDate = r?.[0];
      const range = (r?.[1] || "").trim();
      const date = normalizeDDMMYYYY(rawDate);
      if (!date || !range) continue;
      items.push({ date, range });
    }

    // sort tăng dần: 23/12/2025 trước 24/12/2025
    items.sort((a, b) => ddmmyyyySortKey(a.date).localeCompare(ddmmyyyySortKey(b.date)));

    if (list === "1") {
      return NextResponse.json({ ok: true, dates: items.map(x => x.date) });
    }

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}