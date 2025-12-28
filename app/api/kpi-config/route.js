import { getValues, normalizeDateKey, dateStrToSerial } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_SHEET = process.env.CONFIG_SHEET_NAME || "CONFIG_KPI"; // sheet tab

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list") === "1";

    // Read A:B (DATE, RANGE)
    const rows = await getValues(`${CONFIG_SHEET}!A:B`, {
      valueRenderOption: "UNFORMATTED_VALUE", // allow serial too, we normalize
    });

    const map = {};
    for (const r of rows) {
      const rawDate = r?.[0];
      const rawRange = r?.[1];

      // skip header row
      if (String(rawDate || "").toUpperCase().includes("DATE")) continue;

      const dateKey = normalizeDateKey(rawDate);
      const range = String(rawRange || "").trim();
      if (!dateKey || !range) continue;

      map[dateKey] = range;
    }

    // sort ASC so 23/12 before 24/12
    const dates = rawDates
    .map(normalizeDateCell)
    .filter(Boolean);

    if (list) {
      return Response.json({ ok: true, dates });
    }

    return Response.json({ ok: true, dates, map });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
function pad2(n) { return String(n).padStart(2, "0"); }

// Google Sheets serial -> dd/mm/yyyy (UTC)
function serialToDMY(serial) {
  const base = Date.UTC(1899, 11, 30);
  const ms = base + Number(serial) * 86400000;
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function normalizeDateCell(v) {
  if (v === null || v === undefined) return "";
  // nếu là số hoặc chuỗi toàn số -> coi là serial date
  if (typeof v === "number") return serialToDMY(v);
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return serialToDMY(Number(s));
  return s; // đã là dd/mm/yyyy
}