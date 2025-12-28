import { NextResponse } from "next/server";
import { getSheetsClient } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/đ/g, "d")
    .trim();
}

function parseNumberFlexible(v) {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "number") return v;

  let s = String(v).trim();
  if (!s) return NaN;

  // bỏ ký tự không cần
  s = s.replace(/\s+/g, "");

  // nếu dạng 1,08 (thập phân phẩy)
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // đoán dấu thập phân theo vị trí cuối
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      // comma decimal, dot thousand
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // dot decimal, comma thousand
      s = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }

  s = s.replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parsePercentFlexible(v) {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "number") {
    // nếu 0.9587 thì là 95.87%
    if (v <= 1) return v * 100;
    return v;
  }
  const s = String(v).trim();
  if (!s) return NaN;

  if (s.includes("%")) {
    const n = parseNumberFlexible(s.replace("%", ""));
    return Number.isFinite(n) ? n : NaN;
  }

  const n = parseNumberFlexible(s);
  if (!Number.isFinite(n)) return NaN;
  if (n <= 1) return n * 100;
  return n;
}

function findCol(headerRow, includesList) {
  const H = headerRow.map((x) => norm(x));
  for (let i = 0; i < H.length; i++) {
    for (const inc of includesList) {
      if (H[i].includes(norm(inc))) return i;
    }
  }
  return -1;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") || "";
    if (!date) {
      return NextResponse.json(
        { status: "error", message: "Missing date" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const CONFIG_SHEET = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
    const CONFIG_RANGE = `${CONFIG_SHEET}!A1:B500`;
    const DEFAULT_HS_TARGET = Number(process.env.DEFAULT_HS_TARGET || 90);

    const { sheets, sheetId } = getSheetsClient();

    // đọc config
    const cfgResp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: CONFIG_RANGE });
    const cfgVals = cfgResp.data.values || [];
    if (cfgVals.length < 2) throw new Error("CONFIG_KPI trống.");

    const header = cfgVals[0].map((x) => String(x || "").trim().toUpperCase());
    const idxDate = header.indexOf("DATE");
    const idxRange = header.indexOf("RANGE");
    if (idxDate === -1 || idxRange === -1) throw new Error("CONFIG_KPI phải có header DATE | RANGE");

    let targetRange = "";
    for (let i = 1; i < cfgVals.length; i++) {
      const r = cfgVals[i] || [];
      const d = String(r[idxDate] || "").trim();
      const rr = String(r[idxRange] || "").trim();
      if (d === date && rr) {
        targetRange = rr;
        break;
      }
    }
    if (!targetRange) throw new Error(`Không tìm thấy RANGE cho ngày ${date} trong CONFIG_KPI.`);

    // đọc KPI theo range
    const kpiResp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: targetRange });
    const values = kpiResp.data.values || [];
    if (!values.length) throw new Error("Range KPI rỗng.");

    // tìm header row có ->9h
    let headerRowIdx = values.findIndex((row) => (row || []).some((c) => norm(c).includes("->9h")));
    if (headerRowIdx === -1) headerRowIdx = 0;

    const headerRow = values[headerRowIdx] || [];

    // cột giờ
    const colMark = {};
    for (const m of MARKS) {
      const idx = findCol(headerRow, [m]);
      colMark[m] = idx;
    }

    // cột DM/NGÀY
    let colDmDay = findCol(headerRow, ["dm/ngay", "dm/ngày", "đm/ngay", "đm/ngày", "dmngay"]);
    // cột DM/H (nhiều sheet chỉ ghi "H" → lấy cột kế bên DM/NGÀY)
    let colDmHour = findCol(headerRow, ["dm/h", "đm/h"]);
    if (colDmHour === -1 && colDmDay !== -1) colDmHour = colDmDay + 1;

    // HS đạt + HS định mức (nếu không có sẽ fallback)
    const colHsDay = findCol(headerRow, ["hieusuattrongngay", "suatdat", "hsdat", "hieusuat"]);
    const colHsTarget = findCol(headerRow, ["hsdinhmuc", "dinhmuc", "hieusuatdinhmuc"]);

      // nếu không có, dùng DEFAULT_HS_TARGET

    const lines = [];
    for (let r = headerRowIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      const line = String(row[0] || "").trim();
      if (!line) continue;

      const dmDay = colDmDay >= 0 ? parseNumberFlexible(row[colDmDay]) : NaN;
      const dmHour = colDmHour >= 0 ? parseNumberFlexible(row[colDmHour]) : NaN;

      const hourly = {};
      for (const m of MARKS) {
        const c = colMark[m];
        hourly[m] = c >= 0 ? parseNumberFlexible(row[c]) : NaN;
      }

      // HS đạt: ưu tiên lấy từ cột HS nếu có, không thì tính bằng ->16h30 / DM/NGÀY
      let hsDay = colHsDay >= 0 ? parsePercentFlexible(row[colHsDay]) : NaN;
      const latestVal = Number.isFinite(hourly["->16h30"]) ? hourly["->16h30"] : NaN;
      if (!Number.isFinite(hsDay) && Number.isFinite(latestVal) && Number.isFinite(dmDay) && dmDay > 0) {
        hsDay = (latestVal / dmDay) * 100;
      }

      // HS target
      let hsTarget = colHsTarget >= 0 ? parsePercentFlexible(row[colHsTarget]) : NaN;
      if (!Number.isFinite(hsTarget)) hsTarget = DEFAULT_HS_TARGET;

      let hsStatus = "CHƯA CÓ";
      if (Number.isFinite(hsDay)) {
        hsStatus = hsDay >= hsTarget ? "ĐẠT" : "KHÔNG ĐẠT";
      }

      lines.push({
        line,
        dmDay: Number.isFinite(dmDay) ? dmDay : 0,
        dmHour: Number.isFinite(dmHour) ? dmHour : 0,
        hourly: Object.fromEntries(
          MARKS.map((m) => [m, Number.isFinite(hourly[m]) ? hourly[m] : NaN])
        ),
        hsDay: Number.isFinite(hsDay) ? hsDay : null,
        hsTarget,
        hsStatus,
      });
    }

    // fix NaN to null for hourly
    for (const l of lines) {
      for (const m of MARKS) {
        const v = l.hourly[m];
        l.hourly[m] = Number.isFinite(v) ? v : null;
      }
    }

    return NextResponse.json(
      {
        status: "success",
        date,
        range: targetRange,
        latestMark: "->16h30",
        marks: MARKS,
        lines,
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
