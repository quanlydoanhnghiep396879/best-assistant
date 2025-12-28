import { getSheetsClient, getSpreadsheetId } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\w->/]/g, "");
}

function findHeaderRow(rows) {
  // tìm dòng có cả "chuyền" và "mã hàng"
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const line = (rows[i] || []).map(normKey);
    const hasChuyen = line.some((x) => x.includes("chuyen"));
    const hasMaHang = line.some((x) => x.includes("mahang"));
    if (hasChuyen && hasMaHang) return i;
  }
  return -1;
}

function parseMilestoneLabelToHours(label) {
  // label dạng "->9h", "->12h30"
  const s = String(label || "").replace("->", "").trim().toLowerCase();
  const m = s.match(/^(\d{1,2})h(\d{1,2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  // giả định bắt đầu 8:00 như sheet của bạn (->9h = 1 giờ)
  const hoursFrom8 = (hh + mm / 60) - 8;
  return hoursFrom8 > 0 ? hoursFrom8 : 0;
}

async function getConfigMap() {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "CONFIG_KPI!A:B",
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return {};

  const header = rows[0].map((x) => String(x || "").trim().toUpperCase());
  const idxDate = header.indexOf("DATE");
  const idxRange = header.indexOf("RANGE");
  if (idxDate === -1 || idxRange === -1) return {};

  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const d = String(rows[i][idxDate] || "").trim();
    const r = String(rows[i][idxRange] || "").trim();
    if (d && r) map[d] = r;
  }
  return map;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date"); // "24/12/2025"

    if (!date) {
      return Response.json({ ok: false, error: "Missing ?date=dd/mm/yyyy" }, { status: 400 });
    }

    const map = await getConfigMap();
    const range = map[date];

    if (!range) {
      return Response.json(
        { ok: false, error: `Không có RANGE cho ngày ${date} trong CONFIG_KPI`},
        { status: 404 }
      );
    }

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values || [];
    if (!rows.length) return Response.json({ ok: true, date, lines: [], meta: {} });

    const headerRowIdx = findHeaderRow(rows);
    if (headerRowIdx === -1) {
      return Response.json(
        { ok: false, error: "Không tìm thấy dòng header chứa 'Chuyền' và 'Mã hàng' trong range KPI" },
        { status: 400 }
      );
    }

    const headers = rows[headerRowIdx].map((h) => String(h || "").trim());
    const hNorm = headers.map(normKey);

    const colChuyen = hNorm.findIndex((x) => x.includes("chuyen"));
    const colMaHang = hNorm.findIndex((x) => x.includes("mahang")); // lấy mã hàng cho sếp
    const colDmNgay = hNorm.findIndex((x) => x.includes("dm/ngay") || x.includes("dmngay"));
    const colDmH = hNorm.findIndex((x) => x.includes("dm/h") || x.includes("dmh"));

    // tìm tất cả cột mốc dạng ->9h, ->10h...
    const milestoneCols = [];
    for (let c = 0; c < hNorm.length; c++) {
      if (hNorm[c].startsWith("->")) milestoneCols.push(c);
    }
    const lastMilestoneCol = milestoneCols.length ? milestoneCols[milestoneCols.length - 1] : -1;

    const dataStart = headerRowIdx + 1;
    const lines = [];

    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r] || [];
      const chuyen = String(row[colChuyen] || "").trim();
      if (!chuyen) continue;

      const maHang = colMaHang >= 0 ? String(row[colMaHang] || "").trim() : "";

      const dmNgay = colDmNgay >= 0 ? toNum(row[colDmNgay]) : 0;
      const dmH = colDmH >= 0 ? toNum(row[colDmH]) : 0;

      const luyTien = milestoneCols.map((c) => ({
        label: headers[c],
        value: toNum(row[c]),
      }));

      const last = lastMilestoneCol >= 0 ? toNum(row[lastMilestoneCol]) : 0;
      const hsDat = dmNgay > 0 && last > 0 ? (last / dmNgay) * 100 : null;

      const hsDinhMuc = 90; // bạn đang để HS định mức 90%
      const trangThaiNgay =
        hsDat === null ? "CHƯA CÓ" : hsDat >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";

      // tính DM lũy tiến & chênh theo dmH (bắt đầu 8:00)
      const luyTienWithExpected = luyTien.map((p) => {
        const hours = parseMilestoneLabelToHours(p.label);
        const expected = hours === null ? null : Math.round(dmH * hours);
        const diff = expected === null ? null : p.value - expected;
        const status =
          expected === null ? "N/A" : p.value >= expected ? "ĐẠT" : "THIẾU";
        return { ...p, expected, diff, status };
      });

      lines.push({
        chuyen,
        maHang,
        dmNgay,
        dmH,
        last,
        hsDat,
        hsDinhMuc,
        trangThaiNgay,
        luyTien: luyTienWithExpected,
      });
    }

    return Response.json({
      ok: true,
      date,
      range,
      lines,
      meta: { headerRowIdx, milestoneCount: milestoneCols.length },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}