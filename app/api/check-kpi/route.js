import { NextResponse } from "next/server";
import { getSheetsClient, getSheetIdEnv } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const MARKS = ["->9h","->10h","->11h","->12h30","->13h30","->14h30","->15h30","->16h30"];
const DEFAULT_HS_TARGET = 0.9;

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")     // bỏ dấu
    .replace(/\s+/g, "")                                 // bỏ space
    .replace(/[^\w>:/.-]/g, "");                         // bỏ ký tự lạ (giữ ->, /, :)
}

function toNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/,/g, "");     // 1,234
  s = s.replace(/%/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function findHeaderRow(values) {
  // dò 0..6 dòng đầu trong range, tìm dòng có ít nhất 2 dấu hiệu: có ->9h và có DM/NGAY hoặc DM/H
  const maxScan = Math.min(values.length, 7);
  let best = 0;
  let bestScore = -1;

  for (let r = 0; r < maxScan; r++) {
    const row = values[r] || [];
    const nrow = row.map(norm);
    const has9h = nrow.some((x) => x.includes(norm("->9h")));
    const hasDmDay = nrow.some((x) => x.includes("dm/ngay") || x.includes("dmngay"));
    const hasDmH = nrow.some((x) => x.includes("dm/h") || x.includes("dmh"));
    const hasChuyen = nrow.some((x) => x.includes("chuyen") || x === "loai");

    const score = (has9h ? 3 : 0) + (hasDmDay ? 2 : 0) + (hasDmH ? 2 : 0) + (hasChuyen ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function findCol(headersNorm, candidates) {
  // candidates: list of "contains" keys in normalized form
  for (let i = 0; i < headersNorm.length; i++) {
    const h = headersNorm[i];
    for (const c of candidates) {
      if (!c) continue;
      if (h === c || h.includes(c)) return i;
    }
  }
  return -1;
}

function statusHourly(actual, dmCum) {
  if (!Number.isFinite(dmCum) || dmCum <= 0) return "N/A";
  if (!Number.isFinite(actual)) return "N/A";
  if (actual === dmCum) return "ĐỦ";
  if (actual > dmCum) return "VƯỢT";
  return "THIẾU";
}

function statusDaily(hs, target) {
  if (!Number.isFinite(hs)) return "CHƯA CÓ";
  return hs >= target ? "ĐẠT" : "CHƯA ĐẠT";
}

async function readConfigRanges() {
  const spreadsheetId = getSheetIdEnv();
  const configSheet = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${configSheet}!A:B`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });

  const values = res.data.values || [];
  const map = new Map();
  for (let i = 1; i < values.length; i++) {
    const d = values[i]?.[0];
    const r = values[i]?.[1];
    if (!d || !r) continue;

    // date normalize giống route kpi-config
    let dateStr;
    if (typeof d === "number" || /^[0-9]+(\.[0-9]+)?$/.test(String(d))) {
      const n = Number(d);
      if (Number.isFinite(n) && n > 1000) {
        const base = Date.UTC(1899, 11, 30);
        const ms = base + n * 86400000;
        const dt = new Date(ms);
        dateStr = `${String(dt.getUTCDate()).padStart(2,"0")}/${String(dt.getUTCMonth()+1).padStart(2,"0")}/${dt.getUTCFullYear()}`;
      }
    } else {
      dateStr = String(d).trim();
    }
    if (dateStr) map.set(dateStr, String(r).trim());
  }
  return map;
}

export async function GET(req) {
  try {
    const spreadsheetId = getSheetIdEnv();
    if (!spreadsheetId) {
      return NextResponse.json({ status: "error", message: "Missing GOOGLE_SHEET_ID" }, { status: 400 });
    }

    const url = new URL(req.url);
    const date = url.searchParams.get("date")?.trim();
    if (!date) {
      return NextResponse.json({ status: "error", message: "Missing date" }, { status: 400 });
    }

    const cfg = await readConfigRanges();
    const range = cfg.get(date);
    if (!range) {
      return NextResponse.json({ status: "error", message: `No RANGE for date ${date}. Check CONFIG_KPI.` }, { status: 400 });
    }

    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });

    const values = res.data.values || [];
    if (values.length < 2) {
      return NextResponse.json({ status: "success", date, range, lines: [], marks: MARKS }, { headers: { "Cache-Control":"no-store" } });
    }

    const headerRowIdx = findHeaderRow(values);
    const headers = values[headerRowIdx] || [];
    const headersNorm = headers.map(norm);

    // cột chuyền / loại
    let colLine = findCol(headersNorm, ["chuyen", "loai"]);
    if (colLine < 0) colLine = 0;

    const colDmDay = findCol(headersNorm, ["dm/ngay","dmngay","dm/ngay"]);
    const colDmHour = findCol(headersNorm, ["dm/h","dmh","đm/h"]);

    // hiệu suất (bạn có thể đổi theo header thực tế của bạn)
    const colHsDay = findCol(headersNorm, [
      "suatdat", "suatdat trong", "hieusuat trongngay", "hieusuat", "hs"
    ]);
    const colHsTarget = findCol(headersNorm, [
      "dinhmuc", "dinhmuctrong", "hsdinhmuc", "hieusuatdinhmuc"
    ]);

    // cột mốc giờ
    const markCols = {};
    for (const m of MARKS) {
      const idx = findCol(headersNorm, [norm(m)]);
      if (idx >= 0) markCols[m] = idx;
    }

    const lines = [];
    for (let r = headerRowIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      const lineRaw = row[colLine];
      const line = String(lineRaw ?? "").trim();
      if (!line) continue;

      const dmDay = colDmDay >= 0 ? toNum(row[colDmDay]) : null;
      const dmHourRaw = colDmHour >= 0 ? toNum(row[colDmHour]) : null;
      const dmHour = Number.isFinite(dmHourRaw) ? dmHourRaw : (Number.isFinite(dmDay) ? dmDay / 8 : null);

      const hourly = {};
      for (const m of MARKS) {
        const c = markCols[m];
        hourly[m] = (c == null) ? null : toNum(row[c]);
      }

      let hsDay = colHsDay >= 0 ? toNum(row[colHsDay]) : null;
      // nếu sheet lưu % dạng 95.87% -> có thể là 95.87 hoặc 0.9587 tuỳ format
      // chuẩn hoá về 0..1:
      if (Number.isFinite(hsDay) && hsDay > 1.5) hsDay = hsDay / 100;

      let hsTarget = colHsTarget >= 0 ? toNum(row[colHsTarget]) : null;
      if (Number.isFinite(hsTarget) && hsTarget > 1.5) hsTarget = hsTarget / 100;
      if (!Number.isFinite(hsTarget)) hsTarget = DEFAULT_HS_TARGET;

      const hsStatus = statusDaily(hsDay, hsTarget);

      lines.push({
        line,
        dmDay: Number.isFinite(dmDay) ? dmDay : null,
        dmHour: Number.isFinite(dmHour) ? dmHour : null,
        hourly,
        hsDay: Number.isFinite(hsDay) ? hsDay : null,
        hsTarget,
        hsStatus,
      });
    }

    return NextResponse.json({
      status: "success",
      date,
      range,
      headerRowIdx,
      parsed: {
        colLine, colDmDay, colDmHour, colHsDay, colHsTarget, markCols,
      },
      marks: MARKS,
      lines,
      updatedAt: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "no-store" }
    });

  } catch (e) {
    return NextResponse.json({ status: "error", message: String(e?.message || e) }, { status: 500 });
  }
}
