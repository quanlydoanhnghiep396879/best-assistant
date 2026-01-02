
// app/api/check-kpi/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// ====== IMPORT googleSheetsClient (tùy bạn export kiểu gì, mình bắt hết) ======
async function getSheetsClient() {
  const lib = await import("../_lib/googleSheetsClient");

  // Các kiểu export thường gặp:
  // 1) export default sheets
  // 2) export const sheets = ...
  // 3) export function getSheets() { return sheets }
  const client =
    lib.sheets ||
    lib.default ||
    (typeof lib.getSheets === "function" ? lib.getSheets() : null) ||
    (typeof lib.getSheetsClient === "function" ? lib.getSheetsClient() : null);

  // Validate shape
  if (!client?.spreadsheets?.values?.get) {
    throw new Error(
      "googleSheetsClient không đúng kiểu. Cần có client.spreadsheets.values.get(...)"
    );
  }
  return client;
}

// ====== helpers ======
const noMark = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();

const norm = (s) => String(s ?? "").replace(/\u00A0/g, " ").trim();

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normLine(x) {
  const t = norm(x).toUpperCase();
  if (t === "TONG HOP" || t === "TỔNG HỢP") return "TỔNG HỢP";
  const m = t.match(/^C\s*0*([0-9]+)$/);
  if (m) return `C${Number(m[1])}`;
  return t;
}

function sortLines(a, b) {
  const A = normLine(a);
  const B = normLine(b);

  if (A === "TỔNG HỢP" && B !== "TỔNG HỢP") return -1;
  if (B === "TỔNG HỢP" && A !== "TỔNG HỢP") return 1;

  const ma = A.match(/^C(\d+)$/);
  const mb = B.match(/^C(\d+)$/);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  if (ma && !mb) return -1;
  if (!ma && mb) return 1;

  return A.localeCompare(B, "vi");
}

function statusDaily(hsDat, hsDm) {
  return hsDat >= hsDm ? "ĐẠT" : "CHƯA ĐẠT";
}

function statusHourly(delta) {
  if (delta > 0) return "VƯỢT";
  if (delta === 0) return "ĐỦ";
  return "THIẾU";
}

// ====== Read first sheet values safely ======
async function getSheetTitles(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter(Boolean);
  return titles;
}

function pickSheetTitle(titles, preferRegexList) {
  for (const rx of preferRegexList) {
    const hit = titles.find((t) => rx.test(noMark(t)));
    if (hit) return hit;
  }
  return titles[0] || "";
}

// ====== Parse DAILY table (flexible) ======
// Kỳ vọng bảng dạng: cột có "chuyền/bp", "hs đạt", "hs đm" (không nhất thiết đúng chính tả)
function parseDaily(values) {
  // tìm header row có chứa "chuyền" và "hs"
  let headerRow = -1;
  for (let i = 0; i < Math.min(values.length, 40); i++) {
    const row = values[i] || [];
    const rowText = noMark(row.join(" | "));
    if (rowText.includes("chuyen") && rowText.includes("hs")) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    return { rows: [], debug: { foundDailyAnchor: false, headerRow: -1 } };
  }

  const header = (values[headerRow] || []).map(noMark);
  const idxLine =
    header.findIndex((x) => x.includes("chuyen")) >= 0
      ? header.findIndex((x) => x.includes("chuyen"))
      : 0;

  const idxHsDat = header.findIndex((x) => x.includes("hs") && x.includes("dat"));
  const idxHsDm =
    header.findIndex((x) => x.includes("hs") && (x.includes("dm") || x.includes("dinh muc"))) ||
    header.findIndex((x) => x.includes("dm"));

  if (idxHsDat < 0 || idxHsDm < 0) {
    return {
      rows: [],
      debug: { foundDailyAnchor: true, headerRow, idxLine, idxHsDat, idxHsDm },
    };
  }

  const out = [];
  for (let r = headerRow + 1; r < values.length; r++) {
    const row = values[r] || [];
    const line = normLine(row[idxLine]);
    if (!line) continue;

    // stop condition: gặp dòng trống dài / footer
    const rowStr = noMark(row.join(" "));
    if (rowStr.includes("logic")) break;

    const hsDat = toNumberSafe(row[idxHsDat]);
    const hsDm = toNumberSafe(row[idxHsDm]);

    // bỏ BP không muốn (cắt/hoàn tất/kcs/nm) nếu có
    const ban = new Set(["CẮT", "HOÀN TẤT", "KCS", "NM"]);
    if (ban.has(line)) continue;

    out.push({
      line,
      hsDat,
      hsDm,
      status: statusDaily(hsDat, hsDm),
    });
  }

  out.sort((a, b) => sortLines(a.line, b.line));

  // thêm TỔNG HỢP nếu chưa có
  if (!out.find((x) => x.line === "TỔNG HỢP")) {
    // không bắt buộc
  }

  return { rows: out, debug: { foundDailyAnchor: true, headerRow, idxLine, idxHsDat, idxHsDm } };
}

