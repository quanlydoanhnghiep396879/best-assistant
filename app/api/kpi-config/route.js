import { NextResponse } from "next/server";
import { readRangeFormatted, readRangeRaw } from "../_lib/googleSheetsClient";

const CONFIG_SHEET = process.env.CONFIG_SHEET_NAME || "CONFIG_KPI";

function norm(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9/->]+/g, "");
}

function isLineName(v) {
  const t = String(v ?? "").trim().toUpperCase();
  if (!t) return false;
  return (
    /^C\d+$/.test(t) ||
    t === "CAT" || t === "CẮT" ||
    t === "KCS" ||
    t === "HOÀN TẤT" || t === "HOAN TAT" ||
    t === "NM"
  );
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function findDataStart(values) {
  for (let r = 0; r < values.length; r++) {
    if (isLineName(values[r]?.[0])) return r;
  }
  return -1;
}

function buildHeaders(values, dataStart) {
  const top = values[dataStart - 2] || [];
  const sub = values[dataStart - 1] || [];
  const cols = Math.max(top.length, sub.length, (values[dataStart] || []).length);

  const headers = [];
  for (let c = 0; c < cols; c++) {
    headers.push(norm(String(top[c] ?? "") + " " + String(sub[c] ?? "")));
  }
  return headers;
}

function findCol(headers, keywordList) {
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    for (const k of keywordList) {
      if (h.includes(k)) return c;
    }
  }
  return -1;
}

function extractTimeCols(headers) {
  const timeCols = [];
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    const m = h.match(/->(\d{1,2})H(30)?/);
    if (m) {
      const hour = Number(m[1]);
      const half = !!m[2];
      const order = hour * 60 + (half ? 30 : 0);
      timeCols.push({ c, label: "->" + m[1] + "h" + (half ? "30" : ""), order });
    }
  }
  timeCols.sort((a, b) => a.order - b.order);
  return timeCols;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const list = searchParams.get("list");

    // list dates
    if (list === "1") {
      const cfg = await readRangeFormatted(`${CONFIG_SHEET}!A:B`);
      const out = [];
      for (let r = 1; r < cfg.length; r++) {
        const d = String(cfg[r]?.[0] ?? "").trim();
        const range = String(cfg[r]?.[1] ?? "").trim();
        if (d && range) out.push(d);
      }
      return NextResponse.json({ ok: true, dates: out, configSheet: CONFIG_SHEET });
    }

    if (!date) return NextResponse.json({ ok: false, error: "Missing date" }, { status: 400 });

    const cfg = await readRangeFormatted(`${CONFIG_SHEET}!A:B`);
    let rangeA1 = "";
    for (let r = 1; r < cfg.length; r++) {
      const d = String(cfg[r]?.[0] ?? "").trim();
      if (d === date) {
        rangeA1 = String(cfg[r]?.[1] ?? "").trim();
        break;
      }
    }
    if (!rangeA1) {
      return NextResponse.json(
        { ok: false, error: `Không tìm thấy DATE=${date} trong ${CONFIG_SHEET}!A:B`, configSheet: CONFIG_SHEET },
        { status: 404 }
      );
    }

    const valuesRaw = await readRangeRaw(rangeA1);
    const valuesFmt = await readRangeFormatted(rangeA1);

    const dataStart = findDataStart(valuesFmt);
    if (dataStart < 0) {
      return NextResponse.json({ ok: false, error: "Không tìm thấy dòng C1/C2... trong range", rangeA1 });
    }

    const headers = buildHeaders(valuesFmt, dataStart);
    const colMaHang = findCol(headers, ["MAHANG"]);
    const colDMNgay = findCol(headers, ["DM/NGAY", "DMNGAY"]);
    const timeCols = extractTimeCols(headers);

    const threshold = 0.9;

    const rows = [];
    for (let r = dataStart; r < valuesFmt.length; r++) {
      const line = String(valuesFmt[r]?.[0] ?? "").trim();
      if (!isLineName(line)) continue;

      const maHang = colMaHang >= 0 ? String(valuesFmt[r]?.[colMaHang] ?? "").trim() : "";
      const dmNgay = colDMNgay >= 0 ? toNumber(valuesRaw[r]?.[colDMNgay]) : 0;

      const lastTimeCol = timeCols.length ? timeCols[timeCols.length - 1].c : -1;
      const actual = lastTimeCol >= 0 ? toNumber(valuesRaw[r]?.[lastTimeCol]) : 0;

      const hsDat = dmNgay > 0 ? actual / dmNgay : null;
      const status = hsDat === null ? "CHƯA CÓ" : hsDat >= threshold ? "ĐẠT" : "KHÔNG ĐẠT";

      rows.push({
        chuyen: line,
        maHang: maHang || "—",
        dmNgay,
        actual,
        hsDat,
        hsDinhMuc: threshold,
        status,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      rangeA1,
      configSheet: CONFIG_SHEET,
      timeMarks: timeCols.map((t) => t.label),
      rows,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e), configSheet: CONFIG_SHEET }, { status: 500 });
  }
}