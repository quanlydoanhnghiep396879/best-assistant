// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { getSheetsClient } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID; // bạn đang dùng biến này
const CONFIG_SHEET_NAME = "CONFIG_KPI";
const KPI_TARGET_PERCENT = 90; // HS định mức hiển thị 90%

// Thứ tự mốc giờ chuẩn dashboard
const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];
const MARK_HOURS = {
  "->9h": 1,
  "->10h": 2,
  "->11h": 3,
  "->12h30": 4,
  "->13h30": 5,
  "->14h30": 6,
  "->15h30": 7,
  "->16h30": 8,
};

function stripDiacritics(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function norm(s) {
  return stripDiacritics(String(s || ""))
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\w->]/g, ""); // giữ lại chữ/số/_ và "->"
}

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function asText(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function standardizeMarkLabel(raw) {
  // Ví dụ: "-> 9h" "->9 h" "->12h30"
  const t = String(raw || "").replace(/\s+/g, "");
  const m = t.match(/->\d{1,2}h(\d{2})?/i);
  return m ? m[0].toLowerCase() : null;
}

function buildColumnSignatures(values, headerScanRows = 6) {
  // Gộp nhiều dòng header theo cột: colSig[j] = "dong1|dong2|dong3..."
  const rows = Math.min(headerScanRows, values.length);
  const maxCols = Math.max(...values.map((r) => (r ? r.length : 0)), 0);

  const sig = Array.from({ length: maxCols }, () => []);
  for (let i = 0; i < rows; i++) {
    const row = values[i] || [];
    for (let j = 0; j < maxCols; j++) {
      const cell = asText(row[j]);
      if (!cell) continue;
      const n = norm(cell);
      if (!n) continue;
      sig[j].push(n);
    }
  }
  return sig.map((parts) => Array.from(new Set(parts)).join("|"));
}

function findColBySig(colSigs, predicates) {
  // predicates: array of (sig)=>boolean
  for (let j = 0; j < colSigs.length; j++) {
    const sig = colSigs[j] || "";
    if (!sig) continue;
    const ok = predicates.every((fn) => fn(sig));
    if (ok) return j;
  }
  return -1;
}

function looksLikeLineLabel(v) {
  const t = asText(v).toUpperCase();
  if (!t) return false;
  // C1..C99, CẮT, KCS, HOÀN TẤT, NM
  if (/^C\d{1,2}$/.test(t)) return true;
  if (t === "CẮT" || t === "CAT") return true;
  if (t === "KCS") return true;
  if (t.includes("HOÀN") || t.includes("HOAN")) return true;
  if (t === "NM") return true;
  return false;
}

function findFirstDataRow(values, lineCol) {
  // tìm dòng đầu tiên có dạng C1/C2... ở cột lineCol
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    if (looksLikeLineLabel(row[lineCol])) return i;
  }
  return -1;
}

