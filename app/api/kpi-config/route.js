// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { readSheetRange } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const CONFIG_SHEET = process.env.KPI_CONFIG_SHEET || "CONFIG_KPI";

function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function norm(s) {
  return stripDiacritics(s).trim().toUpperCase().replace(/\s+/g, "");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function loadConfig(spreadsheetId) {
  const values = await readSheetRange({
    spreadsheetId,
    range: `${CONFIG_SHEET}!A:Z`,
  });

  if (!values.length) return [];

  const header = values[0] || [];
  const colDate = header.findIndex((x) => norm(x) === "DATE");
  const colRange = header.findIndex((x) => norm(x) === "RANGE");

  if (colDate < 0 || colRange < 0) {
    throw new Error(`CONFIG_KPI thiếu header DATE/RANGE`);
  }

  const items = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const date = row[colDate];
    const range = row[colRange];
    if (!date || !range) continue;
    items.push({ date: String(date), range: String(range) });
  }
  return items;
}

function detectHeaderRow(values) {
  // dò 15 dòng đầu, dòng nào chứa nhiều "từ khóa" nhất thì coi là header
  const maxScan = Math.min(values.length, 15);
  let best = { idx: 0, score: -1 };

  for (let i = 0; i < maxScan; i++) {
    const row = values[i] || [];
    let score = 0;

    for (const cell of row) {
      const c = norm(cell);
      if (!c) continue;

      if (c.includes("CHUYEN")) score += 3;
      if (c === "MH" || c.includes("MAHANG")) score += 3;
      if (c.includes("DM/NGAY") || c.includes("DMNGAY")) score += 3;
      if (c.includes("DM/H") || c.includes("DMH")) score += 3;

      if (c.includes("->")) score += 1; // mốc giờ
      if (c.match(/^-\>?\d/)) score += 1;
    }

    if (score > best.score) best = { idx: i, score };
  }

  return best.idx;
}

function parseKpi(values) {
  if (!values.length) return { lines: [], marks: [], cols: {} };

  const headerRow = detectHeaderRow(values);
  const header = values[headerRow] || [];
  const headerNorm = header.map(norm);

  const colLine =
    headerNorm.findIndex((x) => x.includes("CHUYEN")) >= 0
      ? headerNorm.findIndex((x) => x.includes("CHUYEN"))
      : 0;

  const colMaHang =
    headerNorm.findIndex((x) => x === "MH") >= 0
      ? headerNorm.findIndex((x) => x === "MH")
      : headerNorm.findIndex((x) => x.includes("MAHANG"));

  const colDmDay =
    headerNorm.findIndex((x) => x.includes("DM/NGAY") || x.includes("DMNGAY"));

  const colDmHour =
    headerNorm.findIndex((x) => x.includes("DM/H") || x.includes("DMH"));

  // marks: các cột chứa "->"
  const marks = [];
  const markCols = [];
  header.forEach((cell, idx) => {
    const raw = String(cell || "").trim();
    const n = norm(raw);
    if (!raw) return;
    if (n.includes("->") || raw.includes("->")) {
      marks.push(raw);
      markCols.push(idx);
    }
  });

  const lines = [];
  for (let r = headerRow + 1; r < values.length; r++) {
    const row = values[r] || [];

    const line = String(row[colLine] || "").trim();
    if (!line) continue;

    // bỏ các dòng tổng nếu có
    const nline = norm(line);
    if (nline.includes("TOTAL")) continue;

    const maHang = colMaHang >= 0 ? String(row[colMaHang] || "").trim() : "";

    const dmDay = colDmDay >= 0 ? toNumberSafe(row[colDmDay]) : 0;
    const dmHour = colDmHour >= 0 ? toNumberSafe(row[colDmHour]) : 0;

    const hourly = {};
    for (let i = 0; i < marks.length; i++) {
      hourly[marks[i]] = toNumberSafe(row[markCols[i]]);
    }

    lines.push({ line, maHang, dmDay, dmHour, hourly });
  }

  return {
    lines,
    marks,
    cols: { headerRow, colLine, colMaHang, colDmDay, colDmHour },
  };
}

export async function GET(req) {
  try {
    const spreadsheetId = process.env.KPI_SHEET_ID;
    if (!spreadsheetId) throw new Error("Missing KPI_SHEET_ID");

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    if (!date) throw new Error("Missing date");

    const cfg = await loadConfig(spreadsheetId);
    const found = cfg.find((x) => String(x.date).trim() === String(date).trim());
    if (!found) throw new Error(`Không tìm thấy date=${date} trong CONFIG_KPI`);

    const values = await readSheetRange({
      spreadsheetId,
      range: found.range,
    });

    const parsed = parseKpi(values);

    return NextResponse.json({
      ok: true,
      date,
      range: found.range,
      ...parsed,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || String(e) });
  }
}
