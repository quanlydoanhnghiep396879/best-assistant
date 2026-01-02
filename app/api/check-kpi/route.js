// app/api/check-kpi/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import sheets from "../_lib/googleSheetsClient";

const DDMMYYYY_RE = /^\d{2}\/\d{2}\/\d{4}$/;

const norm = (v) => String(v ?? "").trim();
const up = (v) => norm(v).toUpperCase();

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = norm(v);
  if (!s) return 0;

  // "95.87%" => 95.87
  if (s.endsWith("%")) {
    const n = Number(s.replace("%", "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// 0.98 => 98 (%)
function toPercentMaybe(v) {
  const n = toNumber(v);
  if (n > 0 && n <= 2) return n * 100;
  return n;
}

function isEmptyRow(r) {
  return !r || r.length === 0 || r.every((c) => norm(c) === "");
}

function normalizeLine(line) {
  const s = up(line);
  if (s === "TONG HOP") return "TỔNG HỢP";
  return s;
}

function lineIsWanted(line) {
  const s = up(line);
  if (s === "TỔNG HỢP" || s === "TONG HOP") return true;
  const m = s.match(/^C(\d+)$/);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= 10;
}

function lineSortKey(line) {
  const s = up(line);
  if (s === "TỔNG HỢP" || s === "TONG HOP") return -1;
  const m = s.match(/^C(\d+)$/);
  return m ? Number(m[1]) : 999999;
}

function normalizeDateText(x) {
  let s = norm(x);
  if (!s) return { full: "", short: "" };

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) s = `${iso[3]}/${iso[2]}/${iso[1]}`;

  const dmy4 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy4) return { full: s, short: `${dmy4[1]}/${dmy4[2]}` };

  const dm = s.match(/^(\d{2})\/(\d{2})$/);
  if (dm) return { full: "", short: `${dm[1]}/${dm[2]}` };

  const find = s.match(/(\d{2})\/(\d{2})/);
  if (find) return { full: "", short: `${find[1]}/${find[2]}``` };

  return { full: "", short: "" };
}

function matchDate(cellValue, chosenDate) {
  const a = normalizeDateText(cellValue);
  const b = normalizeDateText(chosenDate);
  if (!b.short) return false;
  if (a.full && b.full && a.full === b.full) return true;
  if (a.short && a.short === b.short) return true;
  return false;
}

// ===== Hour multiplier (->9h=1, ->10h=2, ->12h30=4.5, ...)
function hourMultiplier(label) {
  const s = norm(label).replace(/\s+/g, "");
  const m = s.match(/(\d{1,2})h(\d{2})?/i);
  if (!m) return 0;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const mult = hh + mm / 60 - 8;
  return mult > 0 ? mult : 0;
}

// ===== Sheets read (FORMATTED_VALUE để date/% ra đúng text)
async function getValues(spreadsheetId, rangeA1) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return res?.data?.values || [];
}

