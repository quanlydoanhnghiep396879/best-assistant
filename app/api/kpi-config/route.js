export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readRangeA1 } from "../googleSheetsClient";

function extractDateFromCell(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;

  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  const yyyy = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : "";

  return yyyy ? `${dd}/${mm}/${yyyy}` : `${dd}/${mm}`;
}

function todayYearVN() {
  const now = new Date();
  const vn = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return vn.getFullYear();
}

function sortKeyVNDate(d) {
  const year = todayYearVN();
  const m = String(d).match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
  if (!m) return 0;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = m[3] ? Number(m[3]) : year;
  return new Date(yyyy, mm - 1, dd).getTime();
}

export async function GET() {
  try {
    const sheetName = process.env.KPI_SHEET_NAME || "KPI";
    const values = await readRangeA1(`${sheetName}!A1:AZ3000`);

    const dates = new Map();

    for (const row of values || []) {
      for (const cell of row || []) {
        const d = extractDateFromCell(cell);
        if (d) {
          dates.set(d, d);
          break;
        }
      }
    }

    const out = Array.from(dates.values()).sort((a, b) => sortKeyVNDate(b) - sortKeyVNDate(a)); // mới nhất trước

    return NextResponse.json({ ok: true, dates: out });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "KPI_CONFIG_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}