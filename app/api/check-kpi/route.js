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
  if (!t || t === "-" || t.toLowerCase() === "na") return 0;

  // xử lý số kiểu VN/US:
  // 2.814  -> 2814
  // 2,814  -> 2814
  // 2.814,50 -> 2814.50
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");

  if (hasDot && hasComma) {
    t = t.replace(/\./g, "").replace(/,/g, ".");
  } else if (hasDot && !hasComma) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  } else if (hasComma && !hasDot) {
    if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, "");
    else t = t.replace(/,/g, ".");
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

// tìm các cột giờ dạng =>9h, =>10h, =>11h, ...
function findHourCols(headers) {
  const hourCols = [];
  headers.forEach((name, idx) => {
    const s = String(name ?? "");
    const m = s.match(/(?:=>\s*)?(\d{1,2})\s*h(?:\s*([0-9]{2}))?/i);
    if (m) {
      const hh = m[1].padStart(2, "0");
      const mm = (m[2] || "00").padStart(2, "0");
      hourCols.push({ idx, label: `${hh}:${mm}` });
    }
  });

  // sort theo giờ
  hourCols.sort((a, b) => a.label.localeCompare(b.label));
  return hourCols;
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
      return NextResponse.json({ ok: true, date, range, lines: [], hourCols: [] });
    }

    const headers = values[0] || [];
    const rows = values.slice(1);

    const idxLine = 0;
    const idxMH = findIdx(headers, ["MH", "MA HANG", "MAHANG", "MÃ HÀNG"]);
    const idxAfter = findIdx(headers, ["AFTER 16H30", "AFTER16H30", "16H30"]);
    const idxDMNgay = findIdx(headers, [
      "DM/NGAY", "ĐM/NGÀY", "DM NGAY", "DINH MUC NGAY", "DINHMUCNGAY"
    ]);

    const hourCols = findHourCols(headers); // cột mốc giờ trong sheet

    const lines = [];
    for (const r of rows) {
      const line = String(r[idxLine] ?? "").trim();
      if (!line) continue;

      const mh = idxMH >= 0 ? String(r[idxMH] ?? "").trim() : "";
      const hs_dat = idxAfter >= 0 ? toNumberSafe(r[idxAfter]) : 0;
      const hs_dm = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;

      const percent = hs_dm > 0 ? (hs_dat / hs_dm) * 100 : 0;
      const status = percent >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      // dữ liệu theo giờ (nếu có các cột =>9h =>10h...)
      const hours = hourCols.map((c, i) => {
        const actual = toNumberSafe(r[c.idx]);
        const target = hs_dm > 0 ? (hs_dm * (i + 1)) / hourCols.length : 0; // target lũy tiến
        const ok = target > 0 ? actual >= target : false;
        return { label: c.label, actual, target: Number(target.toFixed(0)), ok };
      });

      lines.push({
        line,
        mh,
        hs_dat,
        hs_dm,
        percent: Number(percent.toFixed(2)),
        status,
        hours,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,
      meta: { headers, idxMH, idxAfter, idxDMNgay, hourCols },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "CHECK_KPI_ERROR",
      message: String(e?.message || e),
    });
  }
}
