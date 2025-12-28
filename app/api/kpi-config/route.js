import { NextResponse } from "next/server";
import { readRange } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

function toDateKey(dateText) {
  // expect dd/MM/yyyy
  const s = String(dateText || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yy = m[3];
  return `${yy}-${mm}-${dd}`;
}

export async function GET() {
  try {
    // Lấy formatted để không bị 46014
    const rows = await readRange("CONFIG_KPI!A2:B1000", {
      valueRenderOption: "FORMATTED_VALUE",
    });

    const items = [];
    for (const r of rows) {
      const dateLabel = (r?.[0] ?? "").toString().trim();
      const range = (r?.[1] ?? "").toString().trim();
      if (!dateLabel || !range) continue;

      const dateKey = toDateKey(dateLabel);
      if (!dateKey) continue;

      items.push({ dateKey, dateLabel, range });
    }

    // sort mới nhất lên đầu
    items.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));

    return NextResponse.json(
      { status: "ok", items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e?.message || String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
