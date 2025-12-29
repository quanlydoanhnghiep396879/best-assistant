import { readRangeA1 } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim();
    if (!date) return Response.json({ ok: false, error: "MISSING_DATE" }, { status: 400 });

    // lấy config date->range
    const cfg = await readRangeA1("CONFIG_KPI!A2:B1000");
    let range = null;
    for (const row of cfg) {
      const d = (row?.[0] || "").trim();
      const r = (row?.[1] || "").trim();
      if (d === date) { range = r; break; }
    }
    if (!range) return Response.json({ ok: false, error: "DATE_NOT_FOUND" }, { status: 404 });

    // đọc dữ liệu KPI theo range đã config
    const values = await readRangeA1(range);

    // Trả thẳng values để dashboard render (bạn đang thấy API trả ra values là đúng)
    return Response.json({ ok: true, date, range, values });
  } catch (e) {
    return Response.json(
      { ok: false, error: "CHECK_KPI_ERROR", message: String(e.message || e) },
      { status: 500 }
    );
  }
}
