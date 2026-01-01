// app/api/check-kpi/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** ===================== Helpers ===================== */
function normText(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[._-]/g, "")
    .replace(/[()]/g, "");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  const t = String(v).trim();
  if (!t) return 0;
  const cleaned = t.replace(/,/g, "").replace(/%/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// yyyy-mm-dd -> dd/mm/yyyy
function isoToDmy(iso) {
  const m = String(iso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "").trim();
  const yyyy = m[1];
  const mm = m[2];
  const dd = m[3];
  return `${dd}/${mm}/${yyyy}`;
}

function dateKeys(dateStr) {
  const s = String(dateStr || "").trim();
  // allow dd/mm or dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return [s];

  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  const yyyy = m[3]
    ? m[3].length === 2
      ? `20${m[3]}`
      : m[3]
    : "";

  const short = `${dd}/${mm}`; // 24/12
  const full = yyyy ? `${dd}/${mm}/${yyyy}` : short; // 24/12/2025
  return yyyy ? [full, short] : [short];
}

function includesAny(h, arr) {
  const H = normText(h);
  return arr.some((x) => H.includes(normText(x)));
}

function findIdx(headers, candidates) {
  const H = headers.map(normText);
  // 1) exact
  for (const c of candidates) {
    const cc = normText(c);
    const idx = H.findIndex((x) => x === cc);
    if (idx >= 0) return idx;
  }
  // 2) includes
  for (const c of candidates) {
    const cc = normText(c);
    const idx = H.findIndex((x) => x.includes(cc));
    if (idx >= 0) return idx;
  }
  return -1;
}

// merge 2 header rows (row0 + row1)
function mergeHeaders(row0, row1) {
  const n = Math.max(row0.length, row1.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = String(row0[i] ?? "").trim();
    const b = String(row1[i] ?? "").trim();
    out[i] = (a && b) ? `${a} ${b}`.trim() : (a || b || "");
  }
  return out;
}

/** ===================== Google Sheets ===================== */
async function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  }

  // fix \n in Vercel env
  privateKey = privateKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

async function readRange(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });
  return res.data.values || [];
}

/** ===================== Main API ===================== */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.KPI_SHEET_NAME || "KPI";

    if (!sheetId) {
      return NextResponse.json(
        { ok: false, error: "Missing GOOGLE_SHEET_ID env" },
        { status: 500 }
      );
    }

    // date can be "yyyy-mm-dd" from <input type="date">
    const dateParamRaw = searchParams.get("date") || "";
    const dateParam = dateParamRaw.includes("-") ? isoToDmy(dateParamRaw) : dateParamRaw;
    const dKeys = dateKeys(dateParam); // ["dd/mm/yyyy","dd/mm"] or ["dd/mm"]

    // read a safe big range (header + data)
    const range = `${sheetName}!A20:AZ80`;
    const values = await readRange(sheetId, range);

    if (!values.length) {
      return NextResponse.json({ ok: true, date: dateParam, range, lines: [], meta: { reason: "empty_range" } });
    }

    // detect header rows
    const row0 = values[0] || [];
    const row1 = values[1] || [];
    const headers = mergeHeaders(row0, row1).map((x) => String(x || "").trim());

    const dataRows = values.slice(2); // start after 2 header rows

    // columns (not date-dependent)
    const idxLine = findIdx(headers, ["CHUYEN", "CHUYỀN", "LINE"]);
    const idxMH = findIdx(headers, ["MH", "MÃ HÀNG", "MA HANG", "ITEM", "STYLE"]);
    const idxAfter = findIdx(headers, ["AFTER 16H30", "AFTER16H30", "->16H30", "16H30", "AFTER 16:30"]);
    const idxDmNgay = findIdx(headers, ["DM/NGAY", "DM/NGÀY", "DM NGAY", "DMNGAY"]);
    const idxDmH = findIdx(headers, ["DM/H", "DMH", "DM GIO", "ĐM/H", "ĐM GIỜ"]);

    // hour columns (date-dependent preferred)
    const hourDefs = [
      { label: "09:00", k: 1, candidates: ["->9H", "9H", "09:00", "09H00", "9:00"] },
      { label: "10:00", k: 2, candidates: ["->10H", "10H", "10:00", "10H00", "10:00"] },
      { label: "11:00", k: 3, candidates: ["->11H", "11H", "11:00", "11H00", "11:00"] },
      { label: "12:30", k: 4, candidates: ["->12H30", "12H30", "12:30", "1230"] },
      { label: "13:30", k: 5, candidates: ["->13H30", "13H30", "13:30", "1330"] },
      { label: "14:30", k: 6, candidates: ["->14H30", "14H30", "14:30", "1430"] },
      { label: "15:30", k: 7, candidates: ["->15H30", "15H30", "15:30", "1530"] },
      { label: "16:30", k: 8, candidates: ["->16H30", "16H30", "AFTER 16H30", "AFTER16H30", "16:30", "1630"] },
    ];

    function findHourCol(cands) {
      // ưu tiên header có chứa ngày + giờ
      const idxDateHour = headers.findIndex((h) => includesAny(h, cands) && includesAny(h, dKeys));
      if (idxDateHour >= 0) return idxDateHour;
      // fallback: chỉ cần giờ (nếu sheet chỉ có 1 ngày / header không chứa ngày)
      return headers.findIndex((h) => includesAny(h, cands));
    }

    const hourCols = hourDefs.map((h) => ({
      label: h.label,
      k: h.k,
      idx: findHourCol(h.candidates),
      candidates: h.candidates,
    }));

    // build lines
    const lines = [];
    for (const r of dataRows) {
      const line = idxLine >= 0 ? String(r[idxLine] || "").trim() : "";
      const mh = idxMH >= 0 ? String(r[idxMH] || "").trim() : "";

      // ignore empty rows
      if (!line && !mh) continue;

      const after = idxAfter >= 0 ? toNumberSafe(r[idxAfter]) : 0;
      const dmNgay = idxDmNgay >= 0 ? toNumberSafe(r[idxDmNgay]) : 0;
      const dmH = idxDmH >= 0 ? toNumberSafe(r[idxDmH]) : 0;

      const percent = dmNgay > 0 ? (after / dmNgay) * 100 : 0;
      const status = percent >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      const hours = hourCols
        .filter((hc) => hc.idx >= 0)
        .map((hc) => {
          const actual = toNumberSafe(r[hc.idx]);
          // target giờ: DM/H * k (k = số mốc lũy tiến)
          const target = dmH > 0 ? dmH * hc.k : 0;
          const diff = actual - target;
          let hStatus = "ĐỦ";
          if (diff > 0) hStatus = "VƯỢT";
          else if (diff < 0) hStatus = "THIẾU";

          return { label: hc.label, k: hc.k, actual, target, diff, status: hStatus };
        });

      lines.push({
        line,
        mh,
        after,
        dmNgay,
        dmH,
        percent,
        status,
        hours,
      });
    }

    return NextResponse.json({
      ok: true,
      date: dateParam,
      dateKeys: dKeys,
      range,
      lines,
      meta: {
        idxLine,
        idxMH,
        idxAfter,
        idxDmNgay,
        idxDmH,
        hourCols,
        headersPreview: headers.slice(0, 25),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}