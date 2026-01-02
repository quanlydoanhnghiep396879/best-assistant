// app/api/check-kpi/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import sheets from "../_lib/googleSheetsClient";

// ================= Helpers =================
const DDMMYYYY_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function norm(s) {
  return String(s ?? "").trim();
}
function up(s) {
  return norm(s).toUpperCase();
}
function isEmptyRow(r) {
  return !r || r.every((c) => norm(c) === "");
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
  // Nếu sheet lưu 0.98 -> hiểu là 98 (%)
  const n = toNumber(v);
  if (n > 0 && n <= 2) return n * 100; // 0.98, 1.01...
  return n;
}

function hourMultiplier(label) {
  // label dạng "->9h", "->10h", "->12h30", "->16h30"
  const s = norm(label).replace(/\s+/g, "");
  const m = s.match(/(\d{1,2})h(\d{2})?/i);
  if (!m) return 0;

  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;

  // quy đổi: ->9h = 1, ->10h = 2 ... theo mốc bắt đầu 8h
  // (thực tế nhà máy bạn đang dùng: 9h=1; 10h=2; 11h=3; 12h30=4.5; 13h30=5.5; 14h30=6.5; 15h30=7.5; 16h30=8.5)
  // => multiplier = (hh + mm/60) - 8
  const mult = hh + mm / 60 - 8;
  return mult > 0 ? mult : 0;
}

function statusDatChuaDat(hsDat, hsDm) {
  // đúng yêu cầu của bạn: so sánh 2 cột trong sheet
  return hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";
}

function lineIsWanted(line) {
  const s = up(line);
  if (s === "TỔNG HỢP" || s === "TONG HOP") return true;
  return /^C\d+$/i.test(s);
}

