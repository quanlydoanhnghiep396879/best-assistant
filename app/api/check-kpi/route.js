import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ================== HELPERS ==================
const s = (v) => (v === null || v === undefined ? "" : String(v));
const normSpaces = (str) => s(str).replace(/\u00A0/g, " ");
const noMark = (str) => normSpaces(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (str) => noMark(str).trim().toUpperCase();

function toNumberSafe(v) {
  if (v === null || v === undefined) return NaN;

  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;

  const t = s(v).trim();
  if (!t) return NaN;

  // "95.87%" / "1,234" / "1.234,5" (VN)
  let x = t.replace(/\s/g, "");

  // percent?
  const isPct = x.includes("%");
  x = x.replace("%", "");

  // remove thousands separators safely
  // If has both "." and "," assume VN style "1.234,56" -> "1234.56"
  if (x.includes(".") && x.includes(",")) {
    x = x.replace(/\./g, "").replace(",", ".");
  } else {
    // otherwise just remove commas
    x = x.replace(/,/g, "");
  }

  const n = Number(x);
  if (!Number.isFinite(n)) return NaN;

  return isPct ? n : n;
}

function toPercentNumber(v) {
  // returns percent in [0..100+], from 0.98 or 98 or "98%"
  const n = toNumberSafe(v);
  if (!Number.isFinite(n)) return NaN;
  // heuristics: 0..1.5 => ratio
  if (n >= 0 && n <= 1.5) return n * 100;
  return n;
}

function isDateLike(raw) {
  // matches: 24/12/2025, 24/12, 24/12/25
  const t = s(raw).trim();
  return /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(t);
}

function normalizeDate(raw, fallbackYear) {
  const t = s(raw).trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return "";
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  let yy = m[3];

  if (!yy) yy = String(fallbackYear || new Date().getFullYear());
  if (yy.length === 2) yy = "20" + yy;
  return `${dd}/${mm}/${yy}`;
}

function isLineWanted(lineRaw) {
  const t = norm(lineRaw);
  if (!t) return false;

  // keep TỔNG HỢP + C1..C10...
  if (t === "TONG HOP" || t === "TỔNG HỢP") return true;
  if (/^C\s*\d+$/i.test(lineRaw.trim())) return true;

  // remove these groups:
  if (t === "CAT" || t === "CẮT") return false;
  if (t === "HOAN TAT" || t === "HOÀN TẤT") return false;
  if (t === "KCS") return false;
  if (t === "NM") return false;

  return false;
}

function lineSortKey(lineRaw) {
  const t = norm(lineRaw);
  if (t === "TONG HOP" || t === "TỔNG HỢP") return { group: 0, n: 0, raw: t };

  const m = lineRaw.trim().match(/^C\s*(\d+)$/i);
  if (m) return { group: 1, n: parseInt(m[1], 10), raw: t };

  return { group: 9, n: 9999, raw: t };
}

function roundInt(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}
function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ================== GOOGLE SHEETS ==================
function getCreds() {
  // Support either JSON text or base64 JSON
  const jsonText = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (jsonText) return JSON.parse(jsonText);
  if (b64) return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_BASE64");
}

async function getSheets() {
  const creds = getCreds();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

// ================== CORE PARSE ==================
function findDateBlocks(values) {
  // we look mostly in column A, but also allow finding in whole row
  const blocks = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const a = row[0];
    if (isDateLike(a)) blocks.push({ rowIndex: r, raw: a });
  }
  return blocks;
}

function findHeaderRowInBlock(values, startRow, endRow) {
  // find row that contains DM/H + at least one "->" hour label
  for (let r = startRow; r <= Math.min(endRow, startRow + 8); r++) {
    const row = values[r] || [];
    const cells = row.map((c) => norm(c));
    const hasDMH = cells.some((c) => c.includes("DM/H") || c === "DM/H");
    const hasHour = cells.some((c) => c.includes("->") || c.includes("→") || c.includes(">"));
    if (hasDMH && hasHour) return r;
  }
  // fallback: try only DM/H
  for (let r = startRow; r <= Math.min(endRow, startRow + 10); r++) {
    const row = values[r] || [];
    const cells = row.map((c) => norm(c));
    const hasDMH = cells.some((c) => c.includes("DM/H") || c === "DM/H");
    if (hasDMH) return r;
  }
  return startRow; // worst fallback
}

function buildColumnIndexMap(headerRow) {
  const map = {
    dmDayCol: -1,
    dmHCol: -1,
    hourCols: [], // {col, label}
  };

  for (let c = 0; c < headerRow.length; c++) {
    const cell = norm(headerRow[c]);
    if (!cell) continue;

    if (cell === "DM/NGAY" || cell.includes("DM/NGAY")) map.dmDayCol = c;
    if (cell === "DM/H" || cell.includes("DM/H")) map.dmHCol = c;

    // hour labels: "->9h", "->10h", "->12h30"...
    if (cell.includes("->") || cell.includes("→") || cell.includes(">")) {
      // accept only those that look like hour checkpoints
      if (/\d/.test(cell) && (cell.includes("H") || cell.includes("H30") || cell.includes("H.30") || cell.includes("H:30"))) {
        map.hourCols.push({ col: c, label: s(headerRow[c]).trim() });
      } else if (cell.match(/(->|→|>)\s*\d/)) {
        map.hourCols.push({ col: c, label: s(headerRow[c]).trim() });
      }
    }
  }

  return map;
}

function detectHSColumnsByData(rows) {
  // find best adjacent pair (hsDat, hsDM) by counting percent-like values
  let best = { score: 0, a: -1, b: -1 };

  if (!rows.length) return best;

  const maxCols = Math.max(...rows.map((r) => r.length));
  for (let c = 0; c < maxCols - 1; c++) {
    let score = 0;
    for (const row of rows) {
      const p1 = toPercentNumber(row[c]);
      const p2 = toPercentNumber(row[c + 1]);
      if (Number.isFinite(p1) && Number.isFinite(p2)) score++;
    }
    if (score > best.score) best = { score, a: c, b: c + 1 };
  }
  return best;
}

function parseBlock(values, dateRowIndex) {
  // block is from dateRowIndex to just before next date row
  const blocks = findDateBlocks(values);
  const idx = blocks.findIndex((b) => b.rowIndex === dateRowIndex);
  const next = blocks[idx + 1];
  const endRow = next ? next.rowIndex - 1 : values.length - 1;

  const headerRowIndex = findHeaderRowInBlock(values, dateRowIndex + 1, endRow);
  const headerRow = values[headerRowIndex] || [];
  const { dmHCol, hourCols } = buildColumnIndexMap(headerRow);

  const dataRows = [];
  for (let r = headerRowIndex + 1; r <= endRow; r++) {
    const row = values[r] || [];
    const line = row[0];
    if (!isLineWanted(line)) continue;
    dataRows.push({ r, row, line: s(line).trim() });
  }

  // sort lines
  dataRows.sort((a, b) => {
    const ka = lineSortKey(a.line);
    const kb = lineSortKey(b.line);
    if (ka.group !== kb.group) return ka.group - kb.group;
    if (ka.n !== kb.n) return ka.n - kb.n;
    return ka.raw.localeCompare(kb.raw);
  });

  // lines list for dropdown
  const lines = [...new Set(dataRows.map((x) => x.line))];

  // detect HS columns (percent columns) by data pattern
  const hsDetect = detectHSColumnsByData(dataRows.map((x) => x.row));
  const hsDatCol = hsDetect.a;
  const hsDmCol = hsDetect.b;

  const dailyRows = dataRows.map((x) => {
    const hsDat = toPercentNumber(x.row[hsDatCol]);
    const hsDm = toPercentNumber(x.row[hsDmCol]);
    const hsDatPct = Number.isFinite(hsDat) ? round2(hsDat) : null;
    const hsDmPct = Number.isFinite(hsDm) ? round2(hsDm) : null;

    let status = "";
    if (Number.isFinite(hsDat) && Number.isFinite(hsDm)) {
      status = hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";
    } else {
      status = "CHƯA CÓ DỮ LIỆU";
    }

    return {
      line: x.line,
      hsDat: hsDatPct,
      hsDm: hsDmPct,
      status,
    };
  });

  // hourly for a line will be computed later (need selectedLine)
  return {
    headerRowIndex,
    dmHCol,
    hourCols,
    lines,
    dailyRows,
    dataRows, // keep for lookup
  };
}

function buildHourlyForLine(parsed, selectedLine) {
  const rowObj = parsed.dataRows.find((x) => norm(x.line) === norm(selectedLine));
  if (!rowObj) {
    return { line: selectedLine, dmH: 0, hours: [] };
  }

  const dmH = toNumberSafe(rowObj.row[parsed.dmHCol]);
  const dmHn = Number.isFinite(dmH) ? dmH : 0;

  const hours = [];
  let prevCum = 0;

  parsed.hourCols.forEach((hc, idx) => {
    const cum = toNumberSafe(rowObj.row[hc.col]);
    const cumN = Number.isFinite(cum) ? cum : 0;

    const milestoneIndex = idx + 1; // 1..N (đúng logic sheet: ->9h=1, ->10h=2,...)
    const expectedCum = dmHn * milestoneIndex;

    const inHour = cumN - prevCum;
    prevCum = cumN;

    const diffCum = cumN - expectedCum;

    const statusCum = diffCum >= 0 ? "VƯỢT/ĐỦ" : "THIẾU";
    const statusHour = (inHour - dmHn) >= 0 ? "VƯỢT/ĐỦ" : "THIẾU";

    hours.push({
      label: hc.label,
      cumActual: roundInt(cumN),
      expectedCum: roundInt(expectedCum),
      diffCum: roundInt(diffCum),
      statusCum,
      inHour: roundInt(inHour),
      expectedHour: roundInt(dmHn),
      diffHour: roundInt(inHour - dmHn),
      statusHour,
    });
  });

  return { line: selectedLine, dmH: roundInt(dmHn), hours };
}

// ================== API ==================
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.KPI_SHEET_NAME || "KPI";
    if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID");

    const dateParam = decodeURIComponent(searchParams.get("date") || "");
    const lineParam = decodeURIComponent(searchParams.get("line") || "");

    const sheets = await getSheets();
    const range = `${sheetName}!A1:AZ2000`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = resp.data.values || [];

    const blocks = findDateBlocks(values);
    if (!blocks.length) {
      return NextResponse.json(
        { ok: true, dates: [], chosenDate: "", lines: [], dailyRows: [], hourly: { line: "", dmH: 0, hours: [] } },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // normalize all dates (use year from latest block if missing)
    const latestRaw = blocks[0]?.raw;
    const fallbackYear = (() => {
      // try to extract year from any date with year
      for (const b of blocks) {
        const t = s(b.raw).trim();
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return parseInt(t.slice(-4), 10);
      }
      // else current year
      return new Date().getFullYear();
    })();

    const normalizedBlocks = blocks.map((b) => ({
      ...b,
      date: normalizeDate(b.raw, fallbackYear),
    }));

    const dates = normalizedBlocks.map((b) => b.date);

    // choose date
    let chosenDate = "";
    if (dateParam) chosenDate = normalizeDate(dateParam, fallbackYear);

    if (!chosenDate) {
      // default: first date found (topmost)
      chosenDate = normalizedBlocks[0].date;
    }

    // find block row for chosenDate
    const chosenBlock = normalizedBlocks.find((b) => b.date === chosenDate) || normalizedBlocks[0];

    // parse chosen block only
    const parsed = parseBlock(values, chosenBlock.rowIndex);

    // choose line
    let selectedLine = lineParam ? lineParam : "TỔNG HỢP";
    // if not in list, fallback first
    if (!parsed.lines.some((x) => norm(x) === norm(selectedLine))) {
      selectedLine = parsed.lines.find((x) => norm(x) === "TỔNG HỢP" || norm(x) === "TONG HOP") || parsed.lines[0] || "TỔNG HỢP";
    }

    const hourly = buildHourlyForLine(parsed, selectedLine);

    return NextResponse.json(
      {
        ok: true,
        chosenDate,
        dates,
        lines: parsed.lines,
        selectedLine,
        dailyRows: parsed.dailyRows,
        hourly,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}