// app/api/check-kpi/route.js
import { google } from "googleapis";

export const dynamic = "force-dynamic"; // tránh cache route

// ================= helpers =================
const TZ = "Asia/Ho_Chi_Minh";

const noMark = (str) =>
  String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const norm = (v) => noMark(String(v ?? "")).trim();
const normUpper = (v) => norm(v).toUpperCase().replace(/\s+/g, " ");

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;

  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v).trim();
  if (!s) return 0;

  // "1,234" -> 1234 ; "1.234,56" (VN) -> 1234.56 (best effort)
  const cleaned = s
    .replace(/\u00A0/g, " ")
    .replace(/,/g, "")
    .replace(/[^\d.\-]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function colLetterToIndex(letter) {
  const s = String(letter || "").trim().toUpperCase();
  if (!s) return -1;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i) - 64; // A=1
    if (code < 1 || code > 26) return -1;
    n = n * 26 + code;
  }
  return n - 1;
}

function normalizeLine(raw) {
  const s = normUpper(raw);
  // C1 / C01 / C 01 / c-1 ...
  const m = s.match(/^C\D*0*([1-9]|10)$/);
  return m ? `C${m[1]}` : s;
}

function isLineC1toC10(x) {
  return /^C([1-9]|10)$/.test(String(x || ""));
}

function sortLinesC(lines) {
  return [...lines].sort((a, b) => {
    const na = parseInt(String(a).replace(/\D/g, ""), 10);
    const nb = parseInt(String(b).replace(/\D/g, ""), 10);
    return na - nb;
  });
}

function isDateDdMmYyyy(x) {
  const s = String(x ?? "").trim();
  return /^\d{2}\/\d{2}\/\d{4}$/.test(s);
}

function asDateDdMmYyyy(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ }).format(d); // dd/MM/yyyy
}

function isLikelyDmHHeader(x) {
  const t = noMark(String(x ?? ""))
    .toUpperCase()
    .replace(/\s+/g, "");
  return t.includes("DM/H") || t.includes("DMH") || t.includes("ĐM/H") || t.includes("ĐMH");
}

function isHourHeader(x) {
  const s = noMark(String(x ?? "")).toLowerCase().replace(/\s+/g, "");
  // ->9h, ->10h, ->11h, ->12h30, ->13h30, ...
  return s.startsWith("->") && /->\d{1,2}h(\d{2})?$/.test(s);
}

function hourMultiplier(label) {
  // label like "->9h" "->12h30" ...
  const s = noMark(String(label ?? "")).toLowerCase().replace(/\s+/g, "");
  const m = s.match(/->(\d{1,2})h(\d{2})?$/);
  if (!m) return 0;

  const hh = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;

  // quy ước mốc bắt đầu từ 9h = 1 giờ, 10h = 2 giờ, 11h = 3 giờ...
  // (9h là sau 1 giờ làm đầu tiên)
  const base = 9; // ->9h
  const hoursFromBase = hh - base + 1; // 9 => 1, 10 => 2...
  const frac = mm === 30 ? 0.5 : 0;

  return Math.max(0, hoursFromBase + frac);
}

// ================= google sheets =================
function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw) throw new Error("Missing env GOOGLE_SERVICE_ACCOUNT_JSON");

  // hỗ trợ base64 hoặc JSON thẳng
  let jsonText = raw.trim();
  if (!jsonText.startsWith("{")) {
    jsonText = Buffer.from(jsonText, "base64").toString("utf8");
  }
  return JSON.parse(jsonText);
}

async function fetchSheetGrid(spreadsheetId, sheetName) {
  const sa = getServiceAccount();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName, // cả sheet
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return res.data.values || [];
}

// ================= finders =================
function findAllDates(grid) {
  const set = new Set();
  for (const row of grid) {
    for (const cell of row || []) {
      if (isDateDdMmYyyy(cell)) set.add(String(cell).trim());
    }
  }
  // sort tăng dần theo yyyy-mm-dd
  const arr = [...set].sort((a, b) => {
    const [da, ma, ya] = a.split("/").map(Number);
    const [db, mb, yb] = b.split("/").map(Number);
    const ta = new Date(ya, ma - 1, da).getTime();
    const tb = new Date(yb, mb - 1, db).getTime();
    return ta - tb;
  });
  return arr;
}

