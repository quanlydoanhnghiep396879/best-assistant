import { NextResponse } from "next/server";
import { readRange } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];
const MARK_HOURS = { "->9h": 1, "->10h": 2, "->11h": 3, "->12h30": 4, "->13h30": 5, "->14h30": 6, "->15h30": 7, "->16h30": 8 };

function keyOf(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isLineCode(v) {
  const k = keyOf(v);
  if (!k) return false;
  if (/^c\d+$/.test(k)) return true;
  if (k === "cat" || k === "kcs" || k === "hoantat" || k === "nm") return true;
  return false;
}

function asNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s+/g, "");
  if (!s) return null;

  // nếu dạng "2.755" (nghìn) => 2755
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  // nếu dạng "95,87" => 95.87
  if (/^\d+,\d+$/.test(s)) return Number(s.replace(",", "."));

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function asPercent(v) {
  const n = asNumber(v);
  if (n === null) return null;
  // nếu sheet trả 0.9587 => OK
  if (n >= 0 && n <= 1.5) return n;
  // nếu trả 95.87 => /100
  if (n > 1.5 && n <= 200) return n / 100;
  return null;
}

function findHeaderRow(values) {
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const keys = row.map(keyOf);
    const hit = MARKS.some((m) => keys.includes(keyOf(m)));
    if (hit) return r;
  }
  return -1;
}

function findColByIncludes(headerRow, includesKeys) {
  for (let c = 0; c < headerRow.length; c++) {
    const k = keyOf(headerRow[c]);
    if (!k) continue;
    if (includesKeys.some((x) => k.includes(x))) return c;
  }
  return -1;
}

function detectLineCol(values, headerRowIdx) {
  const start = headerRowIdx + 1;
  const end = Math.min(values.length, headerRowIdx + 40);

  let maxCols = 0;
  for (const r of values) maxCols = Math.max(maxCols, (r || []).length);

  let best = 0;
  let bestHits = 0;

  for (let c = 0; c < maxCols; c++) {
    let hits = 0;
    for (let r = start; r < end; r++) {
      if (isLineCode(values[r]?.[c])) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = c;
    }
  }
  return bestHits >= 2 ? best : 0;
}

function buildStatusBadgeText(type, diff) {
  // type: "hourly" or "day"
  if (type === "hourly") {
    if (diff === null) return "N/A";
    if (diff < 0) return "THIẾU";
    if (diff === 0) return "ĐỦ";
    return "VƯỢT";
  }
  // day
  if (diff === null) return "CHƯA CÓ";
  if (diff >= 0) return "ĐẠT";
  return "CHƯA ĐẠT";
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateKey = (searchParams.get("date") || "").trim();
    if (!dateKey) {
      return NextResponse.json({ status: "error", message: "Missing date" }, { status: 400 });
    }

    // đọc config để lấy range theo date
    const cfgRows = await readRange("CONFIG_KPI!A2:B1000", { valueRenderOption: "FORMATTED_VALUE" });

    let range = null;
    let dateLabel = null;
    for (const r of cfgRows) {
      const dl = String(r?.[0] ?? "").trim();
      const rg = String(r?.[1] ?? "").trim();
      if (!dl || !rg) continue;

      const k = (() => {
        const m = dl.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return null;
        return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      })();

      if (k === dateKey) {
        range = rg;
        dateLabel = dl;
        break;
      }
    }

    if (!range) {
      return NextResponse.json({ status: "error", message: "Không tìm thấy RANGE cho ngày này trong CONFIG_KPI" }, { status: 400 });
    }

    // đọc KPI range (raw number)
    const values = await readRange(range, { valueRenderOption: "UNFORMATTED_VALUE" });

    const headerRowIdx = findHeaderRow(values);
    if (headerRowIdx < 0) {
      return NextResponse.json({ status: "error", message: "Không tìm thấy header mốc giờ (->9h, ->10h...)" }, { status: 400 });
    }

    const header = values[headerRowIdx] || [];
    const lineCol = detectLineCol(values, headerRowIdx);

    const dmDayCol = findColByIncludes(header, ["dmngay", "d mngay", "dmngay"]); // normalize đã remove ký tự nên chỉ cần dmngay
    const dmHourCol = findColByIncludes(header, ["dmh"]);
    const hsActualCol =
      findColByIncludes(header, ["suatdattrong"]) ??
      findColByIncludes(header, ["hsuatdattrong"]) ??
      findColByIncludes(header, ["hsuatdat"]);
    const hsTargetCol =
      findColByIncludes(header, ["dinhmuctrong"]) ??
      findColByIncludes(header, ["hsdinhmuc"]) ??
      findColByIncludes(header, ["dinhmuc"]);

    // map mark -> col
    const markCols = {};
    for (let c = 0; c < header.length; c++) {
      const hk = keyOf(header[c]);
      for (const m of MARKS) {
        if (hk === keyOf(m)) markCols[m] = c;
      }
    }

    // build lines
    const dupCount = new Map();
    const lines = [];

    for (let r = headerRowIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      const rawLine = row[lineCol];
      if (!isLineCode(rawLine)) continue;

      let line = String(rawLine).trim();
      const baseKey = keyOf(line);
      const n = (dupCount.get(baseKey) || 0) + 1;
      dupCount.set(baseKey, n);
      const lineLabel = n >= 2 ? `${line} (${n})` : line;

      const dmDay = dmDayCol >= 0 ? asNumber(row[dmDayCol]) : null;
      const dmHour = dmHourCol >= 0 ? asNumber(row[dmHourCol]) : null;

      const hsDay = hsActualCol >= 0 ? asPercent(row[hsActualCol]) : null;
      const hsTarget = hsTargetCol >= 0 ? asPercent(row[hsTargetCol]) : 0.9; // fallback 90%

      const hsDiff = hsDay === null ? null : hsDay - (hsTarget ?? 0.9);
      const hsStatus = buildStatusBadgeText("day", hsDiff);

      const dmPerHour =
        (dmHour !== null && dmHour > 0) ? dmHour :
        (dmDay !== null && dmDay > 0) ? (dmDay / 8) :
        null;

      const hourly = {};
      const hourlyCompare = {};
      for (const m of MARKS) {
        const col = markCols[m];
        const actual = (col !== undefined) ? asNumber(row[col]) : null;
        hourly[m] = actual;

        if (dmPerHour === null || actual === null) {
          hourlyCompare[m] = { actual, target: null, diff: null, status: "N/A" };
        } else {
          const target = dmPerHour * (MARK_HOURS[m] || 0);
          const diff = actual - target;
          const status = buildStatusBadgeText("hourly", diff === null ? null : (diff === 0 ? 0 : diff));
          hourlyCompare[m] = { actual, target, diff, status };
        }
      }

      lines.push({
        line,
        lineLabel,
        dmDay,
        dmHour,
        dmPerHour,
        hsDay,
        hsTarget: hsTarget ?? 0.9,
        hsStatus,
        hourly,
        hourlyCompare,
      });
    }

    return NextResponse.json(
      {
        status: "ok",
        dateKey,
        dateLabel: dateLabel || dateKey,
        range,
        marks: MARKS,
        lines,
        lastUpdated: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e?.message || String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
