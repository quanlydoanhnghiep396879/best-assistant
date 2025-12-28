import { NextResponse } from "next/server";
import { getSheetsClient } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

function stripDiacritics(s) {
  try {
    return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  } catch {
    return s;
  }
}
function normHeader(s) {
  return stripDiacritics(String(s || ""))
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9\-\/>]/g, "");
}
function toNum(v) {
  if (v === null || v === undefined) return 0;
  const t = String(v).trim();
  if (!t || t === "—" || t === "-" || t.toLowerCase() === "na") return 0;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const HS_DINH_MUC = 90; // %

const MOC_HOURS = {
  "->9h": 1,
  "->10h": 2,
  "->11h": 3,
  "->12h30": 4.5,
  "->13h30": 5.5,
  "->14h30": 6.5,
  "->15h30": 7.5,
  "->16h30": 8,
};

function pickHeaderRow(rows) {
  // tìm dòng có "chuyền"
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if ((rows[i] || []).some(c => normHeader(c).includes("chuyen"))) return i;
  }
  return 0;
}

export async function GET(req) {
  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const { searchParams } = new URL(req.url);
    const date = String(searchParams.get("date") || "").trim();

    if (!date) {
      return NextResponse.json({ ok: false, error: "Missing ?date=dd/MM/yyyy" }, { status: 400 });
    }

    // lấy range theo ngày
    const cfg = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/kpi-config?date=${encodeURIComponent(date)}`, {
      cache: "no-store",
    }).catch(() => null);

    // fallback: đọc trực tiếp config bằng sheets (ổn định hơn)
    const cfgRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CONFIG_KPI!A:B",
      valueRenderOption: "FORMATTED_VALUE",
    });
    const cfgRows = cfgRes.data.values || [];
    const cfgBody = cfgRows.slice(1)
      .map(r => ({ d: String(r?.[0] || "").trim(), range: String(r?.[1] || "").trim() }))
      .filter(x => x.d && x.range);

    const found = cfgBody.find(x => x.d === date);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: `CONFIG_KPI không có dòng DATE=${date}, availableDates: ${cfgBody.map(x => x.d)}` },
        { status: 404 }
      );
    }

    const range = found.range;

    // đọc KPI range
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = res.data.values || [];
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: `Range rỗng: ${range}` }, { status: 404 });
    }

    const headerRowIdx = pickHeaderRow(rows);
    const headerTop = rows[headerRowIdx - 1] || [];
    const header = rows[headerRowIdx] || [];
    const combinedHeaders = header.map((h, i) => {
      const top = String(headerTop[i] || "").trim();
      const sub = String(h || "").trim();
      return (top && top !== sub) ? `${top} ${sub}` : sub;
    });

    const H = combinedHeaders.map(normHeader);

    const idxChuyen = H.findIndex(x => x.includes("chuyen"));
    const idxMaHang = H.findIndex(x => x === "mh" || x.includes("mahang") || x.includes("mãhang"));
    const idxDmNgay = H.findIndex(x => x.includes("dm/ngay") || x.includes("dmngay") || x === "dm");
    const idxDmH = H.findIndex(x => x.includes("dm/h") || x.includes("dmh") || x === "h");

    // các mốc
    const mocCols = combinedHeaders
      .map((name, i) => ({ name: String(name || "").trim(), i }))
      .filter(x => String(x.name).trim().startsWith("->"));

    const dataRows = rows.slice(headerRowIdx + 1);

    const lines = [];
    const perLine = {};

    for (const r of dataRows) {
      const chuyen = String(r?.[idxChuyen] || "").trim();
      if (!chuyen) continue;

      const maHang = idxMaHang >= 0 ? String(r?.[idxMaHang] || "").trim() : "";
      const dmNgay = idxDmNgay >= 0 ? toNum(r?.[idxDmNgay]) : 0;
      const dmH = idxDmH >= 0 ? toNum(r?.[idxDmH]) : (dmNgay ? dmNgay / 8 : 0);

      // lấy lũy tiến theo mốc
      const mocs = mocCols.map(m => {
        const moc = m.name;
        const luyTien = toNum(r?.[m.i]);
        const hours = MOC_HOURS[moc] ?? 0;
        const dmLuyTien = dmH * hours;
        const chenh = luyTien - dmLuyTien;
        const trangThai = hours === 0 ? "N/A" : (chenh >= 0 ? "VƯỢT/ĐẠT" : "THIẾU");
        return { moc, luyTien, dmLuyTien: Number(dmLuyTien.toFixed(2)), chenh: Number(chenh.toFixed(2)), trangThai };
      });

      // HS ngày: dùng mốc cuối ->16h30 nếu có
      const end = mocs.find(x => x.moc === "->16h30") || mocs[mocs.length - 1];
      const tongNgay = end ? end.luyTien : 0;

      const hsDat = dmNgay > 0 ? (tongNgay / dmNgay) * 100 : 0;
      let trangThaiNgay = "CHƯA CÓ";
      if (tongNgay > 0 && dmNgay > 0) trangThaiNgay = hsDat >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";
      else if (tongNgay > 0 && dmNgay === 0) trangThaiNgay = "THIẾU DM";

      const lineObj = {
        chuyen,
        maHang: maHang || "—",
        hsDat: Number(hsDat.toFixed(2)),
        hsDinhMuc: HS_DINH_MUC,
        trangThaiNgay,
      };

      lines.push(lineObj);
      perLine[chuyen] = { chuyen, maHang: maHang || "—", dmNgay, dmH, mocs };
    }

    return NextResponse.json({
      ok: true,
      date,
      range,
      lines,
      perLine,
      meta: { headers: combinedHeaders },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}