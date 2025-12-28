import { NextResponse } from "next/server";
import { getSheetsClient, getSheetIdEnv } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const MARKS = ["->9h","->10h","->11h","->12h30","->13h30","->14h30","->15h30","->16h30"];
const DEFAULT_HS_TARGET = 0.9;

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/\s+/g, "")                              // bỏ space
    .replace(/[^\w>:/.-]/g, "");                      // bỏ ký tự lạ
}

function toNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/,/g, "").replace(/%/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function findCol(headersNorm, candidates) {
  for (let i = 0; i < headersNorm.length; i++) {
    const h = headersNorm[i];
    for (const c of candidates) {
      if (!c) continue;
      if (h === c || h.includes(c)) return i;
    }
  }
  return -1;
}

function findHeaderRow(values) {
  // Tăng scan lên 25 dòng đầu trong RANGE (nhiều sheet có vài dòng tiêu đề phía trên)
  const maxScan = Math.min(values.length, 25);
  let best = 0;
  let bestScore = -1;

  for (let r = 0; r < maxScan; r++) {
    const row = values[r] || [];
    const nrow = row.map(norm);

    const has9h = nrow.some((x) => x.includes(norm("->9h")));
    const hasDmDay = nrow.some((x) => x.includes("dmngay") || x.includes("dm/ngay") || x.includes("dinhmucngay"));
    const hasDmHour = nrow.some((x) => x.includes("dmh") || x.includes("dm/h") || x.includes("dmgio") || x.includes("dm/gio") || x.includes("dinhmucgio"));
    const hasChuyen = nrow.some((x) => x.includes("chuyen") || x.includes("line") || x.includes("chuyền"));

    const score = (has9h ? 5 : 0) + (hasDmDay ? 3 : 0) + (hasDmHour ? 3 : 0) + (hasChuyen ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
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

    let dateStr = null;

    // số serial -> dd/mm/yyyy
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
    if (!date) return NextResponse.json({ status: "error", message: "Missing date" }, { status: 400 });

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

    // Chuyền
    let colLine = findCol(headersNorm, ["chuyen", "chuyền", "line", "loai"]);
    if (colLine < 0) colLine = 0;

    // DM/NGÀY & DM/H: mở rộng keyword để match được nhiều kiểu header
    const colDmDay = findCol(headersNorm, [
      "dm/ngay","dmngay","dinhmucngay","dinhmuc/ngay","dinhmucng",
      "dinhmuctrongngay","dinhmucngay()","dmday"
    ]);

    const colDmHour = findCol(headersNorm, [
      "dm/h","dmh","dm/gio","dmgio","dinhmucgio","dinhmuc/h","dinhmucgio()"
    ]);

    // HS đạt & HS định mức
    const colHsDay = findCol(headersNorm, [
      "hsdat","hieusuatdat","hieusuattrongngay","hieusuatngay","hsngay",
      "suatdat","hieusuat"
    ]);
    const colHsTarget = findCol(headersNorm, [
      "hsdinhmuc","hieusuatdinhmuc","dinhmuchs","dinhmuc","dinhmuctrongngay"
    ]);

    // Mốc giờ
    const markCols = {};
    for (const m of MARKS) {
      const idx = findCol(headersNorm, [norm(m)]);
      if (idx >= 0) markCols[m] = idx;
    }

    const lines = [];
    for (let r = headerRowIdx + 1; r < values.length; r++) {
      const row = values[r] || [];
      const line = String(row[colLine] ?? "").trim();
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
      if (Number.isFinite(hsDay) && hsDay > 1.5) hsDay = hsDay / 100;

      let hsTarget = colHsTarget >= 0 ? toNum(row[colHsTarget]) : null;
      if (Number.isFinite(hsTarget) && hsTarget > 1.5) hsTarget = hsTarget / 100;
      if (!Number.isFinite(hsTarget)) hsTarget = DEFAULT_HS_TARGET;

      lines.push({
        line,
        dmDay: Number.isFinite(dmDay) ? dmDay : null,
        dmHour: Number.isFinite(dmHour) ? dmHour : null,
        hourly,
        hsDay: Number.isFinite(hsDay) ? hsDay : null,
        hsTarget,
        hsStatus: statusDaily(hsDay, hsTarget),
      });
    }

    return NextResponse.json({
      status: "success",
      date,
      range,
      headerRowIdx,
      parsed: { colLine, colDmDay, colDmHour, colHsDay, colHsTarget, markCols },
      debugHeaders: headers,           // để bạn nhìn xem header đang là gì
      marks: MARKS,
      lines,
      updatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control":"no-store" } });

  } catch (e) {
    return NextResponse.json({ status: "error", message: String(e?.message || e) }, { status: 500 });
  }
}
