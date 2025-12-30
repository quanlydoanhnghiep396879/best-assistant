import { NextResponse } from "next/server";
import { readRangeA1 } from "../_lib/googleSheetsClient";

// ✅ bắt Next route này luôn chạy dynamic (không bị lỗi request.url)
// ✅ chạy Node runtime (ổn định cho googleapis/JWT)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ================== HELPERS ================== */
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
  const h = (headers || []).map(norm);
  for (const c of candidates) {
    const nc = norm(c);
    const idx = h.findIndex((x) => x.includes(nc));
    if (idx >= 0) return idx;
  }
  return -1;
}

/* ================== ROUTE ================== */
export async function GET(req) {
  try {
    // ✅ luôn đúng trên mọi runtime (không dùng req.nextUrl)
    const url = new URL(req.url);
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || "";

    // Sheet + range
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

    // Cột cố định
    const idxLine = 0; // cột A thường là C1/C2...

    // Tự dò cột theo tiêu đề (đỡ phụ thuộc đúng tên)
    const idxMH = findIdx(headers, ["MH", "MÃ HÀNG", "MA HANG"]);
    const idxAfter = findIdx(headers, ["AFTER 16H30", "AFTER16H30", "16H30"]);
    const idxDMNgay = findIdx(headers, ["DM/NGAY", "ĐM/NGÀY", "DINH MUC NGAY", "DM NGAY"]);

    // (tuỳ bạn có trong sheet hay không) – để sau này hiện “luỹ tiến”/“định mức giờ”
    const idxDMGio = findIdx(headers, ["DM/GIO", "ĐM/GIỜ", "DINH MUC GIO", "DM GIO"]);
    const idxKiemDatLT = findIdx(headers, ["KIEM DAT LUY TIEN", "KIỂM ĐẠT LŨY TIẾN", "LUY TIEN", "LŨY TIẾN"]);

    const lines = [];

    for (const r of rows) {
      const line = String(r[idxLine] ?? "").trim();
      if (!line) continue;

      const mh = idxMH >= 0 ? String(r[idxMH] ?? "").trim() : "";

      const after = idxAfter >= 0 ? toNumberSafe(r[idxAfter]) : 0;
      const dmNgay = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;

      const dmGio = idxDMGio >= 0 ? toNumberSafe(r[idxDMGio]) : 0;
      const kiemDatLuyTien = idxKiemDatLT >= 0 ? toNumberSafe(r[idxKiemDatLT]) : 0;

      const percent = dmNgay > 0 ? (after / dmNgay) * 100 : 0;
      const status = dmNgay > 0 && percent >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      lines.push({
        line,
        mh,
        after,
        dmNgay,
        percent: Number(percent.toFixed(2)),
        status,

        // thêm để dashboard có dữ liệu “định mức giờ / luỹ tiến” nếu có cột
        dmGio,
        kiemDatLuyTien,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,
      // để debug cho bạn biết nó bắt đúng cột nào
      meta: {
        headers,
        idxMH,
        idxAfter,
        idxDMNgay,
        idxDMGio,
        idxKiemDatLT,
      },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "CHECK_KPI_ERROR",
      message: String(e?.message || e),
    });
  }
}