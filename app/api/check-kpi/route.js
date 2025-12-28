// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { getSheetsClient } from "@/lib/googleSheetsClient";

const CONFIG_SHEET = process.env.KPI_CONFIG_SHEET || "CONFIG_KPI";
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ===== helpers =====
const strip = (s) =>
  String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remove accents

const norm = (s) =>
  strip(s)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const isLikelyLine = (v) => {
  const t = norm(v);
  if (!t) return false;
  // C1..C99, CAT, KCS, HOAN TAT, NM...
  return (
    /^C\d{1,3}$/.test(t) ||
    t === "CAT" ||
    t === "KCS" ||
    t === "HOAN TAT" ||
    t === "NM" ||
    t === "HOÀN TẤT".toUpperCase() // safety
  );
};

const parseNumber = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  // allow "1,08" or "1.08" etc
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const normalizePercent = (v) => {
  // accepts 0.9587, 95.87, "95.87%", "0.9587"
  if (v === null || v === undefined) return null;
  const s = String(v).replace("%", "").trim();
  const n = parseNumber(s);
  if (n === null) return null;
  if (n > 1.5) return n / 100; // 90 => 0.9
  return n; // 0.9 => 0.9
};

const fmtPercent = (x) => {
  if (x === null || x === undefined) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toFixed(2) + "%";
};

function findHeaderRow(values) {
  // search top 6 rows for a row containing CHUYEN or DM/NGAY etc
  const max = Math.min(values.length, 8);
  for (let r = 0; r < max; r++) {
    const row = values[r] || [];
    const joined = norm(row.join(" | "));
    if (
      joined.includes("CHUYEN") ||
      joined.includes("DM/NGAY") ||
      joined.includes("DM/H") ||
      joined.includes("MA HANG") ||
      joined.includes("MÃ HÀNG".toUpperCase())
    ) {
      return r;
    }
  }
  return 0;
}

function findDataStartRow(values, lineColGuess = 0) {
  // find first row that looks like a line name
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    if (isLikelyLine(row[lineColGuess])) return r;
  }
  // fallback: scan any col
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (isLikelyLine(row[c])) return r;
    }
  }
  return 0;
}

function findColByHeader(values, headerRow, candidates) {
  // candidates: array of header keywords already normalized
  const row = values[headerRow] || [];
  for (let c = 0; c < row.length; c++) {
    const cell = norm(row[c]);
    if (!cell) continue;
    for (const k of candidates) {
      if (cell === k) return c;
    }
  }
  // second pass: contains
  for (let c = 0; c < row.length; c++) {
    const cell = norm(row[c]);
    if (!cell) continue;
    for (const k of candidates) {
      if (cell.includes(k)) return c;
    }
  }
  return -1;
}

function detectHourCols(values, headerRow) {
  const row = values[headerRow] || [];
  const cols = [];
  for (let c = 0; c < row.length; c++) {
    const raw = String(row[c] ?? "").trim();
    const t = norm(raw);
    // Match ->9h, ->10h, ->12h30, ...
    if (/^->\s*\d{1,2}H(\d{1,2})?$/.test(t.replace(/\s+/g, ""))) {
      const key = t.replace(/\s+/g, "").replace("->", "M"); // "M9H" etc
      cols.push({ col: c, label: raw, key });
    }
  }
  return cols;
}

function getBadgeClass(status) {
  const s = norm(status);
  if (s === "VUOT" || s === "DU" || s === "DAT") return "good";
  if (s === "THIEU" || s === "CHUA DAT" || s === "CHUA CO") return "bad";
  return "na";
}

function calcHourlyStatus(diff, step) {
  if (diff === null) return "N/A";
  // tolerance: 1 sp or 2% of step
  const tol = Math.max(1, Math.round((step ?? 0) * 0.02));
  if (diff >= 0) return "VƯỢT";
  if (diff >= -tol) return "ĐỦ";
  return "THIẾU";
}

