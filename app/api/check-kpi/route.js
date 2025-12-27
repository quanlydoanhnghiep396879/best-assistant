// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { readSheetRange, readConfigRanges } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

const MILESTONES = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];
const HOURS_AT = { "->9h": 1, "->10h": 2, "->11h": 3, "->12h30": 4, "->13h30": 5, "->14h30": 6, "->15h30": 7, "->16h30": 8 };

function norm(s) {
  return (s ?? "").toString().trim().toUpperCase();
}

function toNumber(x) {
  if (x === null || x === undefined) return 0;
  const s = x.toString().replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toPercent(x) {
  if (x === null || x === undefined) return null;
  const s = x.toString().trim();
  if (!s) return null;

  if (s.includes("%")) {
    const n = Number(s.replace("%", "").replace(",", "."));
    return Number.isFinite(n) ? n / 100 : null;
  }

  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;

  // nếu sheet trả 0.9587 => 95.87%
  if (n <= 1) return n;
  // nếu sheet trả 95.87 => 95.87%
  if (n <= 100) return n / 100;
  return null;
}

function pickHeaderRow(values) {
  // tìm dòng header chứa ít nhất 1 mốc giờ + DM/H
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const rowStr = row.map((c) => (c ?? "").toString());
    const hasMilestone = rowStr.some((c) => MILESTONES.some((m) => c.includes(m)));
    const hasDmH = rowStr.some((c) => norm(c).includes("DM/H"));
    if (hasMilestone && hasDmH) return r;
  }
  return -1;
}

function colIndexOf(headerRow, keywords) {
  const hdr = headerRow.map((c) => norm(c));
  for (let i = 0; i < hdr.length; i++) {
    for (const kw of keywords) {
      if (hdr[i].includes(kw)) return i;
    }
  }
  return -1;
}

function parseLines(values) {
  const headerRowIndex = pickHeaderRow(values);
  if (headerRowIndex < 0) {
    return { lines: [], meta: { message: "Không tìm thấy dòng tiêu đề (phải có '->9h' và 'DM/H')." } };
  }

  const header = values[headerRowIndex] || [];

  const idxLine = 0; // cột A thường là chuyền (C1..)
  const idxDmDay = colIndexOf(header, ["DM/NGÀY", "DM/NGAY"]);
  const idxDmH = colIndexOf(header, ["DM/H"]);
  const idxHsDat = colIndexOf(header, ["SUẤT ĐẠT TRONG", "SUAT DAT TRONG", "SUAT DAT"]);
  const idxHsDinhMuc = colIndexOf(header, ["ĐỊNH MỨC TRONG", "DINH MUC TRONG", "DINH MUC"]);

  // milestone cols
  const milestoneCols = {};
  for (const m of MILESTONES) {
    milestoneCols[m] = header.findIndex((c) => (c ?? "").toString().includes(m));
  }

  const startData = headerRowIndex + 1;
  const lines = [];

  for (let r = startData; r < values.length; r++) {
    const row = values[r] || [];
    const lineName = (row[idxLine] ?? "").toString().trim();
    if (!lineName) continue;

    // bỏ các dòng TOTAL
    const up = norm(lineName);
    if (up.includes("TOTAL")) continue;

    const dmDay = idxDmDay >= 0 ? toNumber(row[idxDmDay]) : 0;
    const dmH = idxDmH >= 0 ? toNumber(row[idxDmH]) : 0;

    const hsDat = idxHsDat >= 0 ? toPercent(row[idxHsDat]) : null;
    const hsTarget = idxHsDinhMuc >= 0 ? toPercent(row[idxHsDinhMuc]) : null;

    const actual = {};
    for (const m of MILESTONES) {
      const ci = milestoneCols[m];
      actual[m] = ci >= 0 ? toNumber(row[ci]) : 0;
    }

    const baseDmH = dmH > 0 ? dmH : (dmDay > 0 ? dmDay / 8 : 0);

    const target = {};
    const diff = {};
    const status = {};
    for (const m of MILESTONES) {
      const need = Math.round(baseDmH * HOURS_AT[m]); // làm tròn
      target[m] = need;
      diff[m] = actual[m] - need;

      if (need === 0) status[m] = "N/A";
      else if (diff[m] < 0) status[m] = "THIẾU";
      else if (diff[m] === 0) status[m] = "ĐỦ";
      else status[m] = "VƯỢT";
    }

    const latest = "->16h30";
    const hsStatus =
      hsDat === null ? "CHƯA CÓ" :
      (hsTarget ?? 0.9) === 0 ? "CHƯA CÓ" :
      hsDat >= (hsTarget ?? 0.9) ? "ĐẠT" : "KHÔNG ĐẠT";

    lines.push({
      line: lineName,
      dmDay,
      dmH,
      baseDmH,
      actual,
      target,
      diff,
      status,
      latestMilestone: latest,
      hsDat,
      hsTarget: hsTarget ?? 0.9,
      hsStatus,
    });
  }

  return {
    lines,
    meta: {
      headerRowIndex,
      idxDmDay,
      idxDmH,
      idxHsDat,
      idxHsDinhMuc,
      milestoneCols,
    },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date) return NextResponse.json({ status: "error", message: "Missing ?date=" }, { status: 400 });

  try {
    const configRows = await readConfigRanges();
    const found = configRows.find((x) => x.date.trim() === date.trim());
    if (!found) return NextResponse.json({ status: "error", message: "Date not found in CONFIG_KPI" }, { status: 404 });

    const raw = await readSheetRange(found.range);
    const parsed = parseLines(raw);

    return NextResponse.json(
      {
        status: "success",
        date,
        range: found.range,
        rawCount: raw.length,
        ...parsed,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e?.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
