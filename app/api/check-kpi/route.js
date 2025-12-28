// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { getSheetsClient, getSpreadsheetId } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_SHEET = "CONFIG_KPI";
const TARGET_PERCENT = 100; // đạt nếu >= 100%

function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function norm(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”"]/g, "")
    .trim();
}

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findCol(headers, candidates) {
  const H = headers.map(norm);
  for (const cand of candidates) {
    const c = norm(cand);
    const idx = H.findIndex((h) => h === c || h.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

const TIME_MARKS = [
  { key: "->9h", h: 1 },
  { key: "->10h", h: 2 },
  { key: "->11h", h: 3 },
  { key: "->12h30", h: 4.5 },
  { key: "->13h30", h: 5.5 },
  { key: "->14h30", h: 6.5 },
  { key: "->15h30", h: 7.5 },
  { key: "->16h30", h: 8 },
];

async function loadConfigMap() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${CONFIG_SHEET}!A2:B`,
  });

  const rows = res.data.values || [];
  const map = {};
  for (const r of rows) {
    const d = String(r?.[0] || "").trim();
    const range = String(r?.[1] || "").trim();
    if (d && range) map[d] = range;
  }
  return map;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const lineFilter = (searchParams.get("line") || "").trim();

    if (!date) {
      return NextResponse.json(
        { ok: false, error: "Missing ?date=dd/mm/yyyy" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const config = await loadConfigMap();
    const range = config[date];
    if (!range) {
      return NextResponse.json(
        { ok: false, error: `No RANGE configured for date ${date}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const values = res.data.values || [];
    if (values.length < 3) {
      return NextResponse.json(
        { ok: true, date, range, lines: [], meta: { reason: "too-few-rows" } },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Header 2 hàng (giống sheet của bạn)
    const top = values[0] || [];
    const sub = values[1] || [];
    const colCount = Math.max(top.length, sub.length);

    const headers = [];
    for (let c = 0; c < colCount; c++) {
      const a = String(top[c] ?? "").trim();
      const b = String(sub[c] ?? "").trim();

      // nếu có sub thì ưu tiên sub, nhưng ghép thêm top để tránh trùng
      let h = "";
      if (b && a && norm(b) !== norm(a)) h = `${a} ${b}`;
      else h = b || a || "";
      headers.push(h);
    }

    // Cột cần dùng
    const idxMH = findCol(headers, ["MÃ HÀNG MH", "MA HANG MH", "MH", "MA HANG"]);
    const idxDMNgay = findCol(headers, ["DM/NGÀY DM", "DM/NGAY DM", "DM/NGAY", "DM/NGÀY"]);
    const idxDMH = findCol(headers, ["ĐM/H H", "DM/H H", "DM/H", "ĐM/H"]);

    // Time cols
    const timeIdx = {};
    for (const t of TIME_MARKS) {
      const i = findCol(headers, [t.key]);
      if (i >= 0) timeIdx[t.key] = i;
    }

    const lines = [];
    for (let r = 2; r < values.length; r++) {
      const row = values[r] || [];
      const line = String(row[0] || "").trim(); // cột A = chuyền
      if (!line) continue;

      if (lineFilter && norm(line) !== norm(lineFilter)) continue;

      const mh = idxMH >= 0 ? String(row[idxMH] || "").trim() : "";

      const dmNgay = idxDMNgay >= 0 ? toNumber(row[idxDMNgay]) : 0;
      const dmH = idxDMH >= 0 ? toNumber(row[idxDMH]) : 0;

      const luy = {};
      for (const t of TIME_MARKS) {
        const i = timeIdx[t.key];
        luy[t.key] = i >= 0 ? toNumber(row[i]) : 0;
      }

      const endVal = luy["->16h30"] || 0;
      const hs = dmNgay > 0 ? (endVal / dmNgay) * 100 : 0;
      const statusDay =
        dmNgay <= 0 ? "CHƯA CÓ" : hs >= TARGET_PERCENT ? "ĐẠT" : "KHÔNG ĐẠT";

      // per-hour for right panel
      const perHour = TIME_MARKS.map((t) => {
        const actual = luy[t.key] || 0;
        const expected = dmH > 0 ? dmH * t.h : 0;
        const diff = actual - expected;
        let st = "N/A";
        if (dmH > 0) st = actual >= expected ? "ĐẠT" : "CHƯA ĐẠT";
        return {
          moc: t.key,
          luy: actual,
          dmLuy: dmH > 0 ? Math.round(expected) : null,
          chenh: dmH > 0 ? Math.round(diff) : null,
          status: st,
        };
      });

      lines.push({
        line,
        mh,
        dmH: dmH || null,
        dmNgay: dmNgay || null,
        endVal,
        hs: dmNgay > 0 ? Number(hs.toFixed(2)) : null,
        hsTarget: TARGET_PERCENT,
        statusDay,
        perHour,
      });
    }

    return NextResponse.json(
      { ok: true, date, range, lines, meta: { headers } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}