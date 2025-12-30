export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readRangeA1 } from "../_lib/googleSheetsClient";

function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  let t = String(v).trim();
  if (!t) return 0;

  // xử lý kiểu VN: 2.814,50 hoặc 2.814
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");
  if (hasDot && hasComma) {
    // . là ngăn nghìn, , là thập phân
    t = t.replace(/\./g, "").replace(/,/g, ".");
  } else if (hasDot && !hasComma) {
    // nếu dạng 2.814 (ngăn nghìn) => 2814
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  } else {
    // dạng 2,814 => 2814
    t = t.replace(/,/g, "");
  }

  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function findIdx(headers, candidates) {
  const h = headers.map(norm);
  for (const c of candidates) {
    const key = norm(c);
    const idx = h.findIndex((x) => x.includes(key));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function GET(req) {
  try {
    const date = req.nextUrl.searchParams.get("date") || "";

    const sheetName = process.env.KPI_SHEET_NAME || "KPI";
    const range = `${sheetName}!A20:AZ37`;

    const values = await readRangeA1(range, {
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    if (!values?.length) {
      return NextResponse.json({ ok: true, date, range, lines: [], meta: {} });
    }

    const headers = values[0] || [];
    const rows = values.slice(1);

    const idxLine = 0;
    const idxMH = findIdx(headers, ["MH", "MAHANG", "MA HANG"]);
    const idxAfter = findIdx(headers, ["AFTER16H30", "AFTER 16H30", "16H30"]);
    const idxDMNgay = findIdx(headers, ["DMNGAY", "DM/NGAY", "ĐM/NGÀY", "DINHMUCNGAY"]);

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