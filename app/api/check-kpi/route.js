
// app/api/check-kpi/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import sheets from "../_lib/googleSheetsClient";

// ================= Helpers =================
const DDMMYYYY_RE = /^\d{2}\/\d{2}\/\d{4}$/;

const norm = (v) => String(v ?? "").trim();
const up = (v) => norm(v).toUpperCase();

function isEmptyRow(r) {
  return !r || r.length === 0 || r.every((c) => norm(c) === "");
}

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = norm(v);
  if (!s) return 0;

  // "98%" -> 98
  if (s.endsWith("%")) {
    const n = Number(s.replace("%", "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toPercentMaybe(v) {
  // nếu sheet lưu 0.98 -> hiểu là 98 (%)
  const n = toNumber(v);
  if (n > 0 && n <= 2) return n * 100;
  return n;
}

function statusDatChuaDat(hsDat, hsDm) {
  return hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";
}

function lineIsWanted(line) {
  const s = up(line);
  if (s === "TỔNG HỢP" || s === "TONG HOP") return true;
  // chỉ C1..C10
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

function normalizeLine(line) {
  const s = up(line);
  if (s === "TONG HOP") return "TỔNG HỢP";
  return s;
}

// ---- Date matching (rất quan trọng để không lệch ngày 23/24) ----
function normalizeDateText(x) {
  // trả {full:"dd/MM/yyyy" or "", short:"dd/MM"}
  let s = norm(x);
  if (!s) return { full: "", short: "" };

  // yyyy-MM-dd -> dd/MM/yyyy
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) s = `${iso[3]}/${iso[2]}/${iso[1]}`;

  // dd/MM/yy -> dd/MM/20yy
  const dmy2 = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (dmy2) s = `${dmy2[1]}/${dmy2[2]}/20${dmy2[3]}`;
  // dd/MM/yyyy ok
  const dmy4 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy4) return { full: s, short: `${dmy4[1]}/${dmy4[2]}` };

  // dd/MM (không năm)
  const dm = s.match(/^(\d{2})\/(\d{2})$/);
  if (dm) return { full: "", short: `${dm[1]}/${dm[2]}` };
  // fallback: tìm dd/MM trong chuỗi
  const find = s.match(/(\d{2})\/(\d{2})/);
  if (find) return { full: "", short: `${find[1]}/${find[2]}` };

  return { full: "", short: "" };
}

function matchDate(cellValue, chosenDate /* dd/MM/yyyy */) {
  const a = normalizeDateText(cellValue);
  const b = normalizeDateText(chosenDate);
  if (!b.short) return false;

  // match full nếu có
  if (a.full && b.full && a.full === b.full) return true;
  // match theo dd/MM
  if (a.short && a.short === b.short) return true;

  return false;
}

// ---- Hour label -> multiplier ----
function hourMultiplier(label) {
  const s = norm(label).replace(/\s+/g, "");
  const m = s.match(/(\d{1,2})h(\d{2})?/i);
  if (!m) return 0;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;

  // theo quy ước bạn đang dùng: ->9h=1; ->10h=2; ->12h30=4.5 ...
  const mult = hh + mm / 60 - 8;
  return mult > 0 ? mult : 0;
}

// ================= Sheets read =================
async function getSheetTitles(spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabs = meta?.data?.sheets || [];
  return tabs.map((t) => t.properties?.title).filter(Boolean);
}

async function getValues(spreadsheetId, rangeA1) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return res?.data?.values || [];
}

// ================= Auto-detect tab by CONTENT =================
function scoreDailySample(sample) {
  // sample: values A1:Z40
  const flat = (sample || []).flat().map(up);
  const hasLine = flat.some((x) => x.includes("CHUY") || x.includes("LINE"));
  const hasHs = flat.some((x) => x.includes("HS") || x.includes("HIEU SUAT") || x.includes("HIỆU SUẤT"));
  const hasDm = flat.some((x) => x.includes("ĐỊNH MỨC") || x.includes("DINH MUC") || x.includes("DM"));
  const hasPercent = flat.some((x) => x.includes("%"));
  let score = 0;
  if (hasLine) score += 6;
  if (hasHs) score += 5;
  if (hasDm) score += 4;
  if (hasPercent) score += 2;
  return score;
}