function lineSortKey(line) {
  const s = up(line);
  if (s === "TỔNG HỢP" || s === "TONG HOP") return -1;
  const m = s.match(/^C(\d+)$/i);
  return m ? Number(m[1]) : 999999;
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

function guessDailySheet(titles) {
  // ưu tiên các tên thường gặp
  const prefer = [
    "KPI",
    "KPI NGÀY",
    "KPI_NGAY",
    "KPI DAILY",
    "DAILY",
    "HIỆU SUẤT NGÀY",
    "HIEU SUAT NGAY",
  ].map(up);

  for (const p of prefer) {
    const found = titles.find((t) => up(t) === p);
    if (found) return found;
  }

  // fallback: sheet nào có chữ KPI
  const k = titles.find((t) => up(t).includes("KPI"));
  if (k) return k;

  // fallback cuối: sheet đầu
  return titles[0] || "";
}

function guessHourlySheet(titles) {
  const prefer = [
    "THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY",
    "THONG KE HIEU SUAT THEO GIO, NGAY",
    "THEO GIỜ",
    "THEO GIO",
    "HOURLY",
    "GIỜ",
    "GIO",
  ].map(up);

  for (const p of prefer) {
    const found = titles.find((t) => up(t) === p);
    if (found) return found;
  }

  // fallback: sheet nào có chữ GIỜ / HOURLY
  const h = titles.find((t) => up(t).includes("GIỜ") || up(t).includes("GIO") || up(t).includes("HOURLY"));
  if (h) return h;

  return "";
}

// ================= Parse DAILY =================
function parseDaily(values, chosenDate /* dd/MM/yyyy */) {
  // Ta sẽ tìm các cột:
  // - line col: "Chuyền/BP" / "CHUYEN" / "LINE"
  // - hsDat col: "HS đạt" / "SUẤT ĐẠT" / "TY LE HS DAT"
  // - hsDm col: "HS ĐM" / "ĐỊNH MỨC ... HS" / "HS DM"
  // Nếu sheet của bạn dùng theo ngày (có cột dd/MM/yyyy), thì vẫn OK:
  // ta không parse theo Date() mà so string header.

  if (!values || values.length === 0) return { lines: [], dailyRows: [], _dbg: { reason: "no_values" } };

  // tìm header row: row nào có "CHUYỀN" hoặc "LINE"
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(values.length, 30); i++) {
    const row = values[i] || [];
    const rowText = row.map(up).join(" | ");
    if (rowText.includes("CHUY") || rowText.includes("LINE") || rowText.includes("CHUYỀN")) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) headerRowIdx = 0;

  const header = (values[headerRowIdx] || []).map(norm);
  const headerU = header.map(up);

  const idxLine =
    headerU.findIndex((h) => h.includes("CHUY") || h.includes("LINE")) ?? 0;

  // hsDat / hsDm theo kiểu cột cố định
  let idxHsDat = headerU.findIndex((h) => h.includes("HS ĐẠT") || h.includes("HS DAT") || h.includes("SUẤT ĐẠT") || h.includes("SUAT DAT") || h.includes("TY LE HS DAT"));
  let idxHsDm  = headerU.findIndex((h) => h.includes("HS ĐM") || h.includes("HS DM") || (h.includes("ĐỊNH MỨC") || h.includes("DINH MUC")) && h.includes("HS"));

  // Nếu có cột theo ngày (header có dd/MM/yyyy) và hs nằm trong block ngày, ta thử fallback:
  // tìm cột đúng bằng chosenDate và xem các cột gần đó có chứa HS ĐẠT/HS ĐM
  const idxDateHeader = header.findIndex((h) => norm(h) === chosenDate);
  if ((idxHsDat < 0 || idxHsDm < 0) && idxDateHeader >= 0) {
    // thử: chosenDate là cột HS ĐẠT, và HS ĐM là cột bên phải/trái có text định mức
    idxHsDat = idxDateHeader;
    // tìm gần đó cột có chữ "ĐỊNH MỨC" hoặc "DM"
    let best = -1;
    for (let j = Math.max(0, idxDateHeader - 3); j <= Math.min(header.length - 1, idxDateHeader + 3); j++) {
      if (headerU[j].includes("ĐỊNH MỨC") || headerU[j].includes("DINH MUC") || headerU[j].includes("HS DM") || headerU[j].includes("HS ĐM")) {
        best = j;
        break;
      }
    }
    idxHsDm = best;
  }

  // parse rows dưới header
  const dailyRows = [];
  const linesSet = new Set();

  for (let i = headerRowIdx + 1; i < values.length; i++) {
    const row = values[i] || [];
    if (isEmptyRow(row)) continue;

    const line = norm(row[idxLine]);
    if (!line) continue;

    // filter theo yêu cầu: chỉ C1..C10 + TỔNG HỢP (loại CẮT/HOÀN TẤT/KCS/NM...)
    if (!lineIsWanted(line)) continue;

    const hsDat = toPercentMaybe(row[idxHsDat]);
    const hsDm = idxHsDm >= 0 ? toPercentMaybe(row[idxHsDm]) : 0;

    // nếu cả 2 đều 0 thì bỏ (tránh “rác”)
    if (hsDat === 0 && hsDm === 0) continue;

    const status = statusDatChuaDat(hsDat, hsDm);

    dailyRows.push({
      line: up(line) === "TONG HOP" ? "TỔNG HỢP" : up(line),
      hsDat,
      hsDm,
      status,
    });
    linesSet.add(up(line) === "TONG HOP" ? "TỔNG HỢP" : up(line));
  }

  // sort line: TỔNG HỢP trước, rồi C1..C10
  dailyRows.sort((a, b) => lineSortKey(a.line) - lineSortKey(b.line));

  const lines = Array.from(linesSet).sort((a, b) => lineSortKey(a) - lineSortKey(b));
  if (!lines.includes("TỔNG HỢP")) lines.unshift("TỔNG HỢP");

  return {
    lines,
    dailyRows,
    _dbg: {
      headerRowIdx,
      idxLine,
      idxHsDat,
      idxHsDm,
      foundDateHeader: idxDateHeader,
    },
  };
}

