// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { getValues } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

function norm(s) {
  return String(s ?? "").trim();
}

function buildHeaders(rowTop = [], rowSub = []) {
  const cols = Math.max(rowTop.length, rowSub.length);
  const headers = [];
  for (let c = 0; c < cols; c++) {
    const a = norm(rowTop[c]);
    const b = norm(rowSub[c]);
    headers.push(norm(`${a} ${b}`));
  }
  return headers;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    if (!date) return NextResponse.json({ ok: false, error: "Missing date" }, { status: 400 });

    // 1) lấy range từ CONFIG_KPI theo date
    const cfg = await getValues("CONFIG_KPI!A:B");
    let range = null;
    for (let i = 1; i < cfg.length; i++) {
      const d = norm(cfg[i]?.[0]);
      const r = norm(cfg[i]?.[1]);
      if (d === date && r) {
        range = r;
        break;
      }
    }
    if (!range) return NextResponse.json({ ok: false, error: "DATE_NOT_FOUND" }, { status: 404 });

    // 2) đọc dữ liệu KPI theo range
    const values = await getValues(range);
    if (!values.length) {
      return NextResponse.json({ ok: true, date, range, rows: [], meta: { headers: [] } });
    }

    // Giả định 2 hàng đầu là header (top + sub), từ hàng 3 trở đi là data
    const top = values[0] || [];
    const sub = values[1] || [];
    const headers = buildHeaders(top, sub);

    const dataRows = [];
    for (let i = 2; i < values.length; i++) {
      const row = values[i] || [];
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c] || `COL_${c + 1}`;
        obj[key] = row[c] ?? "";
      }
      dataRows.push(obj);
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      meta: { headers },
      rows: dataRows,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}