import { NextResponse } from "next/server";
import { getSheetsClient, getSpreadsheetId } from "../_lib/googleSheetsClient";

function norm(s) {
  return (s ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/-/g, "/");
}

function normKey(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normDateForMatch(s) {
  return (s ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "/");
}

function excelSerialToDMY(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  const d = new Date(ms);
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return 0;
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function findHeaderRow(values) {
  // tìm row có DM/NGÀY và DM/H
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const joined = row.map(normKey).join("|");
    if (joined.includes("DM/NGÀY") && (joined.includes("DM/H") || joined.includes("DMH"))) {
      return i;
    }
  }
  return 0; // fallback
}

function findColIndex(headers, candidates) {
  const map = headers.map((h) => normKey(h));
  for (const c of candidates) {
    const idx = map.indexOf(normKey(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    let date = searchParams.get("date");

    if (!date) {
      return NextResponse.json({ ok: false, error: "MISSING_DATE" }, { status: 400 });
    }

    date = normDateForMatch(date);

    // nếu date là serial
    if (/^\d+(\.\d+)?$/.test(date)) {
      const dmy = excelSerialToDMY(date);
      if (dmy) date = normDateForMatch(dmy);
    }

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // đọc CONFIG_KPI để lấy range theo date
    const cfg = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CONFIG_KPI!A2:B",
    });

    const cfgRows = cfg.data.values || [];
    const found = cfgRows.find((r) => {
      let d = normDateForMatch(r?.[0]);
      if (/^\d+(\.\d+)?$/.test(d)) {
        const dmy = excelSerialToDMY(d);
        if (dmy) d = normDateForMatch(dmy);
      }
      return d === date;
    });

    if (!found) {
      return NextResponse.json(
        { ok: false, error: "DATE_NOT_FOUND", date },
        { status: 200 }
      );
    }

    const range = found?.[1];
    if (!range) {
      return NextResponse.json(
        { ok: false, error: "RANGE_NOT_FOUND", date },
        { status: 200 }
      );
    }

    // đọc KPI range
    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = r.data.values || [];

    if (!values.length) {
      return NextResponse.json({ ok: true, date, range, lines: [] });
    }

    const headerRowIndex = findHeaderRow(values);
    const headers = values[headerRowIndex] || [];

    // cột cố định
    const colLine = 0; // cột A thường là CHUYỀN (C1,C2...)
    const colMaHang = findColIndex(headers, ["MH", "MÃHÀNG", "MÃ HÀNG", "MAHANG"]);
    const colDmNgay = findColIndex(headers, ["DM/NGÀY", "DMNGÀY", "DMNGAY"]);
    const colAfter1630 = findColIndex(headers, [">16H30", "->16H30", "AFTER16H30", "AFTER 16H30"]);

    const lines = [];

    for (let i = headerRowIndex + 1; i < values.length; i++) {
      const row = values[i] || [];
      const line = norm(row[colLine]);
      if (!line) continue;

      // bỏ dòng tổng / tiêu đề phụ
      const key = normKey(line);
      if (key.startsWith("TOTAL") || key.startsWith("DATE")) continue;

      const maHang = colMaHang >= 0 ? norm(row[colMaHang]) : "";
      const dmNgay = colDmNgay >= 0 ? toNumberSafe(row[colDmNgay]) : 0;
      const after1630 = colAfter1630 >= 0 ? toNumberSafe(row[colAfter1630]) : 0;

      const hs = dmNgay > 0 ? (after1630 / dmNgay) * 100 : 0;
      const status = hs >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      // chỉ lấy những dòng giống chuyền (C1,C2,C10...) hoặc các line đặc biệt
      if (!/^C\d+$/i.test(line) && !["CẮT", "KCS", "HOÀN TẤT", "NM", "NN"].includes(line.toUpperCase())) {
        continue;
      }

      lines.push({
        chuyen: line,
        maHang: maHang || "-",
        hsDat: Number.isFinite(hs) ? Number(hs.toFixed(2)) : 0,
        trangThai: status,
      });
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      meta: { headerRowIndex, headers },
      lines,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}