// ================= Parse HOURLY =================
function parseHourly(values, chosenDate, selectedLine) {
  if (!values || values.length === 0) return { hourly: { line: selectedLine, dmH: 0, hours: [] }, _dbg: { reason: "no_values" } };

  // tìm header row chứa "DM/H" và có mốc "->9h"
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(values.length, 50); i++) {
    const row = (values[i] || []).map(up).join(" | ");
    if (row.includes("DM/H") && (row.includes("->9H") || row.includes("→9H") || row.includes("9H"))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) {
    // fallback: row nào có DM/H
    for (let i = 0; i < Math.min(values.length, 50); i++) {
      const row = (values[i] || []).map(up).join(" | ");
      if (row.includes("DM/H")) { headerRowIdx = i; break; }
    }
  }
  if (headerRowIdx < 0) headerRowIdx = 0;

  const header = (values[headerRowIdx] || []).map(norm);
  const headerU = header.map(up);

  const idxDate =
    headerU.findIndex((h) => h.includes("NGÀY") || h.includes("NGAY") || h.includes("DATE")) ?? -1;
  const idxLine =
    headerU.findIndex((h) => h.includes("CHUY") || h.includes("LINE")) ?? -1;
  const idxDmH = headerU.findIndex((h) => h.includes("DM/H"));

  // hour columns: header có "->" hoặc "→"
  const hourCols = [];
  for (let c = 0; c < header.length; c++) {
    const hu = headerU[c];
    if (hu.includes("->") || hu.includes("→")) {
      hourCols.push({ col: c, label: header[c] || hu });
    } else if (/^\d{1,2}H(\d{2})?$/i.test(hu)) {
      // fallback: "9H", "12H30"
      hourCols.push({ col: c, label: header[c] });
    }
  }

  // tìm data row khớp chosenDate + selectedLine
  // IMPORTANT: so sánh string trực tiếp, không dùng Date()
  let foundRow = null;
  for (let r = headerRowIdx + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (isEmptyRow(row)) continue;

    const d = idxDate >= 0 ? norm(row[idxDate]) : "";
    const l = idxLine >= 0 ? up(row[idxLine]) : "";

    if (d === chosenDate && (l === up(selectedLine) || (up(selectedLine) === "TỔNG HỢP" && (l === "TỔNG HỢP" || l === "TONG HOP")))) {
      foundRow = row;
      break;
    }
  }

  if (!foundRow) {
    return {
      hourly: { line: selectedLine, dmH: 0, hours: [] },
      _dbg: { headerRowIdx, idxDate, idxLine, idxDmH, hourCols: hourCols.length, found: false },
    };
  }

  const dmH = idxDmH >= 0 ? toNumber(foundRow[idxDmH]) : 0;

  const hours = hourCols.map(({ col, label }) => {
    const total = toNumber(foundRow[col]);
    const mult = hourMultiplier(label);
    const dmTarget = dmH * mult;
    const diff = total - dmTarget;

    const status = diff >= 0 ? "VƯỢT" : "THIẾU";

    return {
      label: norm(label),
      total,
      dmTarget,
      diff,
      status,
      okHour: diff >= 0,
      mult,
    };
  });

  return {
    hourly: { line: selectedLine, dmH, hours },
    _dbg: { headerRowIdx, idxDate, idxLine, idxDmH, hourCols: hourCols.length, found: true },
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

    const dailySheet = guessDailySheet(titles);
    const hourlySheet = guessHourlySheet(titles);

    // đọc range rộng để khỏi thiếu cột
    const dailyValues = dailySheet ? await getValues(spreadsheetId, `'${dailySheet}'!A:ZZ`) : [];
    const hourlyValues = hourlySheet ? await getValues(spreadsheetId, `'${hourlySheet}'!A:ZZ`) : [];

    const dailyParsed = parseDaily(dailyValues, chosenDate);
    const hourlyParsed = parseHourly(hourlyValues, chosenDate, selectedLine);

    // lines ưu tiên từ daily (đúng theo yêu cầu chọn chuyền)
    const lines = (dailyParsed.lines || []).filter(lineIsWanted);
    // nếu daily không ra lines, fallback từ selectedLine
    if (!lines.length) lines.push("TỔNG HỢP");

    // ép selectedLine về dạng chuẩn
    const normalizedLine =
      up(selectedLine) === "TONG HOP" ? "TỔNG HỢP" : up(selectedLine);

    // Nếu user chọn 1 line thì daily vẫn có thể trả đủ các line (sếp nhìn tổng quan).
    // Nếu bạn muốn daily chỉ trả đúng line đang chọn, bật filter:
    const dailyRows = (dailyParsed.dailyRows || []).filter((r) => {
      // hiển thị tất cả khi chọn TỔNG HỢP, còn chọn Cx thì vẫn hiển thị list C1..C10 (tuỳ bạn)
      // Bạn từng nói muốn bỏ thao tác refresh và chỉ hiện ngày đó -> OK, còn filter line thì tuỳ.
      return true;
    });

    const body = {
      ok: true,
      chosenDate,
      lines: lines
        .map((l) => (up(l) === "TONG HOP" ? "TỔNG HỢP" : up(l)))
        .sort((a, b) => lineSortKey(a) - lineSortKey(b)),
      selectedLine: normalizedLine,
      dailyRows,
      hourly: hourlyParsed.hourly,
    };

    if (debug) {
      body._debug = {
        dailySheet,
        hourlySheet,
        titles,
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
      {
        ok: false,
        error: e?.message || "Server error",
      },
      { status: 500 }
    );
  }
}