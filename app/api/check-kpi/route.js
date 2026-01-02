// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { getValues } from "../_lib/googleSheetsClient";

// ✅ tắt cache Next/Vercel để đổi số liệu trên Sheet là API lấy mới
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXCLUDE_LINES = new Set([
  "CẮT", "CAT",
  "HOÀN TẤT", "HOAN TAT",
  "KCS",
  "NM",
]);

/* =================== helpers =================== */
const s = (v) => (v === null || v === undefined ? "" : String(v));
const trim = (v) => s(v).replace(/\u00A0/g, " ").trim();

const noMark = (str) =>
  s(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const t = trim(v);
  if (!t) return 0;

  // bỏ dấu % và dấu ,
  const cleaned = t.replace(/%/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normLineName(raw) {
  const t = trim(raw).toUpperCase();
  if (!t) return "";
  if (t === "TONG HOP") return "TỔNG HỢP";
  if (t === "TỔNG HỢP") return "TỔNG HỢP";
  // C01 -> C1
  const m = t.match(/^C\s*0*([0-9]+)$/);
  if (m) return `C${Number(m[1])}`;
  return t;
}

function isLineLabel(x) {
  const t = normLineName(x);
  if (!t) return false;
  if (t === "TỔNG HỢP") return true;
  if (/^C[0-9]+$/.test(t)) return true;
  return false;
}

function isExcludedLine(lineName) {
  const t = normLineName(lineName);
  return EXCLUDE_LINES.has(t);
}

// sort: TỔNG HỢP trước, rồi C1..C10..Cn, rồi cái khác
function sortLines(a, b) {
  const A = normLineName(a);
  const B = normLineName(b);
  if (A === "TỔNG HỢP" && B !== "TỔNG HỢP") return -1;
  if (B === "TỔNG HỢP" && A !== "TỔNG HỢP") return 1;

  const ma = A.match(/^C(\d+)$/);
  const mb = B.match(/^C(\d+)$/);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  if (ma && !mb) return -1;
  if (!ma && mb) return 1;
  return A.localeCompare(B, "vi");
}

function parseDateQuery(dateStr) {
  // expect dd/MM/yyyy
  const t = trim(dateStr);
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return { dd: m[1], mm: m[2], yyyy: m[3], ddmm: `${m[1]}/${m[2]}`, full: t };
}

function cellLooksLikeDate(v) {
  const t = trim(v);
  // dd/MM or dd/MM/yyyy
  return /^\d{2}\/\d{2}(\/\d{4})?$/.test(t);
}

/** chuẩn hoá date cell về dd/MM/yyyy (nếu thiếu năm thì lấy năm từ query) */
function normalizeDateCell(v, qYear) {
  const t = trim(v);
  if (!cellLooksLikeDate(t)) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  if (/^\d{2}\/\d{2}$/.test(t)) return qYear ? `${t}/${qYear}` : t;
  return "";
}

function parseHourFactor(label) {
  // label kiểu "->9h", "->10h", "->12h30", ...
  const t = noMark(label).replace(/\s+/g, "");
  const m = t.match(/->(\d{1,2})h(?:(\d{2}))?/);
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  // theo bảng của bạn: ->9h = 1, ->10h = 2 ...
  // tức là factor = (hh + mm/60) - 8
  const factor = (hh + mm / 60) - 8;
  return factor > 0 ? factor : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round0(n) {
  return Math.round(n);
}

/* =================== tìm block / parse =================== */

function findFirstCell(grid, predicate) {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (predicate(row[c], r, c)) return { r, c, v: row[c] };
    }
  }
  return null;
}

function findInRow(grid, r, predicate, cFrom = 0, cTo = null) {
  const row = grid[r] || [];
  const end = cTo ?? row.length - 1;
  for (let c = cFrom; c <= end; c++) {
    if (predicate(row[c], r, c)) return { r, c, v: row[c] };
  }
  return null;
}

function pickLineFromRow(row) {
  // tìm label chuyền trong vài cột đầu (hoặc cả hàng nếu cần)
  for (let i = 0; i < Math.min(row.length, 12); i++) {
    if (isLineLabel(row[i])) return normLineName(row[i]);
  }
  // fallback: scan cả row
  for (let i = 0; i < row.length; i++) {
    if (isLineLabel(row[i])) return normLineName(row[i]);
  }
  return "";
}

/* =================== MAIN =================== */

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date") || "";     // dd/MM/yyyy
    const lineParam = searchParams.get("line") || "";     // C1..C10 hoặc TỔNG HỢP

    const q = parseDateQuery(dateParam);
    if (!q) {
      return NextResponse.json(
        { ok: false, error: 'Query "date" phải dạng dd/MM/yyyy (vd 24/12/2025).' },
        { status: 400 }
      );
    }

    // đọc sheet KPI (bạn đổi range nếu sheet dài)
    const grid = await getValues("KPI!A1:ZZ2000");

    // ===== 1) collect available dates (để UI hiển thị) =====
    const dateSet = new Set();
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const norm = normalizeDateCell(row[c], q.yyyy);
        if (norm && /^\d{2}\/\d{2}\/\d{4}$/.test(norm)) dateSet.add(norm);
      }
    }
    const availableDates = Array.from(dateSet).sort(); // UI muốn 1 ngày thì vẫn OK

    // ===== 2) parse DAILY efficiency block (HS đạt vs HS ĐM) =====
    // tìm header có "SUẤT ĐẠT TRONG" và "ĐỊNH MỨC TRONG"
    const dailyHeader = findFirstCell(grid, (v) => {
      const t = noMark(v);
      return t.includes("suat dat trong");
    });

    let dailyRows = [];
    let dailyDebug = {};

    if (dailyHeader) {
      const headerRow = dailyHeader.r;

      // tìm cột "ĐỊNH MỨC TRONG"
      const dmCell = findInRow(grid, headerRow, (v) => noMark(v).includes("dinh muc trong"));

      const hsDatCol = dailyHeader.c;
      const hsDmCol = dmCell ? dmCell.c : hsDatCol + 1;

      // các chuyền thường nằm ở cột bên trái (1-3 cột trước)
      const lineColGuess = Math.max(0, hsDatCol - 2);

      for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const line = pickLineFromRow(row);
        if (!line) {
          // gặp 1 đoạn trống dài thì break
          if (r > headerRow + 20) break;
          continue;
        }
        if (isExcludedLine(line)) continue;

        // hs đạt / hs dm có thể là 0.76 hoặc 76.00
        let hsDat = toNumberSafe(row[hsDatCol]);
        let hsDm = toNumberSafe(row[hsDmCol]);

        if (hsDat > 0 && hsDat <= 1) hsDat *= 100;
        if (hsDm > 0 && hsDm <= 1) hsDm *= 100;

        hsDat = round2(hsDat);
        hsDm = round2(hsDm);

        const status = hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";

        dailyRows.push({ line, hsDat, hsDm, status });

        // dừng nếu đã qua block (thấy tiêu đề khác)
        if (dailyRows.length > 0 && dailyRows.length > 60) break;
      }

      // sort đúng C1..C10
      dailyRows.sort((a, b) => sortLines(a.line, b.line));

      dailyDebug = { headerRow, hsDatCol, hsDmCol, found: dailyRows.length };
    } else {
      dailyDebug = { found: 0, note: "Không tìm thấy header 'SUẤT ĐẠT TRONG' trong sheet KPI." };
    }

    // ===== 3) parse HOURLY cumulative block =====
    // tìm anchor: "THỐNG KÊ HIỆU SUẤT THEO GIỜ"
    const hourlyAnchor = findFirstCell(grid, (v) => {
      const t = noMark(v);
      return t.includes("thong ke hieu suat theo gio");
    });

    let hourly = { line: "", dmH: 0, hours: [] };
    let hourlyDebug = {};

    if (hourlyAnchor) {
      // tìm row chứa header "DM/H" gần anchor (anchorRow..anchorRow+8)
      let dmHPos = null;
      for (let rr = hourlyAnchor.r; rr <= hourlyAnchor.r + 10 && rr < grid.length; rr++) {
        const found = findInRow(grid, rr, (v) => {
          const t = noMark(v).replace(/\s+/g, "");
          return t === "dm/h" || t.includes("dm/h");
        });
        if (found) {
          dmHPos = found;
          break;
        }
      }

      if (dmHPos) {
        const headerRow = dmHPos.r;
        const dmHCol = dmHPos.c;

        // xác định cột DM/NGÀY (nếu cần)
        const dmDayPos = findInRow(grid, headerRow, (v) => {
          const t = noMark(v).replace(/\s+/g, "");
          return t.includes("dm/ngay");
        });
        const dmDayCol = dmDayPos ? dmDayPos.c : null;

        // time headers: từ dmHCol+1 sang phải cho tới khi hết kiểu ->9h
        const timeCols = [];
        const header = grid[headerRow] || [];
        for (let c = dmHCol + 1; c < header.length; c++) {
          const factor = parseHourFactor(header[c]);
          if (factor === null) {
            // nếu đã có timeCols rồi mà gặp trống nhiều -> break
            if (timeCols.length > 0 && !trim(header[c])) break;
            continue;
          }
          timeCols.push({ c, label: trim(header[c]), factor });
        }

        // lấy danh sách chuyền + data theo hàng
        const rowsByLine = new Map();
        for (let r = headerRow + 1; r < grid.length; r++) {
          const row = grid[r] || [];
          const line = pickLineFromRow(row);
          if (!line) {
            if (r > headerRow + 60) break;
            continue;
          }
          if (isExcludedLine(line)) continue;

          const dmH = toNumberSafe(row[dmHCol]);
          const dmDay = dmDayCol !== null ? toNumberSafe(row[dmDayCol]) : 0;

          const hours = timeCols.map((tc) => {
            const total = toNumberSafe(row[tc.c]);
            const dmLuyTien = dmH * tc.factor;
            const delta = total - dmLuyTien;
            const status = delta >= 0 ? "VƯỢT" : "THIẾU";
            return {
              label: tc.label,
              factor: tc.factor,
              total: round2(total),
              dmLuyTien: round2(dmLuyTien),
              delta: round2(delta),
              status,
            };
          });

          rowsByLine.set(line, { line, dmH, dmDay, hours });
        }

        // list line cho dropdown
        const lines = Array.from(rowsByLine.keys()).sort(sortLines);

        // chọn line
        const selectedLine = normLineName(lineParam) || "TỔNG HỢP";
        const picked =
          rowsByLine.get(selectedLine) ||
          rowsByLine.get("TỔNG HỢP") ||
          rowsByLine.get(lines[0]) ||
          null;

        hourly = picked
          ? { line: picked.line, dmH: round2(picked.dmH), dmDay: round2(picked.dmDay), hours: picked.hours }
          : { line: selectedLine, dmH: 0, dmDay: 0, hours: [] };

        hourlyDebug = {
          anchorRow: hourlyAnchor.r,
          headerRow,
          dmHCol,
          dmDayCol,
          timeCols: timeCols.length,
          linesFound: lines.length,
        };

        // ===== 4) build response =====
        const resp = NextResponse.json(
          {
            ok: true,
            chosenDate: q.full,
            // UI muốn chỉ hiện 1 ngày: frontend cứ lấy chosenDate hiển thị,
            // nhưng mình vẫn trả availableDates để bạn debug / dùng dropdown.
            availableDates,
            lines: lines,
            selectedLine: hourly.line,
            dailyRows,
            hourly,
            _debug: { daily: dailyDebug, hourly: hourlyDebug },
          },
          { status: 200 }
        );

        // ✅ no-store để sheet đổi là lấy mới
        resp.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        resp.headers.set("Pragma", "no-cache");
        resp.headers.set("Expires", "0");
        return resp;
      }

      hourlyDebug = { note: "Có anchor theo giờ nhưng không tìm thấy cột header 'DM/H'." };
    } else {
      hourlyDebug = { note: "Không tìm thấy anchor 'THỐNG KÊ HIỆU SUẤT THEO GIỜ'." };
    }

    // fallback nếu không parse được hourly
    const resp = NextResponse.json(
      {
        ok: true,
        chosenDate: q.full,
        availableDates,
        lines: [],
        selectedLine: normLineName(lineParam) || "TỔNG HỢP",
        dailyRows,
        hourly: { line: normLineName(lineParam) || "TỔNG HỢP", dmH: 0, dmDay: 0, hours: [] },
        _debug: { daily: dailyDebug, hourly: hourlyDebug },
      },
      { status: 200 }
    );
    resp.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    resp.headers.set("Pragma", "no-cache");
    resp.headers.set("Expires", "0");
    return resp;
  } catch (e) {
    const resp = NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
    resp.headers.set("Cache-Control", "no-store");
    return resp;
  }
}