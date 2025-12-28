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
    for (const k of keywordList) if (h.includes(k)) return c;
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
    const chuyen = String(searchParams.get("chuyen") || "").trim();

    if (!date) return NextResponse.json({ ok: false, error: "Missing date" }, { status: 400 });
    if (!chuyen) return NextResponse.json({ ok: false, error: "Missing chuyen" }, { status: 400 });

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
      return NextResponse.json({ ok: false, error: `Không tìm thấy DATE=${date} trong ${CONFIG_SHEET}` }, { status: 404 });
    }

    const valuesRaw = await readRangeRaw(rangeA1);
    const valuesFmt = await readRangeFormatted(rangeA1);

    const dataStart = findDataStart(valuesFmt);
    if (dataStart < 0) return NextResponse.json({ ok: false, error: "Không thấy dataStart" });

    const headers = buildHeaders(valuesFmt, dataStart);
    const colMaHang = findCol(headers, ["MAHANG"]);
    const colDMNgay = findCol(headers, ["DM/NGAY", "DMNGAY"]);
    const colDMH = findCol(headers, ["DM/H", "DMH"]);
    const timeCols = extractTimeCols(headers);

    let rowIndex = -1;
    for (let r = dataStart; r < valuesFmt.length; r++) {
      const line = String(valuesFmt[r]?.[0] ?? "").trim().toUpperCase();
      if (line === chuyen.toUpperCase()) { rowIndex = r; break; }
    }
    if (rowIndex < 0) return NextResponse.json({ ok: false, error: `Không tìm thấy chuyền ${chuyen}` });

    const maHang = colMaHang >= 0 ? String(valuesFmt[rowIndex]?.[colMaHang] ?? "").trim() : "";
    const dmNgay = colDMNgay >= 0 ? toNumber(valuesRaw[rowIndex]?.[colDMNgay]) : 0;
    const dmH = colDMH >= 0 ? toNumber(valuesRaw[rowIndex]?.[colDMH]) : 0;

    const steps = timeCols.map((t, i) => {
      const actual = toNumber(valuesRaw[rowIndex]?.[t.c]);
      const dmLuy = dmH > 0 ? dmH * (i + 1) : 0;
      const chenh = dmH > 0 ? actual - dmLuy : null;
      const status = dmH <= 0 ? "N/A" : actual >= dmLuy ? "ĐẠT" : "THIẾU";
      return { moc: t.label, luyTien: actual, dmLuyTien: dmH > 0 ? dmLuy : null, chenh, status };
    });

    return NextResponse.json({
      ok: true,
      date, rangeA1,
      chuyen,
      maHang: maHang || "—",
      dmNgay: dmNgay || null,
      dmH: dmH || null,
      steps,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}