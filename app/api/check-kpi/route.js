
import { NextResponse } from "next/server";
import { readRangeA1 } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// normalize: bỏ dấu + bỏ ký tự đặc biệt để tìm header chắc ăn
function norm(s) {
  return String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, ""); // remove everything except letters+digits
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
    const nc = norm(c);
    const idx = h.findIndex((x) => x === nc || x.includes(nc));
    if (idx >= 0) return idx;
  }
  return -1;
}

// bắt các mốc giờ kiểu: "->9h", "9h", "12h30", "16h30"...
function pickTimeColumns(headers) {
  const out = [];
  headers.forEach((raw, idx) => {
    const s = String(raw ?? "").trim();
    // có chữ h/H và có số giờ
    if (!/[hH]/.test(s)) return;
    const m = s.match(/(\d{1,2})\s*[hH]\s*(30)?/);
    if (!m) return;
    const hh = parseInt(m[1], 10);
    if (!(hh >= 6 && hh <= 20)) return; // lọc bậy
    // label giữ nguyên header để hiển thị
    out.push({ idx, label: s });
  });

  // sort theo giờ tăng (dựa vào số đầu tiên)
  out.sort((a, b) => {
    const ah = parseInt(String(a.label).match(/(\d{1,2})/)?.[1] || "0", 10);
    const bh = parseInt(String(b.label).match(/(\d{1,2})/)?.[1] || "0", 10);
    return ah - bh;
  });

  return out;
}

export async function GET(request) {
  try {
    const date = request.nextUrl.searchParams.get("date") || "";

    const sheetName = process.env.KPI_SHEET_NAME || "KPI";
    const range = `${sheetName}!A20:AZ37`;

    const values = await readRangeA1(range, {
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    if (!values || values.length === 0) {
      return NextResponse.json({ ok: true, date, range, lines: [], progress: [] });
    }

    const headers = values[0] || [];
    const rows = values.slice(1);

    const idxLine = 0;
    const idxMH = findIdx(headers, ["MH", "MA HANG", "MÃ HÀNG"]);
    const idxAfter = findIdx(headers, ["AFTER 16H30", "AFTER16H30", "SAU 16H30", "16H30"]);
    const idxDMNgay = findIdx(headers, ["DM/NGAY", "DM NGAY", "DINH MUC NGAY", "ĐM/NGÀY", "DM/NGÀY"]);

    // lấy các cột mốc giờ để làm lũy tiến
    const timeCols = pickTimeColumns(headers);

    const lines = [];

    for (const r of rows) {
      const line = String(r[idxLine] ?? "").trim();
      if (!line) continue;

      const mh = idxMH >= 0 ? String(r[idxMH] ?? "").trim() : "";
      const after = idxAfter >= 0 ? toNumberSafe(r[idxAfter]) : 0;
      const dm = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;

      const percent = dm > 0 ? (after / dm) * 100 : 0;
      const status = dm > 0 && percent >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      // lũy tiến theo giờ: actual = giá trị tại cột mốc đó, expected = dm * frac
      const checkpoints = timeCols.map((c, i) => {
        const frac = timeCols.length <= 1 ? 1 : i / (timeCols.length - 1); // 0..1
        const actual = toNumberSafe(r[c.idx]);
        const expected = dm * frac;
        const p = expected > 0 ? (actual / expected) * 100 : 0;
        return {
          label: c.label,
          actual,
          expected: Number(expected.toFixed(2)),
          percent: Number(p.toFixed(2)),
          delta: Number((actual - expected).toFixed(2)),
        };
      });

      lines.push({
        line,
        mh,
        after,
        dm,
        percent: Number(percent.toFixed(2)),
        status,
        checkpoints,
      });
    }

    // tổng hợp lũy tiến toàn xưởng (cộng tất cả chuyền)
    const progress = [];
    for (let i = 0; i < timeCols.length; i++) {
      const label = timeCols[i].label;
      const frac = timeCols.length <= 1 ? 1 : i / (timeCols.length - 1);

      let sumActual = 0;
      let sumExpected = 0;

      for (const ln of lines) {
        sumActual += ln.checkpoints[i]?.actual || 0;
        sumExpected += (ln.dm || 0) * frac;
      }

      const p = sumExpected > 0 ? (sumActual / sumExpected) * 100 : 0;
      progress.push({
        label,
        actual: Number(sumActual.toFixed(2)),
        expected: Number(sumExpected.toFixed(2)),
        percent: Number(p.toFixed(2)),
        delta: Number((sumActual - sumExpected).toFixed(2)),
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,
      progress,
      meta: { idxMH, idxAfter, idxDMNgay, headers },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "CHECK_KPI_ERROR",
      message: String(e?.message || e),
    });
  }
}