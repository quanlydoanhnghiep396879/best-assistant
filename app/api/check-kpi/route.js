import { NextResponse } from "next/server";
import { readRangeA1 } from "../_lib/googleSheetsClient";

// Chuẩn hoá mạnh: bỏ dấu tiếng Việt + bỏ mọi ký tự không phải chữ/số
function norm(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")      // bỏ dấu
    .replace(/[^A-Z0-9]/g, "");          // bỏ space, /, _, -, ., v.v.
}

// Parse số kiểu VN: 2.814 / 2,814 / 2 814 -> 2814
function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  let t = String(v).trim();
  if (!t) return 0;

  t = t.replace(/\s+/g, "");

  // dạng 1.234.567
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  // dạng 1,234,567
  if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, "");

  // nếu vẫn còn dấu phẩy (thường là ngăn nghìn) thì bỏ
  t = t.replace(/,/g, "");

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

// tìm các cột giờ: 9H / 10H / ->9H / 9H30 ...
function findHourCols(headers) {
  const out = [];
  headers.forEach((h, idx) => {
    const raw = String(h ?? "").toUpperCase();
    // bắt "9H", "->9H", "9H30", "12H30"...
    const m = raw.match(/(?:->\s*)?(\d{1,2})\s*H(?:\s*(\d{2}))?/i);
    if (m) {
      const hh = m[1].padStart(2, "0");
      const mm = (m[2] || "00").padStart(2, "0");
      out.push({ idx, label: `${hh}:${mm}`, raw: String(h ?? "") });
    }
  });
  return out;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || "";

    const sheetName = process.env.KPI_SHEET_NAME || "KPI";

    // 🔥 IMPORTANT: nới range rộng hơn để không bị thiếu cột DM/NGÀY
    // Bạn có thể tăng thêm nếu DM/NGÀY nằm xa hơn: CO, CP...
    const range = `${sheetName}!A20:CO37`;

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
    const idxMH = findIdx(headers, ["MH", "MAHANG", "MA HANG", "MÃHÀNG", "MÃ HÀNG"]);
    const idxAfter = findIdx(headers, ["AFTER16H30", "AFTER 16H30", "16H30"]);
    const idxDMNgay = findIdx(headers, ["DMNGAY", "DM/NGAY", "ĐM/NGÀY", "DINHMUCNGAY", "DINH MUC NGAY"]);
    const idxKiemDat = findIdx(headers, ["KIEMDAT", "KIỂMĐẠT", "KIEM DAT"]);

    const hourCols = findHourCols(headers);

    const lines = [];
    for (const r of rows) {
      const line = String(r[idxLine] ?? "").trim();
      if (!line) continue;

      const mh = idxMH >= 0 ? String(r[idxMH] ?? "").trim() : "";
      const hs_dat = idxAfter >= 0 ? toNumberSafe(r[idxAfter]) : 0;
      const hs_dm = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;

      const percent = hs_dm > 0 ? (hs_dat / hs_dm) * 100 : 0;
      const status = hs_dm > 0 && percent >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      lines.push({
        line,
        mh,
        hs_dat,
        hs_dm,
        percent: Number(percent.toFixed(2)),
        status,
        kiem_dat: idxKiemDat >= 0 ? toNumberSafe(r[idxKiemDat]) : 0,
      });
    }

    // Tổng lũy tiến theo giờ (nếu có cột giờ)
    const hourTotals = hourCols.map((c) => {
      let sum = 0;
      for (const r of rows) sum += toNumberSafe(r[c.idx]);
      return { label: c.label, sum };
    });

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,
      hourTotals,
      meta: { idxMH, idxAfter, idxDMNgay, idxKiemDat, headersPreview: headers.slice(0, 30) },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "CHECK_KPI_ERROR",
      message: String(e?.message || e),
    });
  }
}