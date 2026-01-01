// app/api/kpi-config/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readValues } from "../_lib/googleSheetsClient";

// -------- Helpers --------
function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatVNDate(d) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Google Sheets serial date: days since 1899-12-30
function serialToDate(serial) {
  const base = new Date(Date.UTC(1899, 11, 30));
  const ms = base.getTime() + Number(serial) * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

function extractVNDate(cell) {
  if (cell === null || cell === undefined) return null;

  // nếu là number (hoặc string số kiểu 46014) -> convert serial
  const s0 = String(cell).trim();
  if (/^\d{4,6}$/.test(s0)) {
    const num = Number(s0);
    // range hợp lý cho serial (tránh bắt nhầm số khác)
    if (Number.isFinite(num) && num >= 30000 && num <= 70000) {
      return formatVNDate(serialToDate(num));
    }
  }

  // dd/mm/yyyy hoặc d/m/yyyy
  const m = s0.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;

  const dd = pad2(m[1]);
  const mm = pad2(m[2]);
  let yyyy = m[3];

  if (!yyyy) return null; // muốn full ngày có năm để so sánh chuẩn
  if (yyyy.length === 2) yyyy = `20${yyyy}`;

  return `${dd}/${mm}/${yyyy}`;
}

function dateSortKey(vnDate) {
  const m = String(vnDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  return new Date(yyyy, mm - 1, dd).getTime();
}

// -------- Route --------
export async function GET() {
  try {
    const KPI_SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";

    // FORMATTED_VALUE để lấy đúng "24/12/2025" thay vì serial
    const grid = await readValues(`${KPI_SHEET_NAME}!A1:AZ3000`, {
      valueRenderOption: "FORMATTED_VALUE",
    });

    const datesSet = new Set();
    const linesSet = new Set();

    for (const row of grid || []) {
      for (const cell of row || []) {
        const s = String(cell ?? "").trim().toUpperCase();

        // bắt chuyền: C1, C2, C10...
        if (/^C\d+$/.test(s)) linesSet.add(s);

        // bắt ngày dd/mm/yyyy (hoặc serial)
        const d = extractVNDate(cell);
        if (d) datesSet.add(d);
      }
    }

    const dates = [...datesSet].sort((a, b) => dateSortKey(b) - dateSortKey(a));
    const lines = [...linesSet].sort(
      (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)
    );

    return NextResponse.json({ ok: true, dates, lines });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "KPI_CONFIG_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
