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
  const t = trimAll(v);
  if (!t) return 0;
  if (t.includes("%")) return toNumber(t);
  const n = toNumber(t);
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

function ddmmFromAnyDateStr(x) {
  const t = trimAll(x);
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[1]}/${m[2]}`;
  m = t.match(/^(\d{2})\/(\d{2})$/);
  if (m) return `${m[1]}/${m[2]}`;
  return "";
}

function isLineToken(x) {
  const t = norm(x);
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
  const m = t.match(/(\d{1,2})\s*H\s*(\d{2})?/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const hour = hh + mm / 60;

  // quy ước: ->9h = 1 (tính từ 8h)
  const factor = hour - 8;
  return Number.isFinite(factor) ? factor : null;
}

// ===== tìm dòng có các cột giờ (->9h, ->10h, ...) =====
function findHourRow(values, startRow, endRow) {
  for (let r = startRow; r < endRow; r++) {
    const row = values[r] || [];
    const rowN = row.map(norm);

    // điều kiện: có ít nhất 2 mốc giờ để chắc chắn
    const has9 = rowN.some((c) => c.includes("->9H") || c.includes("→9H"));
    const has10 = rowN.some((c) => c.includes("->10H") || c.includes("→10H"));
    const has11 = rowN.some((c) => c.includes("->11H") || c.includes("→11H"));
    if ((has9 && has10) || (has9 && has11) || (has10 && has11)) return r;
  }
  return -1;
}

// ===== tìm cột trong “cửa sổ” quanh hourRow (do merge header) =====
function findColInWindow(values, hourRowIdx, needleFn, before = 4, after = 4) {
  const r0 = Math.max(0, hourRowIdx - before);
  const r1 = Math.min(values.length - 1, hourRowIdx + after);

  for (let r = r0; r <= r1; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cellN = norm(row[c]);
      if (cellN && needleFn(cellN)) return c;
    }
  }
  return -1;
}

// ===== tìm anchor theo ngày rồi tìm hourRow nằm dưới =====
function findHourRowByDate(values, queryDate) {
  const q = trimAll(queryDate);
  const qDDMM = ddmmFromAnyDateStr(q);

  const anchors = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = trimAll(row[c]);
      if (!cell) continue;

      const cellDDMM = ddmmFromAnyDateStr(cell);
      if (cell === q || (qDDMM && cellDDMM === qDDMM)) {
        anchors.push(r);
        break;
      }
    }
  }

  // ưu tiên tìm hourRow ngay sau anchor ngày
  for (const a of anchors) {
    const hr = findHourRow(values, a, Math.min(values.length, a + 250));
    if (hr !== -1) return hr;
  }

  // fallback: tìm toàn sheet
  return findHourRow(values, 0, values.length);
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const date = trimAll(searchParams.get("date") || "");
    const selectedLineRaw = trimAll(searchParams.get("line") || "TỔNG HỢP");
    const debug = trimAll(searchParams.get("debug") || "") === "1";

    if (!date) {
      return NextResponse.json({
        ok: false,
        error: "Missing query param: date=dd/MM/yyyy (hoặc dd/MM)",
      });
    }

    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID ||
      process.env.GOOGLE_SHEETID ||
      process.env.SPREADSHEET_ID ||
      "";

    if (!spreadsheetId) {
      return NextResponse.json({
        ok: false,
        error: "Missing env GOOGLE_SHEET_ID (hoặc SPREADSHEET_ID)",
      });
    }

    const SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";
    const RANGE = `${SHEET_NAME}!A1:AZ5000`; // tăng lên để chắc chắn có ngày 23/12

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

    // 1) tìm “dòng giờ” theo date (ổn định nhất)
    const hourRowIdx = findHourRowByDate(values, date);
    if (hourRowIdx === -1) {
      return NextResponse.json({
        ok: false,
        error: "Không tìm thấy dòng header có các cột giờ (->9h, ->10h, ...).",
        ...(debug ? { _debug: { date, hint: "Kiểm tra sheet có dòng ->9h, ->10h; hoặc tăng RANGE." } } : {}),
      });
    }

    const hourHeaderRow = values[hourRowIdx] || [];

    // 2) lấy các cột giờ từ hourHeaderRow
    const hourCols = [];
    for (let i = 0; i < hourHeaderRow.length; i++) {
      const hn = norm(hourHeaderRow[i]);
      if ((hn.includes("->") || hn.includes("→")) && hn.includes("H")) {
        const label = trimAll(hourHeaderRow[i]);
        const factor = parseHourFactor(label);
        if (factor !== null) hourCols.push({ idx: i, label, factor });
      }
    }
    if (!hourCols.length) {
      return NextResponse.json({
        ok: false,
        error: "Tìm thấy hourRow nhưng không parse được cột giờ (->9h...).",
        ...(debug ? { _debug: { hourRowIdx, hourHeaderRow } } : {}),
      });
    }

    // 3) do header merge, tìm DM/H + SUẤT ĐẠT + ĐỊNH MỨC quanh hourRow (quét +/- 4 dòng)
    const colDmH = findColInWindow(values, hourRowIdx, (x) => x === "DM/H" || x.includes("DM/H"));
    const colSuatDat = findColInWindow(values, hourRowIdx, (x) => x.includes("SUAT DAT TRONG NGAY"));
    const colDinhMuc = findColInWindow(values, hourRowIdx, (x) => x.includes("DINH MUC TRONG NGAY"));

    if (colDmH === -1) {
      return NextResponse.json({
        ok: false,
        error: "Không tìm thấy cột DM/H quanh dòng giờ (do merge/đổi tên).",
        ...(debug ? { _debug: { hourRowIdx, sampleRows: values.slice(Math.max(0, hourRowIdx - 4), hourRowIdx + 5) } } : {}),
      });
    }
    if (colSuatDat === -1 || colDinhMuc === -1) {
      return NextResponse.json({
        ok: false,
        error: "Không tìm thấy cột 'SUẤT ĐẠT TRONG NGÀY' hoặc 'ĐỊNH MỨC TRONG NGÀY' quanh dòng giờ (do merge/đổi tên).",
        ...(debug ? { _debug: { hourRowIdx, colSuatDat, colDinhMuc } } : {}),
      });
    }

    // 4) parse dữ liệu: bắt đầu từ sau hourRowIdx
    const lineMap = new Map();

    // đoán cột chứa C1..Cn: ưu tiên vùng 0..(colDmH-1)
    let lineColGuess = -1;

    for (let r = hourRowIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      if (!row.length) continue;

      // guess line col
      if (lineColGuess === -1) {
        for (let c = 0; c < Math.min(row.length, Math.max(1, colDmH)); c++) {
          if (isLineToken(row[c])) {
            lineColGuess = c;
            break;
          }
        }
        if (lineColGuess === -1) lineColGuess = 0;
      }

      const rawLine = row[lineColGuess];

      // nếu đã parse được rồi mà gặp dòng không phải line => dừng (qua block khác)
      if (!isLineToken(rawLine)) {
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

    // dailyRows
    const dailyRows = linesOnly.map((ln) => {
      const it = lineMap.get(ln);
      const status = it.hsDat >= it.hsDm ? "ĐẠT" : "CHƯA ĐẠT";
      return { line: ln, hsDat: it.hsDat, hsDm: it.hsDm, status };
    });

    // hourly (theo line / tổng hợp)
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
      hourly: { line: selectedLine, dmH: dmHSelected, hours: hourlyHours },
      ...(debug
        ? {
            _debug: {
              hourRowIdx,
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