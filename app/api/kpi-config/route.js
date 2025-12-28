import { NextResponse } from "next/server";
import { sheetsClient, mustEnv } from "../_lib/googleSheetsClient";

// ===== helpers =====
function pad2(n) { return String(n).padStart(2, "0"); }

function serialToDMY(serial) {
  const base = Date.UTC(1899, 11, 30);
  const ms = base + Number(serial) * 86400000;
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function normalizeDateCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return serialToDMY(v);

  const s = String(v).trim();
  if (!s) return "";

  // chuỗi toàn số => serial
  if (/^\d+$/.test(s)) return serialToDMY(Number(s));

  return s; // dd/mm/yyyy
}

function dmyToKey(dmy) {
  // "23/12/2025" -> "2025-12-23" để sort
  const [dd, mm, yyyy] = dmy.split("/");
  if (!dd || !mm || !yyyy) return "";
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(req) {
  try {
    const spreadsheetId = mustEnv("SPREADSHEET_ID", "GOOGLE_SHEET_ID");

    // đọc CONFIG_KPI: cột A=DATE, B=RANGE, bắt đầu từ dòng 2
    const sheets = sheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CONFIG_KPI!A2:B",
      valueRenderOption: "UNFORMATTED_VALUE", // để lấy serial number nếu có
    });

    const rows = resp.data.values || [];

    const items = rows
      .map(r => ({
        date: normalizeDateCell(r?.[0]),
        range: (r?.[1] || "").toString().trim(),
      }))
      .filter(x => x.date && x.range); // phải có cả date + range

    // sort tăng dần để 23 nằm trên 24
    items.sort((a, b) => dmyToKey(a.date).localeCompare(dmyToKey(b.date)));

    // list ngày
    const dates = items.map(x => x.date);

    return NextResponse.json({ ok: true, dates });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}