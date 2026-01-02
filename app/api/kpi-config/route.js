
// app/api/kpi-config/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readValues } from "../_lib/googleSheetsClient";
import { sheetNames } from "../_lib/sheetName";

function normalizeVNDate(v) {
  const s = String(v ?? "").trim();
  // dd/mm hoặc dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;

  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");

  // nếu thiếu năm -> lấy năm hiện tại (giờ VN)
  let yyyy = m[3];
  if (!yyyy) {
    const now = new Date();
    const vn = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    yyyy = String(vn.getFullYear());
  } else {
    yyyy = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  }

  return `${dd}/${mm}/${yyyy}`;
}

function sortKeyVNDate(d) {
  const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  return new Date(yyyy, mm - 1, dd).getTime();
}

export async function GET() {
  try {
    const { KPI_SHEET_NAME, CONFIG_KPI_SHEET_NAME } = sheetNames();

    // ===== 1) Lấy danh sách chuyền (C1..Cn) từ KPI cột A =====
    const colA = await readValues(`${KPI_SHEET_NAME}!A4:A200`, {
      valueRenderOption: "FORMATTED_VALUE",
    });

    const linesSet = new Set();
    for (const r of colA || []) {
      const s = String(r?.[0] ?? "").trim().toUpperCase();
      if (/^C\d+$/.test(s)) linesSet.add(s);
    }

    const lines = Array.from(linesSet).sort(
      (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)
    );

    // (tuỳ bạn) thêm "TỔNG HỢP" lên đầu list
    const linesOut = ["TỔNG HỢP", ...lines];

    // ===== 2) Lấy danh sách ngày từ CONFIG_KPI!A2:A =====
    // KHÔNG quét toàn KPI để tránh “ngày 1900”
    const datesRaw = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A`, {
      valueRenderOption: "FORMATTED_VALUE",
    });

    const datesSet = new Set();
    for (const r of datesRaw || []) {
      const d = normalizeVNDate(r?.[0]);
      if (d) datesSet.add(d);
    }

    const dates = Array.from(datesSet).sort((a, b) => sortKeyVNDate(b) - sortKeyVNDate(a));

    return NextResponse.json({ ok: true, dates, lines: linesOut });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "KPI_CONFIG_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}