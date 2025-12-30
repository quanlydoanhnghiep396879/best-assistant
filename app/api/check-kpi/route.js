import { NextResponse } from "next/server";
import { readRangeA1 } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function norm(s) {
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

  // "95.87%" => 95.87
  const cleaned = t.replace(/,/g, "").replace(/%/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * findIdx:
 * - ưu tiên EXACT match trước
 * - sau đó mới includes
 */
function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function dateKeys(dateStr) {
  const s = String(dateStr || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return [s];

  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  const yyyy = m[3] ? (m[3].length === 2 ? `20${m[3]}`: m[3]) : "";

  const short = `${dd}/${mm}`;                       // 24/12
  const full  = yyyy ? `${dd}/${mm}/${yyyy}` : short; // 24/12/2025
  return yyyy ? [full, short] : [short];
}

function matchDateCell(cell, dateStr) {
  const keys = dateKeys(dateStr).map(norm);
  const c = norm(cell);
  // match exact hoặc header có thêm chữ vẫn bắt được
  return keys.some(k => c === k || c.includes(k));
}

// ===== dùng để tìm cột ngày trong headers =====
const dateParam = searchParams.get("date") || "";
const dateColIdx = headers.findIndex(h => matchDateCell(h, dateParam));


function mergeHeaders(rowA = [], rowB = []) {
  const n = Math.max(rowA.length, rowB.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = String(rowA[i] ?? "").trim();
    const b = String(rowB[i] ?? "").trim();

    if (a && b) out.push(`${a} ${b}`);
    else out.push(a || b || "");
  }
  return out;
}

// mốc giờ lũy tiến (bạn có thể thêm/bớt tùy sheet)
const CHECKPOINTS = [
  { key: "H09", label: "09:00", k: 1, candidates: ["->9H", "=>9H", ">9H", "9H", "09:00", "0900"] },
  { key: "H10", label: "10:00", k: 2, candidates: ["->10H", "=>10H", ">10H", "10H", "10:00", "1000"] },
  { key: "H11", label: "11:00", k: 3, candidates: ["->11H", "=>11H", ">11H", "11H", "11:00", "1100"] },
  { key: "H1230", label: "12:30", k: 4, candidates: ["->12H30", "->12:30", "12:30", "1230", "->12H"] },
  { key: "H1330", label: "13:30", k: 5, candidates: ["->13H30", "->13:30", "13:30", "1330", "->13H"] },
  { key: "H1430", label: "14:30", k: 6, candidates: ["->14H30", "->14:30", "14:30", "1430", "->14H"] },
  { key: "H1530", label: "15:30", k: 7, candidates: ["->15H30", "->15:30", "15:30", "1530", "->15H"] },
  { key: "H1630", label: "16:30", k: 8, candidates: ["->16H30", "AFTER 16H30", "16:30", "1630"] },
];

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || "";

    const sheetName = process.env.KPI_SHEET_NAME || "KPI";
    // ✅ bạn đang dùng A20:AZ37, giữ nguyên
    const range = `${sheetName}!A20:AZ37`;

    const values = await readRangeA1(range, {
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    if (!values || values.length === 0) {
      return NextResponse.json({ ok: true, date, range, lines: [], meta: {} });
    }

    // =============================
    // 1) TÌM HEADER (có thể 2 dòng)
    // =============================
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(values.length, 6); i++) {
      const s = values[i].map(norm).join("|");
      if (
        s.includes("CHUYEN") ||
        s.includes("DM/NGAY") ||
        s.includes("DMNGAY") ||
        s.includes("DM/H") ||
        s.includes("DMH") ||
        s.includes("AFTER16H30") ||
        s.includes("->9H")
      ) {
        headerRowIndex = i;
        break;
      }
    }

    const header1 = values[headerRowIndex] || [];
    const header2 = values[headerRowIndex + 1] || [];

    // nếu dòng dưới cũng có vẻ là sub-header thì merge 2 dòng
    const header2LooksLikeSub =
      header2.map(norm).join("|").includes("H") ||
      header2.map(norm).join("|").includes("9") ||
      header2.map(norm).join("|").includes("10");

    const headers = header2LooksLikeSub ? mergeHeaders(header1, header2) : header1;
    const dataStart = headerRowIndex + (header2LooksLikeSub ? 2 : 1);

    const rows = values
      .slice(dataStart)
      .filter((r) => r.some((x) => String(x ?? "").trim() !== ""));

    // =============================
    // 2) BẮT CỘT CHO 2 BẢNG
    // =============================
    const idxLine = findIdx(headers, ["CHUYEN", "CHUYỀN", "LINE"]);
    const idxMH = findIdx(headers, ["MH", "MÃ HÀNG", "MA HANG"]);
    const idxAfter = findIdx(headers, ["AFTER 16H30", "16H30", "AFTER16H30"]);
    const idxDMNgay = findIdx(headers, ["DM/NGAY", "ĐM/NGÀY", "DINH MUC NGAY", "DM NGAY", "DMNGAY"]);

    // ✅ DM/H: tuyệt đối KHÔNG dùng candidate "H" nữa (dễ match nhầm ->9H)
    const idxDMH = findIdx(headers, ["DM/H", "ĐM/H", "DINH MUC GIO", "DM GIO", "DMH"]);

    const idxTG = findIdx(headers, ["TG SX", "TGSX", "TG"]);

    // mốc giờ: tìm index theo header
    const hourCols = CHECKPOINTS.map((cp) => ({
      ...cp,
      idx: findIdx(headers, cp.candidates),
    }));

    // =============================
    // 3) BUILD LINES
    // =============================
    const lines = [];

    for (const r of rows) {
      const line = String(r[idxLine] ?? "").trim();
      if (!line) continue;

      const mh = idxMH >= 0 ? String(r[idxMH] ?? "").trim() : "";

      const hs_dat = idxAfter >= 0 ? toNumberSafe(r[idxAfter]) : 0;
      const hs_dm = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;

      const percent = hs_dm > 0 ? (hs_dat / hs_dm) * 100 : 0;
      const status = percent >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      // DM/H dùng cho bảng lũy tiến
      let dmH = idxDMH >= 0 ? toNumberSafe(r[idxDMH]) : 0;

      // fallback: dmH = dmNgay / TG_SX (thường 😎
      if (dmH <= 0) {
        const dmNgayTmp = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;
        const tg = idxTG >= 0 ? toNumberSafe(r[idxTG]) : 0;
        if (dmNgayTmp > 0 && tg > 0) dmH = dmNgayTmp / tg;
      }

      const hours = hourCols
        .filter((c) => c.idx >= 0)
        .map((c) => {
          const actual = toNumberSafe(r[c.idx]);
          const target = dmH > 0 ? dmH * c.k : 0;

          let ok = false;
          let level = "NO_TARGET"; // ĐỦ / VƯỢT / THIẾU
          if (target > 0) {
            if (actual === target) { ok = true; level = "ĐỦ"; }
            else if (actual > target) { ok = true; level = "VƯỢT"; }
            else { ok = false; level = "THIẾU"; }
          }

          return {
            key: c.key,
            label: c.label,
            k: c.k,
            actual,
            target: Number(target.toFixed(2)),
            ok,
            level,
          };
        });

      lines.push({
        line,
        mh,
        hs_dat,
        hs_dm,
        percent: Number(percent.toFixed(2)),
        status,
        dmH: Number(dmH.toFixed(2)),
        hours,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,
      meta: {
        headers,
        idxLine,
        idxMH,
        idxAfter,
        idxDMNgay,
        idxDMH,
        idxTG,
        hourCols,
      },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "CHECK_KPI_ERROR",
      message: String(e?.message || e),
    });
  }
}