function scoreHourlySample(sample) {
  const flat = (sample || []).flat().map(up);
  const hasDmH = flat.some((x) => x.includes("DM/H"));
  const hasArrowHour = flat.some((x) => x.includes("->9H") || x.includes("→9H") || x.includes("->10H") || x.includes("→10H"));
  const hasNgay = flat.some((x) => x.includes("NGÀY") || x.includes("NGAY") || /^\d{2}\/\d{2}\//.test(x));
  let score = 0;
  if (hasDmH) score += 8;
  if (hasArrowHour) score += 7;
  if (hasNgay) score += 2;
  return score;
}

async function pickBestSheetByContent(spreadsheetId, titles, kind /* "daily"|"hourly" */) {
  let best = { title: "", score: -1 };

  for (const t of titles) {
    // đọc sample nhỏ để chấm điểm nhanh
    const sample = await getValues(spreadsheetId, `'${t}'!A1:Z40`);
    const score = kind === "hourly" ? scoreHourlySample(sample) : scoreDailySample(sample);

    if (score > best.score) best = { title: t, score };
  }

  // nếu score quá thấp thì coi như không tìm thấy
  if (best.score <= 0) return { title: "", score: best.score };
  return best;
}

// ================= Parse DAILY =================
function findBestHeaderRow(values) {
  // chọn row có điểm cao nhất (trong 60 dòng đầu)
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(values.length, 60); i++) {
    const row = (values[i] || []).map(up);
    const txt = row.join(" | ");

    let s = 0;
    if (txt.includes("CHUY") || txt.includes("LINE")) s += 5;
    if (txt.includes("HS") || txt.includes("HIỆU SUẤT") || txt.includes("HIEU SUAT")) s += 4;
    if (txt.includes("ĐỊNH MỨC") || txt.includes("DINH MUC") || txt.includes("DM")) s += 3;
    if (txt.includes("%")) s += 1;

    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function parseDaily(values, chosenDate) {
  if (!values || values.length === 0) {
    return { lines: [], dailyRows: [], _dbg: { reason: "no_values" } };
  }

  const headerRowIdx = findBestHeaderRow(values);
  const header = (values[headerRowIdx] || []).map(norm);
  const headerU = header.map(up);

  const idxLine = (() => {
    const i = headerU.findIndex((h) => h.includes("CHUY") || h.includes("LINE"));
    return i >= 0 ? i : 0;
  })();

  // tìm cột HS đạt & HS ĐM theo keywords rộng hơn
  const idxHsDat =
    headerU.findIndex(
      (h) =>
        h.includes("HS ĐẠT") ||
        h.includes("HS DAT") ||
        h.includes("SUẤT ĐẠT") ||
        h.includes("SUAT DAT") ||
        (h.includes("HIỆU SUẤT") || h.includes("HIEU SUAT")) && h.includes("ĐẠT")
    );

  const idxHsDm =
    headerU.findIndex(
      (h) =>
        h.includes("HS ĐM") ||
        h.includes("HS DM") ||
        (h.includes("ĐỊNH MỨC") || h.includes("DINH MUC")) && (h.includes("HS") || h.includes("HIỆU SUẤT") || h.includes("HIEU SUAT"))
    );

  // fallback: nếu header có đúng cột ngày, dùng nó làm HS đạt
  const idxDateHeader = header.findIndex((h) => matchDate(h, chosenDate));
  let hsDatCol = idxHsDat;
  let hsDmCol = idxHsDm;

  if ((hsDatCol < 0 || hsDmCol < 0) && idxDateHeader >= 0) {
    hsDatCol = idxDateHeader;

    // tìm gần đó cột định mức
    let best = -1;
    for (let j = Math.max(0, idxDateHeader - 6); j <= Math.min(header.length - 1, idxDateHeader + 6); j++) {
      const hu = headerU[j];
      if (hu.includes("ĐỊNH MỨC") || hu.includes("DINH MUC") || hu.includes("HS DM") || hu.includes("HS ĐM") || hu === "DM") {
        best = j;
        break;
      }
    }
    hsDmCol = best;
  }

  const dailyRows = [];
  const linesSet = new Set();

  for (let i = headerRowIdx + 1; i < values.length; i++) {
    const row = values[i] || [];
    if (isEmptyRow(row)) continue;

    const lineRaw = norm(row[idxLine]);
    if (!lineRaw) continue;

    if (!lineIsWanted(lineRaw)) continue;

    const hsDat = hsDatCol >= 0 ? toPercentMaybe(row[hsDatCol]) : 0;
    const hsDm = hsDmCol >= 0 ? toPercentMaybe(row[hsDmCol]) : 0;

    // nếu cả 2 đều 0 thì bỏ
    if (hsDat === 0 && hsDm === 0) continue;

    const line = normalizeLine(lineRaw);
    const status = statusDatChuaDat(hsDat, hsDm);

    dailyRows.push({ line, hsDat, hsDm, status });
    linesSet.add(line);
  }

  dailyRows.sort((a, b) => lineSortKey(a.line) - lineSortKey(b.line));

  const lines = Array.from(linesSet).sort((a, b) => lineSortKey(a) - lineSortKey(b));
  if (!lines.includes("TỔNG HỢP")) lines.unshift("TỔNG HỢP");

  return {
    lines,
    dailyRows,
    _dbg: {
      headerRowIdx,
      headerSample: header.slice(0, 25),
      idxLine,
      hsDatCol,
      hsDmCol,
      idxDateHeader,
    },
  };
}

// ================= Parse HOURLY =================
function parseHourly(values, chosenDate, selectedLine) {
  if (!values || values.length === 0) {
    return { hourly: { line: selectedLine, dmH: 0, hours: [] }, _dbg: { reason: "no_values" } };
  }

  // tìm header row tốt nhất cho hourly
  let headerRowIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(values.length, 60); i++) {
    const row = (values[i] || []).map(up).join(" | ");
    let s = 0;
    if (row.includes("DM/H")) s += 8;
    if (row.includes("->9H") || row.includes("→9H")) s += 6;
    if (row.includes("NGÀY") || row.includes("NGAY")) s += 2;
    if (s > bestScore) { bestScore = s; headerRowIdx = i; }
  }

  const header = (values[headerRowIdx] || []).map(norm);
  const headerU = header.map(up);

  const idxDate = headerU.findIndex((h) => h.includes("NGÀY") || h.includes("NGAY") || h.includes("DATE"));
  const idxLine = headerU.findIndex((h) => h.includes("CHUY") || h.includes("LINE"));
  const idxDmH = headerU.findIndex((h) => h.includes("DM/H"));

  // cột giờ: có "->" hoặc "→"
  const hourCols = [];
  for (let c = 0; c < header.length; c++) {
    const hu = headerU[c];
    if (hu.includes("->") || hu.includes("→")) hourCols.push({ col: c, label: header[c] });
  }

  // tìm row match ngày + line
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
      _dbg: {
        headerRowIdx,
        headerSample: header.slice(0, 25),
        idxDate, idxLine, idxDmH,
        hourCols: hourCols.map((x) => x.label).slice(0, 10),
        found: false,
        wantLine,
      },
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

  return {
    hourly: { line: wantLine, dmH, hours },
    _dbg: {
      headerRowIdx,
      idxDate, idxLine, idxDmH,
      dmH,
      hourCount: hours.length,
      found: true,
      wantLine,
    },
  };
}

// ================= API =================
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const chosenDate = norm(searchParams.get("date")); // dd/MM/yyyy
    const selectedLine = norm(searchParams.get("line")) || "TỔNG HỢP";
    const debug = searchParams.get("debug") === "1";

    if (!chosenDate || !DDMMYYYY_RE.test(chosenDate)) {
      return NextResponse.json(
        { ok: false, error: "Thiếu/ sai tham số date (dd/MM/yyyy)" },
        { status: 400 }
      );
    }

    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID ||
      process.env.SPREADSHEET_ID ||
      process.env.GOOGLE_SPREADSHEET_ID ||
      "";

    if (!spreadsheetId) {
      return NextResponse.json(
        { ok: false, error: "Missing env GOOGLE_SHEET_ID (hoặc SPREADSHEET_ID)" },
        { status: 500 }
      );
    }

    const titles = await getSheetTitles(spreadsheetId);

    // ✅ dò tab đúng theo content (không phụ thuộc tên tab)
    const dailyPick = await pickBestSheetByContent(spreadsheetId, titles, "daily");
    const hourlyPick = await pickBestSheetByContent(spreadsheetId, titles, "hourly");

    const dailySheet = dailyPick.title;
    const hourlySheet = hourlyPick.title;

    const dailyValues = dailySheet ? await getValues(spreadsheetId, `'${dailySheet}'!A:ZZ`) : [];
    const hourlyValues = hourlySheet ? await getValues(spreadsheetId, `'${hourlySheet}'!A:ZZ`) : [];

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

    // ✅ nếu bị rỗng, tự trả debug để bạn nhìn ra tab/ header sai ở đâu (khỏi mò)
    const empty = (body.dailyRows.length === 0) && (!body.hourly?.hours?.length);
    if (debug || empty) {
      body._debug = {
        titles,
        dailySheet,
        hourlySheet,
        dailyPick,
        hourlyPick,
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
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}