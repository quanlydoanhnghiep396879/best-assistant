import {
  getValues,
  normalizeDateKey,
  toNumberSafe,
  dateStrToSerial,
} from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_SHEET = process.env.CONFIG_SHEET_NAME || "CONFIG_KPI";
const KPI_SHEET_DEFAULT = process.env.KPI_SHEET_NAME || "KPI";

function normHeader(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function findColIndex(headers, includesList) {
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    if (!h) continue;
    if (includesList.some((k) => h.includes(k))) return i;
  }
  return -1;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const dateParam = searchParams.get("date") || "";
    const lineParam = String(searchParams.get("line") || "").trim();

    // ===== 1) Load config map (date -> range) =====
    const cfgRows = await getValues(`${CONFIG_SHEET}!A:B`, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const map = {};
    for (const r of cfgRows) {
      const rawDate = r?.[0];
      const rawRange = r?.[1];
      if (String(rawDate || "").toUpperCase().includes("DATE")) continue;

      const k = normalizeDateKey(rawDate);
      const range = String(rawRange || "").trim();
      if (!k || !range) continue;
      map[k] = range;
    }

    const availableDates = Object.keys(map).sort(
      (a, b) => dateStrToSerial(a) - dateStrToSerial(b)
    );

    // normalize incoming date
    const dateKey = normalizeDateKey(dateParam) || "";
    if (!dateKey || !map[dateKey]) {
      return Response.json(
        { ok: false, error: "DATE_NOT_FOUND", date: dateParam, normalized: dateKey, availableDates },
        { status: 404 }
      );
    }

    const range = map[dateKey];

    // ===== 2) Read KPI block =====
    const values = await getValues(range, {
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    if (!values.length) {
      return Response.json({ ok: false, error: "NO_DATA", date: dateKey, range }, { status: 404 });
    }

    // ===== 3) Detect header rows =====
    // Find a row containing keywords like "CHUYỀN" or "MÃ HÀNG" or "DM/NGÀY"
    let headerRow = -1;
    for (let i = 0; i < Math.min(values.length, 8); i++) {
      const rowText = values[i].map((x) => normHeader(x)).join(" | ");
      if (
        rowText.includes("CHUYEN") ||
        rowText.includes("CHUYỀN") ||
        rowText.includes("MA HANG") ||
        rowText.includes("MÃ HÀNG") ||
        rowText.includes("DM/NGÀY") ||
        rowText.includes("DM/NGAY")
      ) {
        headerRow = i;
        break;
      }
    }

    // Fallback: assume 2 header rows then data
    if (headerRow < 0) headerRow = 1;

    const headers = values[headerRow] || [];
    const dataStart = headerRow + 1;

    // column indices
    let idxLine = findColIndex(headers, ["CHUYEN", "CHUYỀN"]);
    if (idxLine < 0) idxLine = 0;
    const idxMaHang = findColIndex(headers, ["MÃ HÀNG", "MA HANG", "MH"]);
    const idxDmNgay = findColIndex(headers, ["DM/NGÀY", "DM/NGAY", "DM NGAY"]);
    const idxDmH = findColIndex(headers, ["DM/H", "DMH", "DM H"]);

    // time columns: header contains "H" and a number or has ">" (e.g. >9H, >12H30, ...)
    const timeCols = [];
    for (let c = 0; c < headers.length; c++) {
      const h = String(headers[c] || "").trim();
      const hu = normHeader(h);
      if (!hu) continue;
      if (hu.includes(">") && hu.includes("H")) {
        timeCols.push({ label: h, col: c });
      } else if (/\b\d{1,2}H(\d{2})?\b/i.test(h)) {
        timeCols.push({ label: h, col: c });
      }
    }

    // Prefer AFTER 16H30 column for daily actual if exists
    const idxAfter1630 =
      timeCols.find((t) => normHeader(t.label).includes("16H30"))?.col ??
      (timeCols.length ? timeCols[timeCols.length - 1].col : -1);

    // ===== 4) Parse rows -> summary =====
    const summary = [];
    const perLine = {}; // for right-side detail

    for (let r = dataStart; r < values.length; r++) {
      const row = values[r] || [];
      const line = String(row[idxLine] ?? "").trim();
      if (!line) continue;

      // stop if reached empty section
      if (normHeader(line).includes("TOTAL")) continue;

      const maHang = String(row[idxMaHang] ?? "").trim();
      const dmNgay = toNumberSafe(row[idxDmNgay]);
      const dmH = toNumberSafe(row[idxDmH]);
      const after1630 = idxAfter1630 >= 0 ? toNumberSafe(row[idxAfter1630]) : 0;

      const hsDat = dmNgay > 0 ? (after1630 / dmNgay) * 100 : 0;
      const statusDay = hsDat >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      summary.push({
        line,
        maHang,
        dmNgay,
        dmH,
        after1630,
        hsDat,
        statusDay,
      });

      // build timeline detail for this line (actual cumulative vs planned cumulative)
      const timeline = timeCols.map((t, i) => {
        const actual = toNumberSafe(row[t.col]);
        const planned = dmH > 0 ? dmH * (i + 1) : 0; // đơn giản theo mốc 1..n
        const diff = actual - planned;
        const status = actual >= planned ? "ĐẠT" : "KHÔNG ĐẠT";
        return { moc: t.label, actual, planned, diff, status };
      });

      perLine[line] = { line, maHang, dmNgay, dmH, timeline };
    }

    // optional single line detail
    const detail = lineParam ? perLine[lineParam] || null : null;

    return Response.json({
      ok: true,
      date: dateKey,
      range,
      availableDates,
      lines: summary.map((x) => x.line),
      summary,
      detail,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}