// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { getValues } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";
const RANGE = `${SHEET_NAME}!A1:ZZ300`;

// ===== helpers =====
const s = (v) => (v === null || v === undefined ? "" : String(v));
const trim = (v) => s(v).trim();
const noMark = (str) => s(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const normKey = (str) => noMark(str).toUpperCase().replace(/\s+/g, " ").trim();

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  const t = s(v).trim();
  if (!t) return 0;

  // 1,234.56  /  1.234,56  /  95.87%
  const cleaned = t
    .replace("%", "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "") // remove thousand dots: 1.234 -> 1234
    .replace(/,(?=\d{3}\b)/g, "")  // remove thousand commas
    .replace(",", ".");            // decimal comma -> dot

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function fmt2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function isLineKeep(line) {
  const t = trim(line).toUpperCase();
  if (t === "TỔNG HỢP" || t === "TONG HOP") return true;
  // chỉ giữ C1..C99
  return /^C\d{1,2}$/.test(t);
}

function naturalLineSort(a, b) {
  const A = trim(a).toUpperCase();
  const B = trim(b).toUpperCase();
  if (A === "TỔNG HỢP" || A === "TONG HOP") return -1;
  if (B === "TỔNG HỢP" || B === "TONG HOP") return 1;

  const ma = A.match(/^C(\d{1,2})$/);
  const mb = B.match(/^C(\d{1,2})$/);
  const na = ma ? Number(ma[1]) : 9999;
  const nb = mb ? Number(mb[1]) : 9999;
  return na - nb;
}

function mapHeaderRow(values) {
  // tìm dòng header có chứa "CHUYEN" hoặc "CHUYEN/BP"
  for (let r = 0; r < Math.min(values.length, 20); r++) {
    const row = values[r] || [];
    const keys = row.map((c) => normKey(c));
    if (keys.includes("CHUYEN") || keys.includes("CHUYEN/BP") || keys.includes("CHUYỀN") || keys.includes("CHUYỀN/BP")) {
      const map = new Map();
      keys.forEach((k, idx) => {
        if (k && !map.has(k)) map.set(k, idx);
      });
      return { headerRowIndex: r, headerMap: map, headerKeys: keys };
    }
  }
  return { headerRowIndex: -1, headerMap: new Map(), headerKeys: [] };
}

function getCol(headerMap, ...names) {
  for (const n of names) {
    const k = normKey(n);
    if (headerMap.has(k)) return headerMap.get(k);
  }
  return -1;
}

function ddmmyyyyFromISO(iso) {
  // iso: yyyy-mm-dd
  const m = s(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizeInputDate(dateStr) {
  // chấp nhận dd/MM/yyyy hoặc yyyy-MM-dd
  const t = trim(dateStr);
  if (!t) return "";

  // yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return ddmmyyyyFromISO(t);

  // dd/MM/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;

  return "";
}

function hourMultiplier(label) {
  // mapping cho DM lũy tiến = DM/H * số mốc giờ
  const m = {
    "->9h": 1,
    "->10h": 2,
    "->11h": 3,
    "->12h30": 4.5,
    "->13h30": 5.5,
    "->14h30": 6.5,
    "->15h30": 7.5,
    "->16h30": 8,
  };
  return m[label] ?? 0;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const dateQ = normalizeInputDate(url.searchParams.get("date") || "");
    const lineQ = trim(url.searchParams.get("line") || "TỔNG HỢP");

    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || "";

    if (!spreadsheetId) {
      return NextResponse.json(
        { ok: false, error: "Missing env GOOGLE_SHEET_ID" },
        { status: 500 }
      );
    }

    const values = await getValues({ spreadsheetId, range: RANGE });
    if (!values.length) {
      return NextResponse.json({ ok: true, chosenDate: dateQ, lines: [], dailyRows: [], hourly: null });
    }

    const { headerRowIndex, headerMap } = mapHeaderRow(values);
    if (headerRowIndex < 0) {
      return NextResponse.json(
        { ok: false, error: "Không tìm thấy header CHUYEN/CHUYEN/BP trong sheet KPI" },
        { status: 400 }
      );
    }

    const dataRows = values.slice(headerRowIndex + 1);

    // ===== column detection =====
    const colDate = getCol(headerMap, "NGAY", "NGÀY", "DATE");
    const colLine = getCol(headerMap, "CHUYEN", "CHUYỀN", "CHUYEN/BP", "CHUYỀN/BP");
    const colDmH = getCol(headerMap, "DM/H", "DMH");
    const colDmDay = getCol(headerMap, "DM/NGAY", "DM/NGÀY", "DM NGAY", "DM NGÀY");
    const colAfter1630 = getCol(headerMap, "AFTER 16H30", "AFTER16H30", "16H30", "SAU 16H30");
    const colHsDat = getCol(headerMap, "HS DAT", "HS ĐẠT", "HSDAT", "TY LE HIEU SUAT TRONG NGAY", "TY LE HIEU SUAT");
    const colHsDm = getCol(headerMap, "HS DM", "HS ĐM", "HSDM", "DINH MUC TRONG NGAY", "ĐỊNH MỨC TRONG NGÀY");

    // hour columns (cộng dồn)
    const hourCols = [
      ["->9h", getCol(headerMap, "->9H", "9H", ">9H")],
      ["->10h", getCol(headerMap, "->10H", "10H", ">10H")],
      ["->11h", getCol(headerMap, "->11H", "11H", ">11H")],
      ["->12h30", getCol(headerMap, "->12H30", "12H30", ">12H30")],
      ["->13h30", getCol(headerMap, "->13H30", "13H30", ">13H30")],
      ["->14h30", getCol(headerMap, "->14H30", "14H30", ">14H30")],
      ["->15h30", getCol(headerMap, "->15H30", "15H30", ">15H30")],
      ["->16h30", getCol(headerMap, "->16H30", "16H30", ">16H30")],
    ].filter(([, idx]) => idx >= 0);

    // ===== filter by date if date column exists =====
    const filteredRows = dataRows.filter((r) => {
      if (colLine < 0) return false;
      const line = trim(r[colLine]);
      if (!isLineKeep(line)) return false;

      if (colDate >= 0 && dateQ) {
        const d = trim(r[colDate]);
        // dd/MM/yyyy expected
        return d === dateQ;
      }
      return true;
    });

    // ===== build list lines =====
    const lines = [...new Set(filteredRows.map((r) => trim(r[colLine]).toUpperCase()))].sort(naturalLineSort);

    // ===== daily rows (all lines) =====
    const dailyRows = filteredRows
      .map((r) => {
        const line = trim(r[colLine]).toUpperCase();

        let hsDatPct = 0;
        if (colHsDat >= 0) {
          hsDatPct = toNumberSafe(r[colHsDat]);
          // nếu nó là dạng 0.9587 thì đổi sang %
          if (hsDatPct > 0 && hsDatPct <= 1.2) hsDatPct *= 100;
        } else if (colAfter1630 >= 0 && colDmDay >= 0) {
          const after = toNumberSafe(r[colAfter1630]);
          const dmDay = toNumberSafe(r[colDmDay]);
          hsDatPct = dmDay > 0 ? (after / dmDay) * 100 : 0;
        }

        let hsDmPct = 0;
        if (colHsDm >= 0) {
          hsDmPct = toNumberSafe(r[colHsDm]);
          if (hsDmPct > 0 && hsDmPct <= 1.2) hsDmPct *= 100;
        } else {
          // fallback: nếu bạn chưa có cột HS ĐM, tạm lấy 100
          hsDmPct = 100;
        }

        const status = hsDatPct >= hsDmPct ? "ĐẠT" : "CHƯA ĐẠT";

        return {
          line,
          hsDat: Number(fmt2(hsDatPct)),
          hsDm: Number(fmt2(hsDmPct)),
          status,
        };
      })
      .sort((a, b) => naturalLineSort(a.line, b.line));

    // ===== selected line hourly =====
    const selectedLine = lineQ ? lineQ.toUpperCase() : "TỔNG HỢP";
    const picked = filteredRows.find((r) => trim(r[colLine]).toUpperCase() === selectedLine) || null;

    let hourly = null;
    if (picked && colDmH >= 0 && hourCols.length) {
      const dmH = toNumberSafe(picked[colDmH]);

      const hours = hourCols.map(([label, idx]) => {
        const total = toNumberSafe(picked[idx]);
        const mult = hourMultiplier(label);
        const dmTarget = dmH * mult;
        const diff = total - dmTarget;

        let status = "ĐỦ";
        if (diff > 0.00001) status = "VƯỢT";
        else if (diff < -0.00001) status = "THIẾU";

        return {
          label,
          total: Number(fmt2(total)),
          dmTarget: Number(fmt2(dmTarget)),
          diff: Number(fmt2(diff)),
          status,
        };
      });

      hourly = { line: selectedLine, dmH: Number(fmt2(dmH)), hours };
    }

    return NextResponse.json({
      ok: true,
      chosenDate: dateQ,
      lines,
      dailyRows,
      hourly,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}