// app/api/check-kpi/route.js
import { readValues, sheetNames } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseInputDateToDMY(s) {
  // chấp nhận: dd/mm/yyyy | dd/mm | yyyy-mm-dd
  if (!s) return "";
  const t = String(s).trim();

  // yyyy-mm-dd
  const mIso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) return `${mIso[3]}/${mIso[2]}/${mIso[1]}`;

  // dd/mm/yyyy
  const mDMY = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mDMY) return `${pad2(mDMY[1])}/${pad2(mDMY[2])}/${mDMY[3]}`;
  // dd/mm
  const mDM = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mDM) {
    // nếu thiếu năm thì giữ dd/mm (API vẫn tìm được block)
    return `${pad2(mDM[1])}/${pad2(mDM[2])}`;
  }

  return t;
}

function toShortDM(dmy) {
  // "dd/mm/yyyy" -> "dd/mm"
  const m = String(dmy).match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}/${m[2]}`;
  // nếu đã dd/mm
  const m2 = String(dmy).match(/^(\d{2})\/(\d{2})$/);
  if (m2) return `${m2[1]}/${m2[2]}`;
  return dmy;
}

function isLineCode(v) {
  const s = String(v || "").trim().toUpperCase();
  return /^C\d+$/.test(s) || ["CẮT", "CAT", "KCS", "HOÀN TẤT", "HOAN TAT", "NM"].includes(s);
}

function norm(s) {
  return String(s || "").trim().toUpperCase();
}

function findHeaderCols(block) {
  // tìm cột theo tiêu đề (tối đa AZ)
  const out = {
    colLine: 0,
    colMH: -1,
    colHsDat: -1,
    colHsDm: -1,
    colTotalKiemDat: -1,
    hourCols: [], // [{label, idx}]
  };

  for (let r = 0; r < block.length; r++) {
    const row = block[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = norm(row[c]);

      if (cell === "MÃ HÀNG" || cell === "MA HANG") out.colMH = c;

      // TOTAL KIỂM ĐẠT
      if (cell.includes("TOTAL") && cell.includes("KIỂM") && cell.includes("ĐẠT")) out.colTotalKiemDat = c;
      if (out.colTotalKiemDat === -1 && cell.includes("KIỂM") && cell.includes("ĐẠT")) out.colTotalKiemDat = c;

      // HS đạt / HS đm
      if (cell.includes("HS") && (cell.includes("ĐẠT") || cell.includes("DAT"))) out.colHsDat = c;
      if (cell.includes("HS") && (cell.includes("ĐM") || cell.includes("DINH MUC") || cell.includes("ĐỊNH MỨC"))) out.colHsDm = c;

      // cột giờ (08:00 / 8:00)
      const raw = String(row[c] || "").trim();
      if (/^\d{1,2}:\d{2}$/.test(raw)) {
        out.hourCols.push({ label: raw, idx: c });
      }
    }
  }

  // nếu có nhiều cột giờ, sắp theo thứ tự tăng dần
  out.hourCols.sort((a, b) => {
    const pa = a.label.split(":").map(Number);
    const pb = b.label.split(":").map(Number);
    return pa[0] * 60 + pa[1] - (pb[0] * 60 + pb[1]);
  });

  return out;
}

function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function computeStatusCompare(a, b) {
  // so sánh số lượng (a so với b)
  if (a === b) return { ok: true, status: "ĐỦ" };
  if (a > b) return { ok: true, status: "VƯỢT" };
  return { ok: false, status: "THIẾU" };
}

function computeOkHs(hsDat, hsDm) {
  // yêu cầu của bạn: >= là đạt
  const ok = hsDat >= hsDm;
  return { ok, status: ok ? "ĐẠT" : "KHÔNG ĐẠT" };
}

function findDateBlock(fullValues, shortDM) {
  // tìm dòng cột A đúng "dd/mm" hoặc "dd/mm/yyyy"
  const target = norm(shortDM);
  const target2 = norm(shortDM) + "/"; // bắt dd/mm/yyyy

  let dateRow = -1;
  for (let r = 0; r < fullValues.length; r++) {
    const a = norm((fullValues[r] || [])[0]);
    if (a === target) {
      dateRow = r;
      break;
    }
    if (a.startsWith(target2)) {
      dateRow = r;
      break;
    }
  }
  if (dateRow === -1) return { start: -1, end: -1 };

  // block bắt đầu từ dòng sau dateRow
  const start = dateRow + 1;

  // block kết thúc trước ngày kế tiếp (một cell cột A kiểu dd/mm)
  let end = fullValues.length - 1;
  for (let r = start + 1; r < fullValues.length; r++) {
    const a = norm((fullValues[r] || [])[0]);
    if (/^\d{2}\/\d{2}$/.test(a)) {
      end = r - 1;
      break;
    }
  }

  return { start, end };
}

async function readConfigDates() {
  const { CONFIG_KPI_SHEET_NAME } = sheetNames();
  const rows = await readValues(`${CONFIG_KPI_SHEET_NAME}!A2:A`);
  const dates = rows.map(r => String(r[0] || "").trim()).filter(Boolean);

  // sort desc theo dd/mm/yyyy nếu đúng format
  dates.sort((a, b) => {
    const pa = a.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const pb = b.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!pa || !pb) return 0;``
    const da = new Date(`${pa[3]}-${pa[2]}-${pa[1]}`).getTime();
    const db = new Date(`${pb[3]}-${pb[2]}-${pb[1]}`).getTime();
    return db - da;
  });

  return dates;
}

export async function GET(request) {
  try {
    const qDate = request.nextUrl.searchParams.get("date") || "";
    const qHour = request.nextUrl.searchParams.get("hour") || "";

    const { KPI_SHEET_NAME } = sheetNames();

    const dates = await readConfigDates();
    const chosenDate = parseInputDateToDMY(qDate) || (dates[0] ? parseInputDateToDMY(dates[0]) : "");
    const shortDM = toShortDM(chosenDate);

    // đọc KPI sheet rộng đủ (bạn có thể tăng 1000 nếu sheet dài)
    const full = await readValues(`${KPI_SHEET_NAME}!A1:AZ1000`);
    const { start, end } = findDateBlock(full, shortDM);

    if (start === -1) {
      return Response.json({
        ok: false,
        error: `Không tìm thấy block ngày "${shortDM}" trong sheet KPI (cột A). Hãy đảm bảo có ô dạng ${shortDM} như hình bạn gửi.`,
        meta: { dates, hourCandidates: [] },
      });
    }

    const block = full.slice(start, end + 1);
    const cols = findHeaderCols(block);

    // giờ candidates lấy từ header row có dạng 08:00...
    const hourCandidates = cols.hourCols.map(x => x.label);
    const selectedHour = qHour && hourCandidates.includes(qHour)
      ? qHour
      : (hourCandidates.length ? hourCandidates[hourCandidates.length - 1] : "");

    // parse line rows
    const perf = [];
    const qc = [];

    for (let r = 0; r < block.length; r++) {
      const row = block[r] || [];
      const line = String(row[0] || "").trim();
      if (!isLineCode(line)) continue;

      const mh = cols.colMH >= 0 ? String(row[cols.colMH] || "").trim() : "";

      const hs_dat = cols.colHsDat >= 0 ? toNumber(row[cols.colHsDat]) : 0;
      const hs_dm  = cols.colHsDm >= 0 ? toNumber(row[cols.colHsDm]) : 0;
      const hsCmp = computeOkHs(hs_dat, hs_dm);

      perf.push({
        line,
        mh,
        hs_dat,
        hs_dm,
        ok: hsCmp.ok,
        status: hsCmp.status,
      });

      const totalKiemDat = cols.colTotalKiemDat >= 0 ? toNumber(row[cols.colTotalKiemDat]) : 0;

      let dmGio = 0;
      if (selectedHour) {
        const found = cols.hourCols.find(x => x.label === selectedHour);
        if (found) dmGio = toNumber(row[found.idx]);
      }

      const cmp = computeStatusCompare(totalKiemDat, dmGio);
      qc.push({
        line,
        mh,
        totalKiemDat,
        dmGio,
        delta: totalKiemDat - dmGio,
        ok: cmp.ok,
        status: dmGio ? cmp.status : "CHƯA CÓ ĐM GIỜ",
      });
    }

    // thống kê nhanh
    const perf_ok = perf.filter(x => x.ok).length;
    const perf_fail = perf.length - perf_ok;

    const qc_ok = qc.filter(x => x.ok).length;
    const qc_fail = qc.length - qc_ok;

    return Response.json({
      ok: true,
      date: chosenDate,
      shortDM,
      meta: {
        dates,
        hourCandidates,
        selectedHour,
        stats: {
          perf_total: perf.length,
          perf_ok,
          perf_fail,
          qc_total: qc.length,
          qc_ok,
          qc_fail,
        },
      },
      perf,
      qc,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || String(e) });
  }
}