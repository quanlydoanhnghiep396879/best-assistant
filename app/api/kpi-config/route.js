import { readRangeA1, parseVNDateToTime } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list");

    // Sheet CONFIG_KPI: cột A = DATE, cột B = RANGE (như ảnh bạn)
    // Ví dụ:
    // A2: 23/12/2025   B2: KPI!A19:AZ37
    // A3: 24/12/2025   B3: KPI!A2:AZ18
    const values = await readRangeA1("CONFIG_KPI!A2:B1000");

    const map = {};
    for (const row of values) {
      const date = (row?.[0] || "").trim();
      const range = (row?.[1] || "").trim();
      if (!date || !range) continue;
      map[date] = range;
    }

    if (list === "1") {
      const dates = Object.keys(map)
        .sort((a, b) => parseVNDateToTime(a) - parseVNDateToTime(b)); // ✅ 23 trước 24

      return Response.json({ ok: true, dates });
    }

    return Response.json({ ok: true, map });
  } catch (e) {
    return Response.json(
      { ok: false, error: "KPI_CONFIG_ERROR", message: String(e.message || e) },
      { status: 500 }
    );
  }
}