// ===== main =====
export async function GET(req) {
  try {
    if (!SHEET_ID) {
      return NextResponse.json(
        { ok: false, error: "Missing GOOGLE_SHEET_ID" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const dateQuery = (searchParams.get("date") || "").trim(); // dd/mm/yyyy

    const sheets = await getSheetsClient();

    // Read CONFIG_KPI A:B by header
    const cfgRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_SHEET}!A:B`,
    });

    const cfg = cfgRes.data.values || [];
    if (cfg.length < 2) {
      return NextResponse.json(
        { ok: false, error: `CONFIG sheet ${CONFIG_SHEET} is empty` },
        { status: 500 }
      );
    }

    const header = cfg[0] || [];
    const dateCol = header.findIndex((x) => norm(x) === "DATE");
    const rangeCol = header.findIndex((x) => norm(x) === "RANGE");

    if (dateCol < 0 || rangeCol < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `CONFIG_KPI must have header DATE and RANGE (row 1). Found: ${header.join(
            ", "
          )}`,
        },
        { status: 500 }
      );
    }

    const availableDates = [];
    const mapDateToRange = new Map();

    for (let i = 1; i < cfg.length; i++) {
      const row = cfg[i] || [];
      const d = String(row[dateCol] ?? "").trim();
      const r = String(row[rangeCol] ?? "").trim();
      if (!d || !r) continue;
      availableDates.push(d);
      mapDateToRange.set(d, r);
    }

    if (availableDates.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No DATE/RANGE rows in CONFIG_KPI" },
        { status: 500 }
      );
    }

    const date = dateQuery && mapDateToRange.has(dateQuery)
      ? dateQuery
      : availableDates[availableDates.length - 1]; // default latest row

    const dataRange = mapDateToRange.get(date);

    // Read KPI range
    const kpiRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: dataRange,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const values = kpiRes.data.values || [];
    if (!values.length) {
      return NextResponse.json(
        {
          ok: true,
          date,
          dataRange,
          availableDates,
          marks: [],
          lines: [],
          warning: "KPI range returned empty",
        },
        { status: 200 }
      );
    }

    const headerRow = findHeaderRow(values);

    // detect key columns
    const lineCol = findColByHeader(values, headerRow, ["CHUYEN", "CHUYỀN".toUpperCase()]);
    const maHangCol = findColByHeader(values, headerRow, ["MA HANG", "MÃ HÀNG".toUpperCase()]);
    const dmNgayCol = findColByHeader(values, headerRow, ["DM/NGAY", "DM NGAY", "DM/NGÀY".toUpperCase()]);
    const dmHCol = findColByHeader(values, headerRow, ["DM/H", "DM H"]);

    // Hour marks columns
    const hourCols = detectHourCols(values, headerRow);

    // Determine data start row
    const dataStart = findDataStartRow(values, lineCol >= 0 ? lineCol : 0);

    // Build marks
    const marks = hourCols.map((m) => ({ key: m.key, label: m.label, col: m.col }));

    // Parse each line row
    const lines = [];
    for (let r = dataStart; r < values.length; r++) {
      const row = values[r] || [];
      const lineName = String(row[lineCol >= 0 ? lineCol : 0] ?? "").trim();
      if (!isLikelyLine(lineName)) continue;

      const maHang = maHangCol >= 0 ? String(row[maHangCol] ?? "").trim() : "";

      const dmNgay = dmNgayCol >= 0 ? parseNumber(row[dmNgayCol]) : null;
      const dmHour = dmHCol >= 0 ? parseNumber(row[dmHCol]) : null;

      // actual hourly cumulative
      const hourly = {};
      for (const m of marks) {
        hourly[m.key] = parseNumber(row[m.col]);
      }

      // determine step (prefer dmHour, else dmNgay/marksCount)
      const marksCount = marks.length || 8;
      const step =
        (dmHour && dmHour > 0)
          ? dmHour
          : (dmNgay && dmNgay > 0 && marksCount > 0)
          ? dmNgay / marksCount
          : null;

      // expected cumulative + diff + status
      const expected = {};
      const diff = {};
      const hourlyStatus = {};
      for (let i = 0; i < marks.length; i++) {
        const mk = marks[i].key;
        if (step === null) {
          expected[mk] = null;
          diff[mk] = null;
          hourlyStatus[mk] = "N/A";
          continue;
        }
        expected[mk] = Math.round(step * (i + 1));
        const a = hourly[mk];
        diff[mk] = a === null ? null : a - expected[mk];
        hourlyStatus[mk] = calcHourlyStatus(diff[mk], step);
      }

      // daily efficiency from last mark
      const lastMarkKey = marks.length ? marks[marks.length - 1].key : null;
      const lastActual = lastMarkKey ? hourly[lastMarkKey] : null;

      const hsTarget = 0.9;
      const hsDay =
        (lastActual !== null && dmNgay && dmNgay > 0)
          ? lastActual / dmNgay
          : null;

      let hsStatus = "CHƯA CÓ";
      if (hsDay !== null) {
        if (hsDay >= 1) hsStatus = "VƯỢT";
        else if (hsDay >= hsTarget) hsStatus = "ĐẠT";
        else hsStatus = "CHƯA ĐẠT";
      }

      lines.push({
        line: lineName,
        maHang: maHang || null,
        dmNgay: dmNgay ?? null,
        dmHour: dmHour ?? null,
        hsDay: hsDay ?? null,
        hsTarget,
        hsStatus,
        hsBadge: getBadgeClass(hsStatus),
        hourly,
        expected,
        diff,
        hourlyStatus,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      dataRange,
      availableDates,
      marks: marks.map(({ key, label }) => ({ key, label })),
      lines,
      debug: {
        headerRow,
        dataStart,
        lineCol,
        maHangCol,
        dmNgayCol,
        dmHCol,
        marksCount: marks.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
