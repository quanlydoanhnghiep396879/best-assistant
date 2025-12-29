import { NextResponse } from "next/server";
import { readRangeA1, requireEnv } from "../_lib/googleSheetsClient"; // chỉnh path đúng theo dự án bạn

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

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || "";

    // Range KPI (bạn đang dùng KPI!A20:AZ37)
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

    // Bạn có thể đổi candidates theo header thực tế trong sheet KPI
    const idxLine = 0; // cột A thường là chuyền C1/C2...
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
      values, // giữ lại để debug
      lines,  // cái dashboard cần
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
