import { NextResponse } from "next/server";
import { getSheetsClient, getSpreadsheetId } from "../_lib/googleSheetsClient";

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

function normDate(s) {
  let t = (s ?? "").toString().trim().replace(/\s+/g, "").replace(/-/g, "/");
  if (/^\d+(\.\d+)?$/.test(t)) {
    const dmy = excelSerialToDMY(t);
    if (dmy) t = dmy.replace(/\s+/g, "");
  }
  return t;
}

function key(s) {
  return (s ?? "").toString().trim().toUpperCase().replace(/\s+/g, "");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  const t = String(v).trim();
  if (!t) return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findHeaderRow(values) {
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const joined = row.map(key).join("|");
    if (joined.includes("DM/NGÀY") && (joined.includes("DM/H") || joined.includes("DMH"))) return i;
  }
  return 0;
}

function findCol(headers, candidates) {
  const map = headers.map(key);
  for (const c of candidates) {
    const idx = map.indexOf(key(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateIn = searchParams.get("date");
    const lineReq = (searchParams.get("line") || "").trim(); // optional

    if (!dateIn) {
      return NextResponse.json({ ok: false, error: "MISSING_DATE" }, { status: 400 });
    }

    const date = normDate(dateIn);

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // 1) lấy range theo date trong CONFIG_KPI
    const cfg = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CONFIG_KPI!A2:B",
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const cfgRows = cfg.data.values || [];
    const found = cfgRows.find((r) => normDate(r?.[0]) === date);

    if (!found) {
      return NextResponse.json({ ok: false, error: "DATE_NOT_FOUND", date }, { status: 200 });
    }

    const range = found?.[1];
    if (!range) {
      return NextResponse.json({ ok: false, error: "RANGE_NOT_FOUND", date }, { status: 200 });
    }

    // 2) đọc KPI range
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = r.data.values || [];
    if (!values.length) {
      return NextResponse.json({ ok: true, date, range, lines: [], perLine: [], meta: { headers: [] } });
    }

    const headerRowIndex = findHeaderRow(values);
    const headers = values[headerRowIndex] || [];

    const colLine = 0; // cột A
    const colMH = findCol(headers, ["MH", "MÃHÀNG", "MÃ HÀNG"]);
    const colDMN = findCol(headers, ["DM/NGÀY", "DMNGÀY", "DMNGAY"]);
    const colDMH = findCol(headers, ["DM/H", "DMH"]);

    // tìm cột mốc cuối (ưu tiên >16h30)
    const colLast = (() => {
      const idx = headers.findIndex((h) => key(h).includes(">16H30") || key(h).includes("->16H30"));
      if (idx >= 0) return idx;
      // fallback: lấy cột cuối cùng có header dạng >...h
      let last = -1;
      headers.forEach((h, i) => {
        const k = key(h);
        if (k.startsWith(">") || k.startsWith("->")) last = i;
      });
      return last;
    })();

    // 3) build summary lines (cho bảng bên trái)
    const lines = [];
    for (let i = headerRowIndex + 1; i < values.length; i++) {
      const row = values[i] || [];
      const line = (row[colLine] || "").toString().trim();
      if (!/^C\d+$/i.test(line)) continue;

      const mh = colMH >= 0 ? (row[colMH] || "-") : "-";
      const dmNgay = colDMN >= 0 ? toNumberSafe(row[colDMN]) : 0;
      const lastVal = colLast >= 0 ? toNumberSafe(row[colLast]) : 0;

      const hs = dmNgay > 0 ? (lastVal / dmNgay) * 100 : 0;

      lines.push({
        line,
        mh,
        hs_dat: Number(hs.toFixed(2)),
        hs_dm: 100,
        status: hs >= 100 ? "ĐẠT" : "KHÔNG ĐẠT",
      });
    }

    // 4) nếu có line=C1 thì trả thêm perLine cho bảng bên phải
    let perLine = [];
    if (lineReq) {
      const row = values.slice(headerRowIndex + 1).find((r) => (r?.[colLine] || "").toString().trim() === lineReq);
      if (row) {
        const mh = colMH >= 0 ? (row[colMH] || "-") : "-";
        const dmNgay = colDMN >= 0 ? toNumberSafe(row[colDMN]) : 0;
        const dmH = colDMH >= 0 ? toNumberSafe(row[colDMH]) : 0;

        // các cột mốc giờ: header bắt đầu bằng > hoặc ->
        perLine = headers
          .map((h, idx) => ({ h: (h || "").toString().trim(), idx }))
          .filter((x) => {
            const k = key(x.h);
            return k.startsWith(">") || k.startsWith("->");
          })
          .map((x) => ({
            moc: x.h,
            luy_tien: toNumberSafe(row[x.idx]),
            dm_h: dmH,
            dm_ngay: dmNgay,
            mh,
            line: lineReq,
          }));
      }
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,                // bảng trái
      perLine,              // bảng phải (khi có ?line=C1)
      meta: { headers },    // giữ đúng key UI hay dùng
      headerRowIndex,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}