// ===== DAILY PARSE “dễ sống”:
// - tìm cột có nhiều C1..C10 nhất => lineCol
// - tìm HS ĐM theo header có "ĐỊNH MỨC/DM/HS ĐM"
// - HS đạt: ưu tiên cột có header khớp date, nếu không có thì tìm "HS ĐẠT/SUẤT ĐẠT"
function detectLineColumn(values) {
  const colMax = Math.max(...values.slice(0, 200).map((r) => r.length), 0);
  let bestCol = 0;
  let bestScore = -1;

  for (let c = 0; c < colMax; c++) {
    let score = 0;
    for (let r = 0; r < Math.min(values.length, 200); r++) {
      const v = up(values[r]?.[c]);
      if (/^C(\d+)$/.test(v)) {
        const n = Number(v.slice(1));
        if (n >= 1 && n <= 10) score++;
      }
      if (v === "TỔNG HỢP" || v === "TONG HOP") score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

function findHeaderRow(values) {
  // tìm row có nhiều chữ “HS/ĐỊNH MỨC/DM/%/CHUYỀN”
  let bestIdx = 0;
  let best = -1;
  for (let i = 0; i < Math.min(values.length, 80); i++) {
    const row = (values[i] || []).map(up).join(" | ");
    let s = 0;
    if (row.includes("CHUY") || row.includes("LINE")) s += 4;
    if (row.includes("HS") || row.includes("HIEU SUAT") || row.includes("HIỆU SUẤT")) s += 3;
    if (row.includes("DINH MUC") || row.includes("ĐỊNH MỨC") || row.includes("DM")) s += 3;
    if (row.includes("%")) s += 1;
    if (s > best) { best = s; bestIdx = i; }
  }
  return bestIdx;
}

function parseDaily(values, chosenDate) {
  if (!values || values.length === 0) {
    return { lines: ["TỔNG HỢP"], dailyRows: [], _dbg: { reason: "no_values" } };
  }

  const headerRowIdx = findHeaderRow(values);
  const header = (values[headerRowIdx] || []).map(norm);
  const headerU = header.map(up);

  const lineCol = detectLineColumn(values);

  const dmCol = headerU.findIndex(
    (h) => h.includes("HS ĐM") || h.includes("HS DM") || h.includes("ĐỊNH MỨC") || h.includes("DINH MUC")
  );

  const dateCol = header.findIndex((h) => matchDate(h, chosenDate));

  const hsDatCol =
    dateCol >= 0
      ? dateCol
      : headerU.findIndex((h) => h.includes("HS ĐẠT") || h.includes("HS DAT") || h.includes("SUẤT ĐẠT") || h.includes("SUAT DAT"));

  const out = [];
  const setLines = new Set();

  for (let r = headerRowIdx + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (isEmptyRow(row)) continue;

    const lineRaw = norm(row[lineCol]);
    if (!lineRaw) continue;
    if (!lineIsWanted(lineRaw)) continue;

    const hsDat = hsDatCol >= 0 ? toPercentMaybe(row[hsDatCol]) : 0;
    const hsDm = dmCol >= 0 ? toPercentMaybe(row[dmCol]) : 0;

    // bỏ dòng vô nghĩa
    if (hsDat === 0 && hsDm === 0) continue;

    const line = normalizeLine(lineRaw);
    const status = hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";
    out.push({ line, hsDat, hsDm, status });
    setLines.add(line);
  }

  out.sort((a, b) => lineSortKey(a.line) - lineSortKey(b.line));

  const lines = Array.from(setLines).sort((a, b) => lineSortKey(a) - lineSortKey(b));
  if (!lines.includes("TỔNG HỢP")) lines.unshift("TỔNG HỢP");

  return {
    lines,
    dailyRows: out,
    _dbg: { headerRowIdx, lineCol, dmCol, hsDatCol, dateCol, headerSample: header.slice(0, 30) },
  };
}

// ===== HOURLY PARSE (giữ dạng: 1 row = (date + line + dm/h + nhiều cột ->9h ->10h ...))
function parseHourly(values, chosenDate, selectedLine) {
  if (!values || values.length === 0) {
    return { hourly: { line: selectedLine, dmH: 0, hours: [] }, _dbg: { reason: "no_values" } };
  }

  // tìm header row có DM/H và ->9h
  let headerRowIdx = 0;
  let best = -1;
  for (let i = 0; i < Math.min(values.length, 80); i++) {
    const row = (values[i] || []).map(up).join(" | ");
    let s = 0;
    if (row.includes("DM/H")) s += 8;
    if (row.includes("->9H") || row.includes("→9H")) s += 6;
    if (row.includes("NGÀY") || row.includes("NGAY") || row.includes("DATE")) s += 2;
    if (s > best) { best = s; headerRowIdx = i; }
  }

  const header = (values[headerRowIdx] || []).map(norm);
  const headerU = header.map(up);

  const idxDate = headerU.findIndex((h) => h.includes("NGÀY") || h.includes("NGAY") || h.includes("DATE"));
  const idxLine = headerU.findIndex((h) => h.includes("CHUY") || h.includes("LINE"));
  const idxDmH = headerU.findIndex((h) => h.includes("DM/H"));

  const hourCols = [];
  for (let c = 0; c < header.length; c++) {
    const hu = headerU[c];
    if (hu.includes("->") || hu.includes("→")) hourCols.push({ col: c, label: header[c] });
  }

  const wantLine = normalizeLine(selectedLine);
  let foundRow = null;

  for (let r = headerRowIdx + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (isEmptyRow(row)) continue;

    const d = idxDate >= 0 ? row[idxDate] : "";
    const l = idxLine >= 0 ? normalizeLine(row[idxLine]) : "";

    if (matchDate(d, chosenDate) && l === wantLine) {
      foundRow = row;
      break;
    }
  }

  if (!foundRow) {
    return {
      hourly: { line: wantLine, dmH: 0, hours: [] },
      _dbg: { headerRowIdx, idxDate, idxLine, idxDmH, found: false, wantLine, hourCols: hourCols.map(x=>x.label).slice(0,12) },
    };
  }

  const dmH = idxDmH >= 0 ? toNumber(foundRow[idxDmH]) : 0;

  const hours = hourCols.map(({ col, label }) => {
    const total = toNumber(foundRow[col]);
    const mult = hourMultiplier(label);
    const dmTarget = dmH * mult;
    const diff = total - dmTarget;
    return {
      label: norm(label),
      total,
      dmTarget,
      diff,
      status: diff >= 0 ? "VƯỢT" : "THIẾU",
    };
  });

  return { hourly: { line: wantLine, dmH, hours }, _dbg: { headerRowIdx, idxDate, idxLine, idxDmH, found: true } };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const chosenDate = norm(searchParams.get("date"));
    const selectedLine = norm(searchParams.get("line")) || "TỔNG HỢP";
    const debug = searchParams.get("debug") === "1";

    if (!chosenDate || !DDMMYYYY_RE.test(chosenDate)) {
      return NextResponse.json({ ok: false, error: "Sai date. Cần dd/MM/yyyy" }, { status: 400 });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";
    if (!spreadsheetId) {
      return NextResponse.json({ ok: false, error: "Missing env GOOGLE_SHEET_ID" }, { status: 500 });
    }

    const dailySheet = process.env.DAILY_SHEET_NAME || "";
    const hourlySheet = process.env.HOURLY_SHEET_NAME || "";

    if (!dailySheet || !hourlySheet) {
      return NextResponse.json(
        { ok: false, error: "Thiếu env DAILY_SHEET_NAME hoặc HOURLY_SHEET_NAME (để tránh đọc nhầm tab)" },
        { status: 500 }
      );
    }

    const dailyValues = await getValues(spreadsheetId, `'${dailySheet}'!A:ZZ`);
    const hourlyValues = await getValues(spreadsheetId, `'${hourlySheet}'!A:ZZ`);

    const dailyParsed = parseDaily(dailyValues, chosenDate);
    const hourlyParsed = parseHourly(hourlyValues, chosenDate, selectedLine);

    const body = {
      ok: true,
      chosenDate,
      lines: (dailyParsed.lines || []).filter(lineIsWanted),
      selectedLine: normalizeLine(selectedLine),
      dailyRows: dailyParsed.dailyRows || [],
      hourly: hourlyParsed.hourly,
    };

    const empty = body.dailyRows.length === 0 && (!body.hourly?.hours?.length);
    if (debug || empty) {
      body._debug = {
        dailySheet,
        hourlySheet,
        dailyFirstRows: dailyValues.slice(0, 10),
        hourlyFirstRows: hourlyValues.slice(0, 10),
        daily: dailyParsed._dbg,
        hourly: hourlyParsed._dbg,
      };
    }

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}