function parseKpiTable(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { lines: [], marks: MARKS };
  }

  const colSigs = buildColumnSignatures(values, 6);

  // Nếu không tìm thấy "chuyền" thì default cột 0 (sheet của bạn cột A chính là chuyền)
  let colLine = findColBySig(colSigs, [(s) => s.includes("chuyen")]);
  if (colLine === -1) colLine = 0;

  // Mã hàng: có thể nằm dưới header "MÃHÀNG" hoặc "MH"
  const colItem = findColBySig(colSigs, [
    (s) => s.includes("mahang") || s.includes("mahàng") || s.includes("mh"),
  ]);

  // DM/NGÀY và DM/H: header thường là "đm/ngày" + "dm/h" hoặc có dòng dưới là "DM" "H"
  const colDmDay = findColBySig(colSigs, [
    (s) => s.includes("dmngay") || (s.includes("dm") && s.includes("ngay")),
  ]);
  const colDmHour = findColBySig(colSigs, [
    (s) => s.includes("dmh") || (s.includes("dm") && (s.includes("/h") || s.includes("h"))),
  ]);

  // Hour columns: tìm các cột có mark ->9h...
  const markCols = {};
  for (let j = 0; j < colSigs.length; j++) {
    const rawSig = colSigs[j] || "";
    if (!rawSig) continue;

    // Sig có thể chứa nhiều phần, thử tách ra rồi match mark
    const parts = rawSig.split("|");
    for (const p of parts) {
      const maybe = standardizeMarkLabel(p);
      if (maybe && MARKS.includes(maybe)) {
        markCols[maybe] = j;
      }
    }
  }

  const startRow = findFirstDataRow(values, colLine);
  if (startRow === -1) {
    return {
      lines: [],
      marks: MARKS,
      debug: { reason: "Không tìm thấy dòng dữ liệu (C1/C2...)", colLine, colItem, colDmDay, colDmHour },
    };
  }

  const lines = [];
  for (let i = startRow; i < values.length; i++) {
    const row = values[i] || [];
    const line = asText(row[colLine]).toUpperCase();
    if (!looksLikeLineLabel(line)) continue;

    const itemCode = colItem >= 0 ? asText(row[colItem]) : "";
    const dmDay = colDmDay >= 0 ? toNumberOrNull(row[colDmDay]) : null;
    const dmHour = colDmHour >= 0 ? toNumberOrNull(row[colDmHour]) : null;

    // hourly actual (lũy tiến) – nếu ô trống thì để null (để UI hiển thị —)
    const hourly = {};
    for (const m of MARKS) {
      const c = markCols[m];
      hourly[m] = c !== undefined ? toNumberOrNull(row[c]) : null;
    }

    // lấy mốc cuối có dữ liệu (không null)
    let lastValue = null;
    for (let k = MARKS.length - 1; k >= 0; k--) {
      const v = hourly[MARKS[k]];
      if (v !== null && v !== undefined) {
        lastValue = v;
        break;
      }
    }

    const hsDatPercent =
      dmDay && lastValue !== null ? (lastValue / dmDay) * 100 : null;

    let dayStatus = "CHƯA CÓ";
    if (hsDatPercent !== null) {
      dayStatus = hsDatPercent >= 100 ? "ĐẠT" : "CHƯA ĐẠT";
    }

    // build hourly compare rows for UI
    const hourlyRows = MARKS.map((m) => {
      const actual = hourly[m];
      const planned = dmHour ? dmHour * (MARK_HOURS[m] || 0) : null;
      const diff = actual !== null && planned !== null ? actual - planned : null;

      let st = "N/A";
      if (diff !== null) {
        if (diff > 0) st = "VƯỢT";
        else if (diff === 0) st = "ĐỦ";
        else st = "THIẾU";
      }
      return {
        mark: m,
        actual,
        planned,
        diff,
        status: st,
      };
    });

    lines.push({
      line,
      itemCode: itemCode || null,
      dmDay,
      dmHour,
      hsTargetPercent: KPI_TARGET_PERCENT,
      hsDatPercent,
      dayStatus,
      hourlyRows,
      hourly, // nếu bạn cần raw
    });
  }

  return {
    lines,
    marks: MARKS,
    debug: { colLine, colItem, colDmDay, colDmHour, markCols },
  };
}

async function readSheetValues(sheets, range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return res.data.values || [];
}

function findRangeForDate(configValues, dateStr) {
  // configValues: [ [DATE, RANGE], ... ]
  // dateStr: "24/12/2025"
  const want = String(dateStr || "").trim();
  if (!want) return null;

  for (let i = 1; i < configValues.length; i++) {
    const row = configValues[i] || [];
    const d = String(row[0] || "").trim();
    const r = String(row[1] || "").trim();
    if (d === want && r) return r;
  }
  return null;
}

export async function GET(req) {
  try {
    if (!SPREADSHEET_ID) {
      return NextResponse.json({ error: "Missing GOOGLE_SHEET_ID" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim(); // dd/MM/yyyy từ UI

    const sheets = await getSheetsClient();

    // 1) đọc config để lấy range theo ngày
    const config = await readSheetValues(sheets, `${CONFIG_SHEET_NAME}!A:B`);
    const range = findRangeForDate(config, date);

    if (!range) {
      return NextResponse.json(
        { error: `Không tìm thấy RANGE cho ngày ${date} trong ${CONFIG_SHEET_NAME}`, date },
        { status: 404 }
      );
    }

    // 2) đọc KPI theo range
    const values = await readSheetValues(sheets, range);

    // 3) parse
    const parsed = parseKpiTable(values);

    return NextResponse.json({
      date,
      range,
      ...parsed,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
