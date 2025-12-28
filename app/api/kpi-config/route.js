import { getSheetsClient, getSpreadsheetId } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normDate(s) {
  return String(s || "").trim();
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list");

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // CONFIG_KPI: cột A=DATE, B=RANGE (như ảnh bạn sửa)
    const range = "CONFIG_KPI!A:B";
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values || [];

    if (rows.length < 2) {
      return Response.json({ ok: true, dates: [], map: {} });
    }

    const header = rows[0].map((x) => String(x || "").trim().toUpperCase());
    const idxDate = header.indexOf("DATE");
    const idxRange = header.indexOf("RANGE");

    if (idxDate === -1 || idxRange === -1) {
      return Response.json(
        { ok: false, error: "CONFIG_KPI cần header: DATE | RANGE" },
        { status: 400 }
      );
    }

    const map = {};
    for (let i = 1; i < rows.length; i++) {
      const d = normDate(rows[i][idxDate]);
      const r = String(rows[i][idxRange] || "").trim();
      if (d && r) map[d] = r;
    }

    const dates = Object.keys(map);

    // ?list=1 => trả list ngày
    if (list) return Response.json({ ok: true, dates });

    return Response.json({ ok: true, map, dates });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}