import { NextResponse } from "next/server";
import { readRangeA1 } from "../_lib/googleSheetsClient";

// BẮT BUỘC: googleapis chạy Node runtime, không chạy Edge
export const runtime = "nodejs";

// BẮT BUỘC: ép route này chạy động, không static
export const dynamic = "force-dynamic";
export const revalidate = 0;

function norm(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[._-]/g, "");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findIdx(headers, candidates) {
  const h = headers.map(norm);
  for (const c of candidates) {
    const idx = h.findIndex((x) => x.includes(norm(c)));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function GET(request) {
  try {
    // ✅ ĐỪNG dùng new URL(req.url)
    const date = request.nextUrl.searchParams.get("date") || "";

    const sheetName = process.env.KPI_SHEET_NAME || "KPI";
    const range = `${sheetName}!A20:AZ37`;

    const values = await readRangeA1(range, {
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    if (!values || values.length === 0) {
      return NextResponse.json({ ok: true, date, range, values: [], lines: [] });
    }

    const headers = values[0] || [];
    const rows = values.slice(1);

    const idxLine = 0;
    const idxMH = findIdx(headers, ["MH", "MÃ HÀNG", "MA HANG"]);
    const idxAfter = findIdx(headers, ["AFTER 16H30", "16H30"]);
    const idxDMNgay = findIdx(headers, ["DM/NGAY", "ĐM/NGÀY", "DINH MUC NGAY", "DM NGAY"]);

    const lines = [];

    for (const r of rows) {
      const line = String(r[idxLine] ?? "").trim();
      if (!line) continue;

      const mh = idxMH >= 0 ? String(r[idxMH] ?? "").trim() : "";
      const hs_dat = idxAfter >= 0 ? toNumberSafe(r[idxAfter]) : 0;
      const hs_dm = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;

      const percent = hs_dm > 0 ? (hs_dat / hs_dm) * 100 : 0;
      const status = percent >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      lines.push({
        line,
        mh,
        hs_dat,
        hs_dm,
        percent: Number(percent.toFixed(2)),
        status,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,
      meta: { headers, idxMH, idxAfter, idxDMNgay },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "CHECK_KPI_ERROR",
      message: String(e?.message || e),
    });
  }
}