function findAnchorRowForDate(grid, chosenDate) {
  // tìm hàng có chứa đúng chosenDate
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    if (row.some((c) => String(c ?? "").trim() === chosenDate)) {
      return r;
    }
  }
  return -1;
}

function findLineCol(grid) {
  // tìm cột nào có nhiều C1..C10 nhất (trong 200 hàng đầu)
  const maxRows = Math.min(grid.length, 200);
  let best = { col: 0, score: -1 };

  const maxCols = Math.max(...grid.slice(0, maxRows).map((r) => (r || []).length), 0);

  for (let c = 0; c < maxCols; c++) {
    let score = 0;
    for (let r = 0; r < maxRows; r++) {
      const v = grid[r]?.[c];
      const ln = normalizeLine(v);
      if (isLineC1toC10(ln)) score++;
    }
    if (score > best.score) best = { col: c, score };
  }
  return best.col;
}

function findHourlyBlock(grid) {
  // tìm row có title "THONG KE HIEU SUAT THEO GIO" (không dấu)
  const key = "THONG KE HIEU SUAT THEO GIO";
  let titleRow = -1;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    if (row.some((c) => normUpper(c).includes(key))) {
      titleRow = r;
      break;
    }
  }
  if (titleRow === -1) return { titleRow: -1, headerRow: -1 };

  // headerRow là dòng gần phía dưới có các cột ->9h ->10h...
  for (let r = titleRow; r < Math.min(grid.length, titleRow + 10); r++) {
    const row = grid[r] || [];
    if (row.some((c) => isHourHeader(c))) {
      return { titleRow, headerRow: r };
    }
  }
  return { titleRow, headerRow: -1 };
}

function findDmHColNear(grid, nearRow) {
  let best = { dist: 1e9, col: -1 };

  for (let r = Math.max(0, nearRow - 5); r <= Math.min(grid.length - 1, nearRow + 5); r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (isLikelyDmHHeader(row[c])) {
        const dist = Math.abs(r - nearRow);
        if (dist < best.dist) best = { dist, col: c };
      }
    }
  }

  if (best.col === -1) {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (isLikelyDmHHeader(row[c])) return c;
      }
    }
  }

  return best.col;
}

function findHourCols(headerRow) {
  const cols = [];
  for (let c = 0; c < (headerRow || []).length; c++) {
    if (isHourHeader(headerRow[c])) {
      cols.push({ col: c, label: String(headerRow[c]).trim() });
    }
  }
  // giữ thứ tự trái->phải như sheet
  return cols;
}

// ================= builders =================
function buildDailyRows(grid) {
  // Theo template bạn gửi: HS đạt ở cột S, HS ĐM ở cột T
  // Có thể override bằng ENV:
  // DAILY_HS_DAT_COL=S   DAILY_HS_DM_COL=T
  const envDat = process.env.DAILY_HS_DAT_COL;
  const envDm = process.env.DAILY_HS_DM_COL;

  const hsDatCol = envDat ? colLetterToIndex(envDat) : 18; // S
  const hsDmCol = envDm ? colLetterToIndex(envDm) : 19; // T

  const lineCol = findLineCol(grid);

  const out = [];
  let started = false;
  let emptyStreak = 0;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const lineRaw = row[lineCol];

    if (!lineRaw) {
      if (started) {
        emptyStreak++;
        if (emptyStreak >= 6) break;
      }
      continue;
    }

    const line = normalizeLine(lineRaw);
    if (!isLineC1toC10(line)) {
      if (started) continue;
      continue;
    }

    started = true;
    emptyStreak = 0;

    const hsDat = toNumberSafe(row[hsDatCol]);
    const hsDm = toNumberSafe(row[hsDmCol]);

    out.push({
      line,
      hsDat: Number(hsDat.toFixed(2)),
      hsDm: Number(hsDm.toFixed(2)),
      status: hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT",
    });

    if (out.length >= 10) break;
  }

  const sorted = sortLinesC(out.map((x) => x.line))
    .map((ln) => out.find((x) => x.line === ln))
    .filter(Boolean);

  return sorted;
}

