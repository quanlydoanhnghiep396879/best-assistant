export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readValues } from "../_lib/googleSheetsClient";

const TZ = "Asia/Ho_Chi_Minh";

// Google Sheets serial date (vd 46014) -> dd/mm/yyyy
function serialToDDMMYYYY(n) {
  // Google Sheets serial day 0 = 1899-12-30
  const ms = (Number(n) - 25569) * 86400 * 1000; // 25569 days between 1899-12-30 and 1970-01-01
  if (!Number.isFinite(ms)) return null;

  const d = new Date(ms);
  const vn = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  const dd = String(vn.getDate()).padStart(2, "0");
  const mm = String(vn.getMonth() + 1).padStart(2, "0");
  const yyyy = vn.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDateCell(v) {
  if (v === null || v === undefined) return null;

  // serial number date
  if (typeof v === "number") return serialToDDMMYYYY(v);

  const s = String(v).trim();
  if (!s) return null;

  // dd/mm hoặc dd/mm/yyyy
  let m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    let yyyy = m[3];
    if (!yyyy) return null; // yêu cầu có năm để thống nhất
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${dd}/${mm}/${yyyy}`;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const yyyy = m[1];
    const mm = String(m[2]).padStart(2, "0");
    const dd = String(m[3]).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  return null;
}

export async function GET() {
  try {
    const sheetName = process.env.KPI_SHEET_NAME || "KPI";

    // QUÉT MỘT VÙNG VỪA ĐỦ (đỡ nặng)
    const full = await readValues(`${sheetName}!A1:AZ400`, {
      valueRenderOption: "UNFORMATTED_VALUE", // để bắt được cả số 46014
    });

    // 1) Lấy danh sách chuyền C1..Cx
    const linesSet = new Set();
    for (const row of full || []) {
      for (const cell of row || []) {
        const s = String(cell ?? "").trim().toUpperCase();
        if (/^C\d+$/.test(s)) linesSet.add(s);
      }
    }

    const lines = [...linesSet].sort(
      (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)
    );

    // thêm option tổng hợp
    const linesOut = ["TỔNG HỢP", ...lines];

    // 2) Lấy danh sách ngày
    const datesSet = new Set();
    for (const row of full || []) {
      for (const cell of row || []) {
        const d = normalizeDateCell(cell);
        if (d) datesSet.add(d);
      }
    }

    // sort giảm dần (mới nhất trước)
    const dates = [...datesSet].sort((a, b) => {
      const [da, ma, ya] = a.split("/").map(Number);
      const [db, mb, yb] = b.split("/").map(Number);
      return new Date(yb, mb - 1, db).getTime() - new Date(ya, ma - 1, da).getTime();
    });

    return NextResponse.json({ ok: true, dates, lines: linesOut });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "KPI_CONFIG_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}