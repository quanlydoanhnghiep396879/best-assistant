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
  const cleaned = t.replace(/,/g, "").replace(/[^\d.\-]/g, "");
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
  const t = norm(label).replace("→", "->");
  const m = t.match(/(\d{1,2})\s*H\s*(\d{2})?/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const hour = hh + mm / 60;

  // ->9h = 1 (tính từ 8h)
  const factor = hour - 8;
  return Number.isFinite(factor) ? factor : null;
}

function findHourRow(values, startRow, endRow) {
  for (let r = startRow; r < endRow; r++) {
    const row = values[r] || [];
    const rowN = row.map(norm);

    const has9 = rowN.some((c) => c.includes("->9H") || c.includes("→9H"));
    const has10 = rowN.some((c) => c.includes("->10H") || c.includes("→10H"));
    const has11 = rowN.some((c) => c.includes("->11H") || c.includes("→11H"));

    if ((has9 && has10) || (has9 && has11) || (has10 && has11)) return r;
  }
  return -1;
}

function findColInWindow(values, hourRowIdx, needleFn, before = 5, after = 5) {
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

// lấy một số dòng data (có C1..Cn) để test cột nào “đúng số”
function collectDataRows(values, hourRowIdx, max = 25) {
  const out = [];
  for (let r = hourRowIdx + 1; r < values.length && out.length < max; r++) {
    const row = values[r] || [];
    if (!row.length) continue;

    // tìm line token ở vài cột đầu để biết row data
    const hit = row.slice(0, 5).some((x) => isLineToken(x));
    if (!hit) {
      if (out.length > 0) break;
      continue;
    }
    out.push(row);
  }
  return out;
}

// calibrate cột: nếu header bị lệch do merge, chọn cột có “nhiều số hợp lý” nhất
function calibrateNumericCol(baseIdx, dataRows, scorer) {
  const candidates = [baseIdx, baseIdx + 1, baseIdx - 1, baseIdx + 2, baseIdx - 2]
    .filter((x) => x >= 0);

  let best = baseIdx;
  let bestScore = -1;

  for (const idx of candidates) {
    let score = 0;
    for (const row of dataRows) {
      const val = row[idx];
      score += scorer(val);
    }
    if (score > bestScore || (score === bestScore && Math.abs(idx - baseIdx) < Math.abs(best - baseIdx))) {
      bestScore = score;
      best = idx;
    }
  }
  return best;
}

function scoreDmH(v) {
  const n = toNumber(v);
  // DM/H thường > 0 và không quá lớn
  if (n > 0 && n < 1000) return 2;
  return 0;
}
function scorePercent(v) {
  const p = toPercent(v);
  if (p > 0 && p <= 200) return 2;
  return 0;
}

// tìm block theo ngày: ưu tiên cột A (vì sheet bạn để ngày ở cột A)
function findHourRowByDate(values, queryDate) {
  const q = trimAll(queryDate);
  const qDDMM = ddmmFromAnyDateStr(q);

  const anchors = [];

  // ưu tiên tìm ở cột A trước
  for (let r = 0; r < values.length; r++) {
    const cell = trimAll(values[r]?.[0]);
    if (!cell) continue;
    const cellDDMM = ddmmFromAnyDateStr(cell);
    if (cell === q || (qDDMM && cellDDMM === qDDMM)) anchors.push(r);
  }

  // nếu cột A không thấy, tìm toàn sheet
  if (!anchors.length) {
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
  }

  // ✅ QUAN TRỌNG: nếu không tìm thấy ngày -> TRẢ LỖI, KHÔNG fallback về ngày 24 nữa
  if (!anchors.length) return { hourRowIdx: -1, reason: `Không tìm thấy ngày ${q} trong sheet` };

  // thử từng anchor: chọn cái nào parse ra được nhiều data nhất
  let best = { hourRowIdx: -1, parsedCount: -1, anchor: anchors[0] };

  for (const a of anchors) {
    const hr = findHourRow(values, a, Math.min(values.length, a + 300));
    if (hr === -1) continue;

    // đếm nhanh số dòng data sau hr
    const dataRows = collectDataRows(values, hr, 20);
    const count = dataRows.length;

    if (count > best.parsedCount) {
      best = { hourRowIdx: hr, parsedCount: count, anchor: a };
    }
  }

  if (best.hourRowIdx === -1) {
    return { hourRowIdx: -1, reason: `Tìm thấy ngày ${q} nhưng không tìm thấy dòng ->9h ->10h phía dưới` };
  }

  return best;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const date = trimAll(searchParams.get("date") || "");
    const selectedLineRaw = trimAll(searchParams.get("line") || "TỔNG HỢP");
    const debug = trimAll(searchParams.get("debug") || "") === "1";

    if (!date) {
      return NextResponse.json(
        { ok: false, error: "Missing query param: date=dd/MM/yyyy (hoặc dd/MM)" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID ||
      process.env.SPREADSHEET_ID ||
      "";

    if (!spreadsheetId) {
      return NextResponse.json(
        { ok: false, error: "Missing env GOOGLE_SHEET_ID" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";
    const RANGE = `${SHEET_NAME}!A1:AZ8000`; // tăng để chắc chắn có nhiều ngày

    const client = await getSheetsClient();
    const resp = await client.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = resp?.data?.values || [];
    if (!values.length) {
      return NextResponse.json(
        { ok: false, error: "Sheet empty / cannot read values" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 1) tìm dòng giờ theo ngày (KHÔNG fallback nữa)
    const found = findHourRowByDate(values, date);
    const hourRowIdx = found.hourRowIdx;

    if (hourRowIdx === -1) {
      return NextResponse.json(
        { ok: false, error: found.reason || "Không tìm thấy block theo ngày" },
        { headers: { "Cache-Control": "no-store" } }
      );
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
      return NextResponse.json(
        { ok: false, error: "Tìm thấy hourRow nhưng không parse được cột giờ (->9h...)" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 3) tìm cột theo header quanh hourRow (chịu merge)
    let colDmH = findColInWindow(values, hourRowIdx, (x) => x === "DM/H" || x.includes("DM/H"));
    let colSuatDat = findColInWindow(values, hourRowIdx, (x) => x.includes("SUAT DAT TRONG NGAY"));
    let colDinhMuc = findColInWindow(values, hourRowIdx, (x) => x.includes("DINH MUC TRONG NGAY"));

    if (colDmH === -1) {
      return NextResponse.json(
        { ok: false, error: "Không tìm thấy cột DM/H quanh dòng giờ (do merge/đổi tên)." },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    if (colSuatDat === -1 || colDinhMuc === -1) {
      return NextResponse.json(
        { ok: false, error: "Không tìm thấy cột SUẤT ĐẠT TRONG NGÀY hoặc ĐỊNH MỨC TRONG NGÀY (do merge/đổi tên)." },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ✅ 4) CALIBRATE cột số (FIX dmTarget/diff = 0)
    const dataRowsForCal = collectDataRows(values, hourRowIdx, 25);

    colDmH = calibrateNumericCol(colDmH, dataRowsForCal, scoreDmH);
    colSuatDat = calibrateNumericCol(colSuatDat, dataRowsForCal, scorePercent);
    colDinhMuc = calibrateNumericCol(colDinhMuc, dataRowsForCal, scorePercent);

    // 5) parse dữ liệu theo line
    const lineMap = new Map();
    let lineColGuess = -1;

    for (let r = hourRowIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      if (!row.length) continue;

      if (lineColGuess === -1) {
        // đoán cột chứa C1..C10
        for (let c = 0; c < 8; c++) {
          if (isLineToken(row[c])) {
            lineColGuess = c;
            break;
          }
        }
        if (lineColGuess === -1) lineColGuess = 0;
      }

      const rawLine = row[lineColGuess];

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

    // dailyRows + status chuẩn hoá để UI tô màu
    const dailyRows = linesOnly.map((ln) => {
      const it = lineMap.get(ln);
      const status = it.hsDat >= it.hsDm ? "ĐẠT" : "CHƯA ĐẠT";
      return { line: ln, hsDat: it.hsDat, hsDm: it.hsDm, status };
    });

    // hourly theo line/tổng hợp
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

    // ✅ status giờ: ĐỦ nếu chênh ~ 0 (sau khi làm tròn), VƯỢT nếu >0, THIẾU nếu <0
    const hourlyHours = hourLabels.map((hl, i) => {
      const total = totalsByHour[i] || 0;
      const dmTarget = dmHSelected * hl.factor;
      const diff = total - dmTarget;

      // làm tròn để tránh float
      const diffR = Math.round(diff);

      const status = diffR === 0 ? "ĐỦ" : (diffR > 0 ? "VƯỢT" : "THIẾU");

      return {
        label: hl.label,
        total,
        dmTarget,
        diff,
        status,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        chosenDate: date,
        lines,
        selectedLine,
        dailyRows,
        hourly: { line: selectedLine, dmH: dmHSelected, hours: hourlyHours },
        ...(debug
          ? {
              _debug: {
                anchor: found.anchor,
                hourRowIdx,
                colDmH,
                colSuatDat,
                colDinhMuc,
                lineColGuess,
                parsedLines: linesOnly,
                hourCols,
              },
            }
          : {}),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}