function buildHourly(grid, selectedLine) {
  const { headerRow } = findHourlyBlock(grid);
  if (headerRow === -1) {
    return { line: selectedLine, dmH: 0, hours: [] };
  }

  const header = grid[headerRow] || [];
  const hourCols = findHourCols(header);
  const lineCol = findLineCol(grid);
  const dmHCol = findDmHColNear(grid, headerRow);

  const byLine = new Map(); // line -> {dmH, actualByLabel}

  let emptyStreak = 0;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const lineRaw = row[lineCol];

    if (!lineRaw) {
      emptyStreak++;
      if (emptyStreak >= 10) break;
      continue;
    }
    emptyStreak = 0;

    const line = normalizeLine(lineRaw);
    if (!isLineC1toC10(line)) continue; // bỏ CẮT/HOÀN TẤT/KCS/NM...

    const dmH = dmHCol >= 0 ? toNumberSafe(row[dmHCol]) : 0;

    const actualByLabel = {};
    for (const hc of hourCols) {
      actualByLabel[hc.label] = toNumberSafe(row[hc.col]);
    }

    byLine.set(line, { dmH, actualByLabel });
  }

  // Tổng hợp (sum C1..C10)
  const sum = { dmH: 0, actualByLabel: {} };
  for (const ln of sortLinesC([...byLine.keys()])) {
    const it = byLine.get(ln);
    sum.dmH += it?.dmH || 0;
    for (const hc of hourCols) {
      sum.actualByLabel[hc.label] = (sum.actualByLabel[hc.label] || 0) + (it?.actualByLabel?.[hc.label] || 0);
    }
  }

  const chosen = selectedLine === "TỔNG HỢP" ? sum : (byLine.get(selectedLine) || { dmH: 0, actualByLabel: {} });

  const hours = hourCols.map((hc) => {
    const actual = toNumberSafe(chosen.actualByLabel[hc.label]);
    const mult = hourMultiplier(hc.label);
    const dmCum = toNumberSafe(chosen.dmH) * mult;
    const diff = actual - dmCum;

    return {
      label: hc.label,
      mult,
      actual: Number(actual.toFixed(0)),
      dmCum: Number(dmCum.toFixed(0)),
      diff: Number(diff.toFixed(0)),
      status: diff >= 0 ? "VƯỢT" : "THIẾU",
    };
  });

  return {
    line: selectedLine,
    dmH: Number(toNumberSafe(chosen.dmH).toFixed(2)),
    hours,
  };
}

// ================= API =================
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const qDate = url.searchParams.get("date") || "";
    const qLine = url.searchParams.get("line") || "TỔNG HỢP";

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.KPI_SHEET_NAME || "KPI";

    if (!spreadsheetId) throw new Error("Missing env GOOGLE_SHEET_ID");

    const grid = await fetchSheetGrid(spreadsheetId, sheetName);

    const dates = findAllDates(grid);
    const today = asDateDdMmYyyy(new Date());

    // ưu tiên đúng ngày user chọn; nếu không có thì fallback: hôm nay; nếu vẫn không có thì ngày mới nhất trong sheet
    let chosenDate = qDate.trim();
    if (!chosenDate || !dates.includes(chosenDate)) {
      if (dates.includes(today)) chosenDate = today;
      else chosenDate = dates.length ? dates[dates.length - 1] : (qDate || today);
    }

    // Nếu sheet có nhiều ngày, ta vẫn chỉ show chosenDate ở UI (không show 2 ngày)
    // (anchorRow dùng debug thôi, còn builder hiện tại đọc theo layout chuẩn của sheet)
    const anchorRow = findAnchorRowForDate(grid, chosenDate);

    const dailyRows = buildDailyRows(grid);

    // lines list: C1..C10 + TỔNG HỢP
    const lines = ["TỔNG HỢP", ...sortLinesC(dailyRows.map((x) => x.line))];

    const selectedLine = (qLine || "TỔNG HỢP").toUpperCase().includes("TỔNG") ? "TỔNG HỢP" : normalizeLine(qLine);
    const selectedLineFixed = selectedLine === "TỔNG HỢP" ? "TỔNG HỢP" : (isLineC1toC10(selectedLine) ? selectedLine : "TỔNG HỢP");

    const hourly = buildHourly(grid, selectedLineFixed);

    return new Response(
      JSON.stringify({
        ok: true,
        chosenDate,
        dates: [chosenDate], // chỉ trả 1 ngày để UI khỏi hiện 2 ngày
        lines,
        selectedLine: selectedLineFixed,
        dailyRows,
        hourly,
        _debug: {
          anchorRow,
          dailyCount: dailyRows.length,
          hourlyCount: hourly.hours.length,
        },
      }),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(err?.message || err),
      }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }
    );
  }
}