// ====== Parse HOURLY table (flexible) ======
// Kỳ vọng bảng có cột "giờ" + "tổng" + "dm/h" hoặc "dm lũy tiến"...
function parseHourly(values) {
  let headerRow = -1;
  for (let i = 0; i < Math.min(values.length, 80); i++) {
    const rowText = noMark((values[i] || []).join(" | "));
    if (rowText.includes("gio") && (rowText.includes("tong") || rowText.includes("kiem"))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    return { hourly: { dmH: 0, hours: [] }, debug: { foundHourlyAnchor: false, headerRow: -1 } };
  }

  const header = (values[headerRow] || []).map(noMark);

  const idxLabel = header.findIndex((x) => x.includes("gio"));
  const idxTotal = header.findIndex((x) => x.includes("tong"));
  // dm lũy tiến có thể nằm ở cột "dm luy tien" hoặc "dm lũy tiến"
  const idxDmLuy = header.findIndex((x) => x.includes("dm") && x.includes("luy"));
  const idxDiff =
    header.findIndex((x) => x.includes("chenh")) >= 0
      ? header.findIndex((x) => x.includes("chenh"))
      : -1;

  // dm/h có thể nằm ở góc khác => mình sẽ suy ra bằng dmLuy ở mốc 1 giờ nếu có
  const hours = [];

  for (let r = headerRow + 1; r < values.length; r++) {
    const row = values[r] || [];
    const label = norm(row[idxLabel]);
    if (!label) continue;

    // stop when footer
    const rowStr = noMark(row.join(" "));
    if (rowStr.includes("logic")) break;

    const total = toNumberSafe(row[idxTotal]);
    const dmLuyTien = idxDmLuy >= 0 ? toNumberSafe(row[idxDmLuy]) : 0;
    let delta = idxDiff >= 0 ? toNumberSafe(row[idxDiff]) : total - dmLuyTien;

    // loại row toàn 0 (thường do parse sai sheet)
    // nhưng vẫn giữ nếu label hợp lệ & dmLuyTien có
    if (total === 0 && dmLuyTien === 0) continue;

    hours.push({
      label,
      total,
      dmLuyTien,
      delta,
      status: statusHourly(delta),
    });
  }

  // suy ra dmH từ row đầu (nếu có dmLuyTien)
  const dmH = hours.length ? (hours[0].dmLuyTien ? hours[0].dmLuyTien : 0) : 0;

  return { hourly: { dmH, hours }, debug: { foundHourlyAnchor: true, headerRow, idxLabel, idxTotal, idxDmLuy, idxDiff } };
}

/* ===================== GET ===================== */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || ""; // dd/mm/yyyy
    const lineQ = normLine(searchParams.get("line") || "TỔNG HỢP");
    const debug = searchParams.get("debug") === "1";
    const raw = searchParams.get("raw") === "1";

    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID ||
      process.env.SPREADSHEET_ID ||
      process.env.GOOGLE_SPREADSHEET_ID ||
      "";

    if (!spreadsheetId) {
      return NextResponse.json(
        { ok: false, error: "Missing env GOOGLE_SHEET_ID (hoặc SPREADSHEET_ID)" },
        { status: 400 }
      );
    }

    const sheets = await getSheetsClient();
    const titles = await getSheetTitles(sheets, spreadsheetId);

    // auto pick sheet names (bạn đổi tên tab vẫn chạy tốt hơn)
    const dailySheet = pickSheetTitle(titles, [
      /kpi/,
      /hieu suat/,
      /suat dat/,
    ]);

    const hourlySheet = pickSheetTitle(titles, [
      /thong ke.*gio/,
      /gio.*ngay/,
      /luy tien/,
    ]);

    const dailyRange = `'${dailySheet}'!A:ZZ`;
    const hourlyRange = `'${hourlySheet}'!A:ZZ`;

    const [dailyRes, hourlyRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: dailyRange }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: hourlyRange }),
    ]);

    const dailyValues = dailyRes.data.values || [];
    const hourlyValues = hourlyRes.data.values || [];

    // raw mode: xem 20 dòng đầu để biết sheet có đọc được không
    if (raw) {
      return NextResponse.json({
        ok: true,
        date,
        line: lineQ,
        titles,
        dailySheet,
        hourlySheet,
        dailyPreview: dailyValues.slice(0, 20),
        hourlyPreview: hourlyValues.slice(0, 20),
      });
    }

    const dailyParsed = parseDaily(dailyValues);
    const hourlyParsed = parseHourly(hourlyValues);

    // lines list: lấy từ dailyRows
    const lines = Array.from(new Set(dailyParsed.rows.map((x) => x.line))).sort(sortLines);

    // filter theo line nếu user chọn Cx (còn TỔNG HỢP thì giữ hết)
    const dailyRows =
      lineQ === "TỔNG HỢP" ? dailyParsed.rows : dailyParsed.rows.filter((x) => x.line === lineQ);

    const hourly =
      lineQ === "TỔNG HỢP"
        ? hourlyParsed.hourly
        : hourlyParsed.hourly; // (giờ thường là 1 line; nếu bạn có data theo line thì sẽ xử lý phía sheet/logic sau)

    const out = {
      ok: true,
      chosenDate: date,
      selectedLine: lineQ,
      lines: ["TỔNG HỢP", ...lines.filter((x) => x !== "TỔNG HỢP")],
      dailyRows,
      hourly,
    };

    if (debug) {
      out._debug = {
        spreadsheetId: spreadsheetId ? "**set**" : "",
        sheetTitles: titles,
        dailySheet,
        hourlySheet,
        dailyRange,
        hourlyRange,
        valuesRows: { daily: dailyValues.length, hourly: hourlyValues.length },
        dailyParse: dailyParsed.debug,
        hourlyParse: hourlyParsed.debug,
      };
    }

    return NextResponse.json(out, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
