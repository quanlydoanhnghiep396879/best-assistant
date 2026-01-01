export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { readRangeA1 } from "../_lib/googleSheetsClient";

// ====== date match (dd/mm or dd/mm/yyyy) ======
function dateKeys(dateStr) {
  const s = String(dateStr || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return [s];

  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  const yyyy = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : "";

  const short = `${dd}/${mm}`;
  const full = yyyy ? `${dd}/${mm}/${yyyy}` : short;
  return yyyy ? [full, short] : [short];
}

function matchDateCell(cell, dateStr) {
  const keys = dateKeys(dateStr);
  const c = String(cell || "").trim();
  return keys.some((k) => c === k || c.includes(k));
}

function rowHasDate(row, dateStr) {
  return (row || []).some((cell) => matchDateCell(cell, dateStr));
}

function rowHasAnyDate(row) {
  return (row || []).some((cell) => {
    const s = String(cell ?? "").trim();
    return /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.test(s);
  });
}

// ====== helpers ======
function norm(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[._-]/g, "");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/%/g, "").replace(/,/g, "."));
  return Number.isFinite(n) ? n : 0;
}

function toPercent(v) {
  const n = toNumberSafe(v);
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

function findIdx(headers, candidates) {
  const H = (headers || []).map(norm);
  for (const c of candidates) {
    const idx = H.findIndex((x) => x.includes(norm(c)));
    if (idx >= 0) return idx;
  }
  return -1;
}

function isLineLabel(s) {
  const t = String(s ?? "").trim().toUpperCase();
  if (!t) return false;
  if (/^C\d+$/i.test(t)) return true;
  if (["CẮT", "CAT", "KCS", "HOÀN TẤT", "HOAN TAT", "NM"].includes(t)) return true;
  return false;
}

function findHeaderRowIndex(blockRows) {
  // header thường có các keyword
  const keywords = ["CHUYỀN", "CHUYEN", "LINE", "MH", "HIỆU SUẤT", "HS", "ĐM", "DINH MUC", "TARGET"];
  let best = -1;
  let bestScore = -1;

  for (let i = 0; i < Math.min(blockRows.length, 15); i++) {
    const row = blockRows[i] || [];
    const joined = row.map((x) => norm(x)).join(" | ");
    let score = 0;
    for (const k of keywords) if (joined.includes(norm(k))) score++;

    const firstNonEmpty = row.find((x) => String(x ?? "").trim() !== "");
    if (isLineLabel(firstNonEmpty)) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore > 0 ? best : -1;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = String(searchParams.get("date") || "").trim();
    if (!dateParam) {
      return NextResponse.json(
        { ok: false, error: "MISSING_DATE", message: "Thiếu query ?date=dd/mm hoặc dd/mm/yyyy" },
        { status: 400 }
      );
    }

    const sheetName = process.env.KPI_SHEET_NAME || "KPI";
    const values = await readRangeA1(`${sheetName}!A1:AZ3000`, {
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    if (!values?.length) return NextResponse.json({ ok: true, date: dateParam, daily: [] });

    // 1) find start row contains date
    let start = -1;
    for (let i = 0; i < values.length; i++) {
      if (rowHasDate(values[i], dateParam)) {
        start = i;
        break;
      }
    }
    if (start < 0) {
      return NextResponse.json(
        { ok: false, error: "DATE_NOT_FOUND", message: `Không tìm thấy ngày ${dateParam} trong sheet` },
        { status: 404 }
      );
    }

    // 2) end = before next date row
    let end = values.length;
    for (let i = start + 1; i < values.length; i++) {
      if (rowHasAnyDate(values[i])) {
        end = i;
        break;
      }
    }

    const block = values.slice(start + 1, end); // below the date row
    const headerIdx = findHeaderRowIndex(block);
    if (headerIdx < 0) {
      return NextResponse.json(
        { ok: false, error: "HEADER_NOT_FOUND", message: "Không tìm thấy dòng header trong block ngày" },
        { status: 400 }
      );
    }

    const headers = block[headerIdx] || [];
    const dataRows = block.slice(headerIdx + 1);

    // 3) locate columns (tùy sheet đặt tên)
    const idxLine = findIdx(headers, ["CHUYỀN", "CHUYEN", "LINE"]);
    const idxMH = findIdx(headers, ["MH", "MÃ HÀNG", "MA HANG"]);

    // HS_ĐẠT: hiệu suất đạt thực tế trong ngày (after...)
    const idxHSdat = findIdx(headers, ["HS ĐẠT", "HS_DAT", "HIỆU SUẤT ĐẠT", "THỰC TẾ", "AFTER", "16H30"]);
    // HS_ĐM: hiệu suất định mức trong ngày
    const idxHSdm = findIdx(headers, ["HS NGÀY", "HS_NGAY", "HIỆU SUẤT NGÀY", "ĐM", "DINH MUC", "TARGET"]);

    const daily = [];

    for (const r of dataRows) {
      let line = "";
      if (idxLine >= 0) line = String(r[idxLine] ?? "").trim();
      if (!line) {
        const first = r.find((x) => String(x ?? "").trim() !== "");
        line = String(first ?? "").trim();
      }
      if (!isLineLabel(line)) continue;

      const mh = idxMH >= 0 ? String(r[idxMH] ?? "").trim() : "";

      const hs_dat = idxHSdat >= 0 ? toPercent(r[idxHSdat]) : 0;
      const hs_dm = idxHSdm >= 0 ? toPercent(r[idxHSdm]) : 0;

      // ✅ đúng yêu cầu của bạn: >= là đạt
      const okDay = hs_dat >= hs_dm;

      daily.push({
        line,
        mh,
        hs_dat,
        hs_dm,
        status: okDay ? "ĐẠT" : "KHÔNG ĐẠT",
      });
    }

    return NextResponse.json({
      ok: true,
      date: dateParam,
      daily,
      meta: { dateRow: start + 1, headerRow: start + 2 + headerIdx },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "CHECK_KPI_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}