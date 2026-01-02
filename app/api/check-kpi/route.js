// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import getSheetsClient from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== helpers =====
const s = (v) => (v === null || v === undefined ? "" : String(v));
const trimAll = (str) => s(str).replace(/\u00A0/g, " ").trim();

function noMark(str) {
  return trimAll(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (m) => (m === "đ" ? "d" : "D"));
}
function norm(str) {
  return noMark(str).toUpperCase().replace(/\s+/g, " ").trim();
}

// number/percent
function toNumber(v) {
  const t = trimAll(v);
  if (!t) return 0;
  const cleaned = t
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/[^\d.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function toPercent(v) {
  // nếu "95.87%" -> 95.87
  // nếu 0.9587 -> 95.87
  const t = trimAll(v);
  if (!t) return 0;

  if (t.includes("%")) return toNumber(t);

  const n = toNumber(t);
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

function ddmmFromAnyDateStr(x) {
  const t = trimAll(x);
  // dd/MM/yyyy hoặc dd/MM
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[1]}/${m[2]}`;
  m = t.match(/^(\d{2})\/(\d{2})$/);
  if (m) return `${m[1]}/${m[2]}`;
  return "";
}

function isLineToken(x) {
  const t = norm(x);
  // C1..C99 hoặc LINE 1..
  return /^C\s*\d{1,2}$/.test(t) || /^LINE\s*\d{1,2}$/.test(t);
}
function normalizeLine(x) {
  const t = norm(x);
  let m = t.match(/^C\s*0*(\d{1,2})$/);
  if (m) return `C${Number(m[1])}`;
  m = t.match(/^LINE\s*0*(\d{1,2})$/);
  if (m) return `C${Number(m[1])}`;
  return trimAll(x);
}

// parse mốc giờ: ->9h, ->12h30 ...
function parseHourFactor(label) {
  const t = norm(label);
  // tìm số giờ và phút: 12H30, 9H, ...
  const m = t.match(/(\d{1,2})\s*H\s*(\d{2})?/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const hour = hh + mm / 60;

  // theo quy ước của bạn: ->9h = 1 => mốc bắt đầu 8h
  const factor = hour - 8;
  return Number.isFinite(factor) ? factor : null;
}

// tìm header của bảng "THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY"
function findStatsHeaderRow(values, startRow = 0, endRow = values.length) {
  for (let r = startRow; r < endRow; r++) {
    const row = values[r] || [];
    const rowNorm = row.map(norm);

    const hasDmH = rowNorm.some((c) => c === "DM/H" || c.includes("DM/H"));
    const hasArrow9 =
      rowNorm.some((c) => c.includes("->9H") || c.includes("→9H"));
    const hasSuatDat = rowNorm.some((c) => c.includes("SUAT DAT TRONG NGAY"));
    const hasDinhMuc = rowNorm.some((c) => c.includes("DINH MUC TRONG NGAY"));

    // đủ điều kiện: có DM/H + có ->9h + (ít nhất có 1 trong 2 cột hiệu suất)
    if (hasDmH && hasArrow9 && (hasSuatDat || hasDinhMuc)) {
      return r;
    }
  }
  return -1;
}

// tìm block theo ngày: tìm dòng có "23/12" hoặc "23/12/2025" rồi tìm header dưới nó
function findHeaderRowByDate(values, queryDate) {
  const q = trimAll(queryDate);
  const qDDMM = ddmmFromAnyDateStr(q);

  const candidates = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = trimAll(row[c]);
      if (!cell) continue;

      const cellDDMM = ddmmFromAnyDateStr(cell);

      if (cell === q || (qDDMM && cellDDMM === qDDMM)) {
        candidates.push(r);
        break;
      }
    }
  }

  // ưu tiên header nằm ngay sau ngày
  for (const anchor of candidates) {
    const hdr = findStatsHeaderRow(values, anchor, Math.min(values.length, anchor + 200));
    if (hdr !== -1) return hdr;
  }

  // fallback: tìm toàn sheet
  return findStatsHeaderRow(values, 0, values.length);
}

// ===== main =====
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const date = trimAll(searchParams.get("date") || ""); // dd/MM/yyyy hoặc dd/MM
    const selectedLineRaw = trimAll(searchParams.get("line") || "TỔNG HỢP");
    const debug = trimAll(searchParams.get("debug") || "") === "1";

    if (!date) {
      return NextResponse.json({ ok: false, error: "Missing query param: date=dd/MM/yyyy" });
    }

    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID ||
      process.env.GOOGLE_SHEETID ||
      process.env.SPREADSHEET_ID ||
      "";

    if (!spreadsheetId) {
      return NextResponse.json({ ok: false, error: "Missing env GOOGLE_SHEET_ID (hoặc SPREADSHEET_ID)" });
    }

    const SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";
    const RANGE = `${SHEET_NAME}!A1:AZ2000`; // phải đủ lớn để bắt ngày 23 nằm phía dưới

    const client = await getSheetsClient();

    const resp = await client.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = resp?.data?.values || [];
    if (!values.length) {
      return NextResponse.json({ ok: false, error: "Sheet empty / cannot read values" });
    }

    // 1) tìm header của bảng giờ+ngày theo date
    const headerRowIdx = findHeaderRowByDate(values, date);
    if (headerRowIdx === -1) {
      return NextResponse.json({
        ok: false,
        error: "Không tìm thấy header bảng 'THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY' (có DM/H + ->9h + cột SUẤT ĐẠT/ĐỊNH MỨC).",
        ...(debug ? { _debug: { date, hint: "Tăng range AZ2000 và đảm bảo header có chữ DM/H và ->9h" } } : {}),
      });
    }

    const header = values[headerRowIdx] || [];
    const headerNorm = header.map(norm);

    // 2) xác định cột
    const colDmH = headerNorm.findIndex((x) => x === "DM/H" || x.includes("DM/H"));

    const colSuatDat = headerNorm.findIndex((x) => x.includes("SUAT DAT TRONG NGAY"));
    const colDinhMuc = headerNorm.findIndex((x) => x.includes("DINH MUC TRONG NGAY"));

    // cột giờ: tất cả cột có "->" hoặc "→" và có H
    const hourCols = [];
    for (let i = 0; i < header.length; i++) {
      const hn = headerNorm[i];
      if ((hn.includes("->") || hn.includes("→")) && hn.includes("H")) {
        const label = trimAll(header[i]);
        const factor = parseHourFactor(label);
        if (factor !== null) {
          hourCols.push({ idx: i, label, factor });
        }
      }
    }

    if (colDmH === -1) {
      return NextResponse.json({
        ok: false,
        error: "Không tìm thấy cột DM/H (do merge/đổi tên).",
        ...(debug ? { _debug: { headerRowIdx, header } } : {}),
      });
    }
    if (!hourCols.length) {
      return NextResponse.json({
        ok: false,
        error: "Không tìm thấy các cột giờ kiểu ->9h, ->10h, ->12h30... (có thể header đang merge).",
        ...(debug ? { _debug: { headerRowIdx, header } } : {}),
      });
    }
    if (colSuatDat === -1 || colDinhMuc === -1) {
      return NextResponse.json({
        ok: false,
        error: "Không thấy cột 'SUẤT ĐẠT TRONG NGÀY' hoặc 'ĐỊNH MỨC TRONG NGÀY' (header có thể merge/đổi tên).",
        ...(debug ? { _debug: { headerRowIdx, header } } : {}),
      });
    }

    // 3) đọc các dòng dữ liệu sau header
    const lineMap = new Map();

    let lineColGuess = -1; // tìm cột chứa C1, C2...
    for (let r = headerRowIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      if (!row.length) continue;

      // đoán cột line: tìm cell đầu tiên khớp C1/C2...
      if (lineColGuess === -1) {
        for (let c = 0; c < Math.min(row.length, colDmH); c++) {
          if (isLineToken(row[c])) {
            lineColGuess = c;
            break;
          }
        }
        // nếu vẫn không thấy, thử ngay trước DM/H
        if (lineColGuess === -1 && colDmH > 0 && isLineToken(row[colDmH - 1])) {
          lineColGuess = colDmH - 1;
        }
        // nếu không có line trong vùng trước DM/H thì mặc định col 0
        if (lineColGuess === -1) lineColGuess = 0;
      }

      const rawLine = row[lineColGuess];
      if (!isLineToken(rawLine)) {
        // nếu đã bắt đầu có dữ liệu mà gặp dòng không phải line -> dừng (qua phần khác)
        if (lineMap.size > 0) break;
        continue;
      }

      const line = normalizeLine(rawLine);
      const dmH = toNumber(row[colDmH]);
      const hsDat = toPercent(row[colSuatDat]);
      const hsDm = toPercent(row[colDinhMuc]);

      const hours = hourCols.map((hc) => ({
        label: hc.label,
        factor: hc.factor,
        total: toNumber(row[hc.idx]),
      }));

      lineMap.set(line, { line, dmH, hsDat, hsDm, hours });
    }

    const linesOnly = Array.from(lineMap.keys());
    const lines = ["TỔNG HỢP", ...linesOnly];

    // 4) dailyRows (luôn trả full tất cả chuyền)
    const dailyRows = linesOnly.map((ln) => {
      const it = lineMap.get(ln);
      const status = it.hsDat >= it.hsDm ? "ĐẠT" : "CHƯA ĐẠT";
      return { line: ln, hsDat: it.hsDat, hsDm: it.hsDm, status };
    });

    // 5) hourly theo line (hoặc tổng hợp)
    const reqLine = selectedLineRaw.toUpperCase();
    const selectedLine =
      reqLine === "TỔNG HỢP" ? "TỔNG HỢP" : (linesOnly.includes(reqLine) ? reqLine : "TỔNG HỢP");

    const hourLabels = hourCols.map((hc) => ({ label: hc.label, factor: hc.factor }));

    let dmHSelected = 0;
    let totalsByHour = hourLabels.map(() => 0);

    if (selectedLine === "TỔNG HỢP") {
      for (const ln of linesOnly) {
        const it = lineMap.get(ln);
        dmHSelected += it.dmH;
        it.hours.forEach((h, i) => (totalsByHour[i] += h.total));
      }
    } else {
      const it = lineMap.get(selectedLine);
      dmHSelected = it?.dmH || 0;
      totalsByHour = it?.hours?.map((h) => h.total) || totalsByHour;
    }

    const hourlyHours = hourLabels.map((hl, i) => {
      const total = totalsByHour[i] || 0;
      const dmTarget = dmHSelected * hl.factor;
      const diff = total - dmTarget;
      const status = diff >= 0 ? "VƯỢT" : "THIẾU";
      return { label: hl.label, total, dmTarget, diff, status };
    });

    return NextResponse.json({
      ok: true,
      chosenDate: date,
      lines,
      selectedLine,
      dailyRows,
      hourly: {
        line: selectedLine,
        dmH: dmHSelected,
        hours: hourlyHours,
      },
      ...(debug
        ? {
            _debug: {
              headerRowIdx,
              colDmH,
              colSuatDat,
              colDinhMuc,
              hourCols,
              parsedLines: linesOnly,
              lineColGuess,
            },
          }
        : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" });
  }
}