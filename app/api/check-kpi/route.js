// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import {
  readRange,
  normalizeDDMMYYYY,
  ddmmyyyySortKey,
} from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  // bỏ dấu % và dấu phẩy
  const n = Number(s.replace(/%/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findHeaderIndex(headers, candidates) {
  const up = headers.map((h) => String(h || "").trim().toUpperCase());
  for (const c of candidates) {
    const idx = up.indexOf(c.toUpperCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = normalizeDDMMYYYY(searchParams.get("date") || "");
    if (!dateParam) {
      return NextResponse.json({ ok: false, error: "MISSING_DATE" }, { status: 400 });
    }

    // 1) đọc CONFIG_KPI để map date -> range
    const cfg = await readRange("CONFIG_KPI!A2:B", { valueRenderOption: "FORMATTED_VALUE" });

    let foundRange = "";
    const items = [];
    for (const r of cfg) {
      const d = normalizeDDMMYYYY(r?.[0] || "");
      const range = (r?.[1] || "").trim();
      if (d && range) items.push({ d, range });
      if (d === dateParam && range) foundRange = range;
    }

    if (!foundRange) {
      // trả thêm list date để debug
      items.sort((a, b) => ddmmyyyySortKey(a.d).localeCompare(ddmmyyyySortKey(b.d)));
      return NextResponse.json({
        ok: false,
        error: "DATE_NOT_FOUND",
        date: dateParam,
        availableDates: items.map(x => x.d),
      });
    }

    // 2) đọc KPI data
    const values = await readRange(foundRange, { valueRenderOption: "FORMATTED_VALUE" });
    if (!values.length) {
      return NextResponse.json({ ok: true, date: dateParam, range: foundRange, values: [], lines: [] });
    }

    // 3) build meta + lines để UI render
    const headers = values[0] || [];
    const rows = values.slice(1);

    const idxLine = 0; // cột A thường là C1/C2...
    const idxMH = findHeaderIndex(headers, ["MH", "MÃ HÀNG", "MA HANG"]);
    const idxDMNgay = findHeaderIndex(headers, ["DM/NGÀY", "DM/NGAY", "ĐM/NGÀY", "ĐM/NGAY"]);
    // cột kết thúc thường là "->16h30" hoặc có "16H30"
    let idxFinal = headers.findIndex(h => String(h || "").includes("16h30") || String(h || "").includes("16H30"));
    if (idxFinal < 0) idxFinal = headers.length - 1;

    const lines = rows
      .map((r) => {
        const line = String(r?.[idxLine] || "").trim();
        if (!line) return null;

        const mh = idxMH >= 0 ? String(r?.[idxMH] || "").trim() : "";

        const dmNgay = idxDMNgay >= 0 ? toNumberSafe(r?.[idxDMNgay]) : 0;
        const finalQty = toNumberSafe(r?.[idxFinal]);

        const hs = dmNgay > 0 ? (finalQty / dmNgay) * 100 : 0;
        const hsFixed = Number.isFinite(hs) ? Number(hs.toFixed(2)) : 0;

        return {
          line,                 // dùng cho dropdown chọn chuyền
          mh,                   // mã hàng
          hs_dat: hsFixed,      // % đạt (tính theo ->16h30 / DM/NGÀY)
          hs_dm: 100,           // định mức 100%
          status: hsFixed >= 100 ? "ĐẠT" : "KHÔNG ĐẠT",
        };
      })
      .filter(Boolean);

    // perLine: nếu UI bạn đang cần theo giờ, tạm để [] (UI vẫn render bảng bên trái được)
    const perLine = [];

    return NextResponse.json({
      ok: true,
      date: dateParam,
      range: foundRange,

      // ✅ giữ raw để debug
      values,

      // ✅ format cho dashboard
      lines,
      perLine,
      meta: {
        headers,
        headerRowIndex: 0,
        idx: { idxLine, idxMH, idxDMNgay, idxFinal },
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}