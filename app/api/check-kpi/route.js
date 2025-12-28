// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { findRangeByDate, readRange, toDdMmYyyy } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "").replace("%", "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// find header row by searching for "Chuyền" or "MH" etc.
function findHeaderRowIndex(values) {
  const maxScan = Math.min(values.length, 8);
  for (let i = 0; i < maxScan; i++) {
    const row = values[i] || [];
    const joined = row.map(x => String(x || "").trim()).join(" | ").toLowerCase();
    if (joined.includes("chuy") || joined.includes("mh") || joined.includes("dm/ng") || joined.includes("kiểm")) {
      return i;
    }
  }
  return 0;
}

function idxOfHeader(headers, candidates) {
  const h = headers.map(x => String(x || "").trim().toLowerCase());
  for (const c of candidates) {
    const i = h.indexOf(String(c).trim().toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateRaw = searchParams.get("date") || "";
    const date = toDdMmYyyy(dateRaw);

    if (!date) {
      return NextResponse.json({ ok: false, error: "MISSING_DATE" }, { status: 400 });
    }

    const range = await findRangeByDate(date);
    if (!range) {
      return NextResponse.json({ ok: false, error: "DATE_NOT_FOUND", date }, { status: 404 });
    }

    // Read KPI range as formatted strings (same as what you see in Sheet)
    const values = await readRange(range, { valueRenderOption: "FORMATTED_VALUE" });

    const headerRowIndex = findHeaderRowIndex(values);
    const headers = (values[headerRowIndex] || []).map(x => String(x || "").trim());

    const rows = values.slice(headerRowIndex + 1);

    // locate needed cols
    const idxLine = idxOfHeader(headers, ["Chuyền", "CHUYEN", "LINE"]);
    const idxMH   = idxOfHeader(headers, ["MH", "MÃ HÀNG", "Mã hàng"]);
    const idxDMN  = idxOfHeader(headers, ["DM", "DM/NGAY", "ĐM/NGÀY", "DM/NGÀY"]);
    // last time column like "->16h30" or similar
    let idxFinal = -1;
    for (let i = headers.length - 1; i >= 0; i--) {
      const t = headers[i].toLowerCase();
      if (t.includes("16h30") || t.includes("->16")) { idxFinal = i; break; }
    }

    // Build summary lines for left table
    const lines = [];
    for (const r of rows) {
      const line = idxLine >= 0 ? String(r?.[idxLine] || "").trim() : "";
      if (!line) continue;

      const mh = idxMH >= 0 ? String(r?.[idxMH] || "").trim() : "";
      const dmNgay = idxDMN >= 0 ? toNumberSafe(r?.[idxDMN]) : 0;
      const actual = idxFinal >= 0 ? toNumberSafe(r?.[idxFinal]) : 0;

      const hsDat = dmNgay > 0 ? (actual / dmNgay) * 100 : 0;
      const hsDm = 100;

      lines.push({
        line,
        mh,
        hs_dat: Number.isFinite(hsDat) ? +hsDat.toFixed(2) : 0,
        hs_dm: hsDm,
        status: hsDat >= 100 ? "ĐẠT" : "KHÔNG ĐẠT",
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      headers,
      values,     // raw table
      lines,      // summarized for dashboard
      meta: {
        headerRowIndex,
        idxLine,
        idxMH,
        idxDMNgay: idxDMN,
        idxFinal,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "CHECK_KPI_ERROR", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}
