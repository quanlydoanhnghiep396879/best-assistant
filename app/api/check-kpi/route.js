import { NextResponse } from "next/server";
import { readRange } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS_TARGET = 0.9;

const MARK_CANON = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];
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
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normText(v) {
  if (v == null) return "";
  return stripDiacritics(String(v))
    .toUpperCase()
    .replace(/\s+/g, "")   // bỏ space + xuống dòng
    .replace(/–/g, "-")
    .trim();
}

function parseNumber(v) {
  if (v == null) return NaN;
  const s0 = String(v).trim();
  if (!s0) return NaN;

  // bỏ % nếu có
  const s1 = s0.replace(/%/g, "").replace(/\s/g, "");

  // xử lý kiểu VN: 1,08 hoặc 2.755
  // nếu có cả . và , -> thường . là ngàn, , là thập phân
  let s = s1;
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else {
    // có thể là 2.755 (ngàn) => bỏ dấu .
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function findColByAny(values, keywords) {
  // keywords: ["DM/NGAY", "DMNGAY", ...] đã norm sẵn
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const t = normText(row[c]);
      if (!t) continue;
      for (const k of keywords) {
        if (t.includes(k)) return c;
      }
    }
  }
  return -1;
}

function findMarksRow(values) {
  // tìm row có chứa ->9h hoặc ->10h
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const joined = row.map(normText).join("|");
    if (joined.includes("->9H") || joined.includes("->10H") || joined.includes("->11H")) return r;
  }
  return -1;
}

function buildMarkCols(values, marksRow) {
  const row = values[marksRow] || [];
  const map = {}; // canon -> colIndex
  for (let c = 0; c < row.length; c++) {
    const t = normText(row[c]);
    if (!t) continue;

    // nhận diện các mốc
    // chuẩn hoá: ->12H30
    if (t.startsWith("->")) {
      // chuẩn hóa về dạng ->9h / ->12h30
      const raw = t.replace("H", "h"); // t đang upper, nhưng ta chỉ cần map
      // convert: "->12H30" => "->12h30"
      const m = raw
        .replace(/->/g, "->")
        .replace(/H/g, "h")
        .replace(/(\d+)H(\d+)/g, "$1h$2")
        .replace(/(\d+)H/g, "$1h");

      // đưa về canon gần nhất
      for (const canon of MARK_CANON) {
        if (normText(canon) === normText(m)) {
          map[canon] = c;
        }
      }
    }
  }
  return map;
}

function isLineNameCell(v) {
  const t = normText(v);
  if (!t) return false;

  // C1..C10
  if (/^C\d{1,2}$/.test(t)) return true;

  // CẮT / KCS / HOÀN TẤT / NM
  if (t === "CAT") return true;
  if (t === "KCS") return true;
  if (t === "HOANTAT") return true;
  if (t === "NM") return true;

  return false;
}

function statusHour(diff) {
  if (!Number.isFinite(diff)) return "N/A";
  if (diff > 0) return "VƯỢT";
  if (diff === 0) return "ĐỦ";
  return "THIẾU";
}

function statusDay(hs) {
  if (!Number.isFinite(hs)) return "CHƯA CÓ";
  return hs >= HS_TARGET ? "ĐẠT" : "CHƯA ĐẠT";
}

export async function GET(req) {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json(
        { status: "error", message: "Missing GOOGLE_SHEET_ID" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const date = String(searchParams.get("date") || "").trim();
    if (!date) {
      return NextResponse.json(
        { status: "error", message: "Missing date" },
        { status: 400 }
      );
    }

    // đọc config
    const cfg = await readRange(spreadsheetId, "CONFIG_KPI!A2:B");
    let range = "";
    for (const row of cfg) {
      const d = String(row?.[0] || "").trim();
      if (d === date) {
        range = String(row?.[1] || "").trim();
        break;
      }
    }
    if (!range) {
      return NextResponse.json(
        { status: "error", message: `No RANGE for date ${date}` },
        { status: 400 }
      );
    }

    // đọc KPI range
    const values = await readRange(spreadsheetId, range);

    // tìm cột DM/NGÀY + DM/H (robust)
    const colDmDay = findColByAny(values, ["DM/NGAY", "DMNGAY", "ĐM/NGAY", "ĐMNGAY"].map(normText));
    const colDmHour = findColByAny(values, ["DM/H", "DMH", "ĐM/H", "ĐMH"].map(normText));

    // tìm marks row + map các col mốc
    const marksRow = findMarksRow(values);
    const markCols = marksRow >= 0 ? buildMarkCols(values, marksRow) : {};

    // nếu không đủ markCols, vẫn trả về để debug
    const lines = [];

    // duyệt từng row tìm chuyền
    for (let r = 0; r < values.length; r++) {
      const row = values[r] || [];
      const nameRaw = row[0];
      if (!isLineNameCell(nameRaw)) continue;

      const lineName = String(nameRaw).trim();
      const dmDay = colDmDay >= 0 ? parseNumber(row[colDmDay]) : NaN;
      let dmHour = colDmHour >= 0 ? parseNumber(row[colDmHour]) : NaN;
      if (!Number.isFinite(dmHour) && Number.isFinite(dmDay)) dmHour = dmDay / 8;

      const hourly = {};
      for (const m of MARK_CANON) {
        const c = markCols[m];
        hourly[m] = c == null ? null : (Number.isFinite(parseNumber(row[c])) ? parseNumber(row[c]) : null);
      }

      // HS ngày = lũy tiến tại ->16h30 / dmDay
      const last = hourly["->16h30"];
      const hs = Number.isFinite(dmDay) && Number.isFinite(last) ? last / dmDay : NaN;

      // tính dm lũy tiến + chênh theo từng mốc
      const hourlyCompare = MARK_CANON.map((m) => {
        const actual = hourly[m];
        const h = MARK_HOURS[m];
        const dmCum = Number.isFinite(dmHour) ? dmHour * h : null;
        const diff = (Number.isFinite(actual) && Number.isFinite(dmCum)) ? (actual - dmCum) : NaN;
        return {
          mark: m,
          actual,
          dmCum,
          diff: Number.isFinite(diff) ? diff : null,
          status: statusHour(Number.isFinite(diff) ? diff : NaN),
        };
      });

      lines.push({
        line: lineName,
        dmDay: Number.isFinite(dmDay) ? dmDay : null,
        dmHour: Number.isFinite(dmHour) ? dmHour : null,
        hs: Number.isFinite(hs) ? hs : null,
        hsTarget: HS_TARGET,
        hsStatus: statusDay(hs),
        hourlyCompare,
      });
    }

    return NextResponse.json(
      {
        status: "ok",
        date,
        range,
        debug: {
          marksRow,
          colDmDay,
          colDmHour,
          markCols,
        },
        lines,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}
