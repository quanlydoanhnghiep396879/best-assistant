// app/api/check-kpi/route.js
import { getSheetsClient } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic"; // tránh cache ở Vercel

// ===== Helpers =====
const noMark = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const norm = (s) =>
  noMark(s)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

function toNumberSafe(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const t = String(v).trim();
  if (!t) return null;

  // bỏ % và dấu phẩy ngăn cách nghìn
  const cleaned = t.replace(/%/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isLikelyDateCell(x) {
  const t = String(x ?? "").trim();
  // dd/MM/yyyy hoặc dd/MM
  return /^\d{2}\/\d{2}(\/\d{4})?$/.test(t);
}

function parseHourFactor(label) {
  // label dạng "->9h", "->12h30"
  const s = norm(label).replace(/^->/g, "");
  const m = s.match(/^(\d{1,2})H(\d{1,2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const factor = hh + mm / 60 - 8; // 9h=1, 10h=2, 12h30=4.5...
  return factor > 0 ? factor : null;
}

function sortLine(a, b) {
  const na = norm(a);
  const nb = norm(b);
  const ma = na.match(/^C(\d+)$/);
  const mb = nb.match(/^C(\d+)$/);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  if (ma && !mb) return -1;
  if (!ma && mb) return 1;
  return na.localeCompare(nb, "vi");
}

function shouldSkipLine(lineNorm) {
  // bạn muốn bỏ: CẮT, HOÀN TẤT, KCS, NM
  return (
    lineNorm === "CAT" ||
    lineNorm === "CẮT" ||
    lineNorm === "HOAN TAT" ||
    lineNorm === "HOÀN TẤT" ||
    lineNorm === "KCS" ||
    lineNorm === "NM"
  );
}

function pickEnvSheetId() {
  return (
    process.env.GOOGLE_SHEET_ID ||
    process.env.SPREADSHEET_ID || // fallback nếu bạn lỡ đặt tên cũ
    ""
  );
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || "").trim(); // dd/MM/yyyy
    const lineParam = (searchParams.get("line") || "TỔNG HỢP").trim();

    if (!date) {
      return Response.json({ ok: false, error: "Thiếu query ?date=dd/MM/yyyy" }, { status: 400 });
    }

    const spreadsheetId = pickEnvSheetId();
    if (!spreadsheetId) {
      return Response.json(
        { ok: false, error: "Thiếu env GOOGLE_SHEET_ID" },
        { status: 500 }
      );
    }

    const KPI_SHEET_NAME = process.env.KPI_SHEET_NAME || "KPI";

    const sheets = await getSheetsClient();

    // đọc rộng để khỏi phụ thuộc vị trí cột
    const range = `${KPI_SHEET_NAME}!A1:AZ500`;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp.data.values || [];
    if (!values.length) {
      return Response.json({ ok: false, error: "Sheet rỗng hoặc không đọc được" }, { status: 500 });
    }

    const target = norm(date);
    const short = norm(date.replace(/\/\d{4}$/, "")); // dd/MM

    // ===== 1) TÌM BLOCK THEO NGÀY =====
    // ưu tiên tìm ở cột A (đúng như file bạn đang để ngày ở A)
    let startRow = -1;
    for (let r = 0; r < values.length; r++) {
      const v = values[r]?.[0];
      const nv = norm(v);
      if (nv === target || nv === short) {
        startRow = r;
        break;
      }
    }
    // fallback: quét toàn sheet
    if (startRow < 0) {
      outer: for (let r = 0; r < values.length; r++) {
        const row = values[r] || [];
        for (let c = 0; c < row.length; c++) {
          const nv = norm(row[c]);
          if (nv === target || nv === short) {
            startRow = r;
            break outer;
          }
        }
      }
    }

    if (startRow < 0) {
      return Response.json(
        { ok: false, error: `Không tìm thấy ngày ${date} trong tab ${KPI_SHEET_NAME}` },
        { status: 404 }
      );
    }

    // endRow = trước ngày tiếp theo (để không dính 23/12)
    let endRow = values.length;
    for (let r = startRow + 1; r < values.length; r++) {
      const v = values[r]?.[0];
      if (isLikelyDateCell(v) && r > startRow) {
        endRow = r;
        break;
      }
    }

    const block = values.slice(startRow, endRow);

    // ===== 2) TÌM HEADER CỦA BẢNG "THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY" =====
    // header phải có DM/H và có mốc giờ (->9h)
    let headerIdx = -1;
    for (let i = 0; i < block.length; i++) {
      const row = block[i] || [];
      const rowN = row.map(norm);

      const hasDMH = rowN.some((x) => x === "DM/H" || x === "DMH" || x === "DM /H");
      const hasHour = rowN.some((x) => x.startsWith("->") && x.includes("H"));

      // ở file bạn, header có ->9h, ->10h... và DM/H
      if (hasDMH && hasHour) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx < 0) {
      return Response.json(
        { ok: false, error: "Không tìm thấy header bảng giờ (có DM/H và ->9h...)." },
        { status: 500 }
      );
    }

    const header = block[headerIdx] || [];
    const headerN = header.map(norm);

    const colDMH = headerN.findIndex((x) => x === "DM/H" || x === "DMH" || x === "DM /H");

    // cố tìm cột chuyền
    let colLine = headerN.findIndex((x) => x.includes("CHUYEN") || x.includes("CHUYỀN") || x === "LINE");
    if (colLine < 0) colLine = Math.max(0, colDMH - 1); // fallback: ngay trước DM/H

    // cột hiệu suất ngày (ở file bạn nằm bên phải)
    const colHsDat = headerN.findIndex((x) => x.includes("SUAT DAT TRONG NGAY"));
    const colHsDm = headerN.findIndex((x) => x.includes("DINH MUC TRONG NGAY"));

    if (colHsDat < 0 || colHsDm < 0) {
      return Response.json(
        {
          ok: false,
          error:
            "Không thấy cột 'SUẤT ĐẠT TRONG NGÀY' hoặc 'ĐỊNH MỨC TRONG NGÀY' trong header. Hãy kiểm tra đúng tiêu đề trên sheet.",
        },
        { status: 500 }
      );
    }

    // lấy danh sách cột giờ
    const hourCols = [];
    for (let c = 0; c < header.length; c++) {
      const hn = headerN[c];
      if (hn.startsWith("->") && hn.includes("H")) {
        hourCols.push({ c, label: String(header[c] ?? "").trim() || hn });
      }
    }

    // ===== 3) ĐỌC DATA ROWS =====
    const rawRows = [];
    for (let i = headerIdx + 1; i < block.length; i++) {
      const row = block[i] || [];
      const line = String(row[colLine] ?? "").trim();
      if (!line) continue;

      const lineNorm = norm(line);
      if (shouldSkipLine(lineNorm)) continue;

      const dmH = toNumberSafe(row[colDMH]);

      const hsDat = toNumberSafe(row[colHsDat]);
      const hsDm = toNumberSafe(row[colHsDm]);

      // nếu cả 3 đều null thì bỏ
      if (dmH === null && hsDat === null && hsDm === null) continue;

      const hourValues = {};
      for (const hc of hourCols) {
        hourValues[hc.label] = toNumberSafe(row[hc.c]) ?? 0;
      }

      rawRows.push({
        line: line.toUpperCase(),
        dmH: dmH ?? 0,
        hsDat: hsDat ?? 0,
        hsDm: hsDm ?? 0,
        hourValues,
      });
    }

    if (!rawRows.length) {
      return Response.json(
        {
          ok: true,
          chosenDate: date,
          lines: ["TỔNG HỢP"],
          selectedLine: "TỔNG HỢP",
          dailyRows: [],
          hourly: { line: "TỔNG HỢP", dmH: 0, hours: [] },
          _debug: { startRow, endRow, headerIdx, note: "Không lấy được row dữ liệu dưới header." },
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===== 4) DAILY ROWS (ĐẠT/CHƯA ĐẠT theo HS đạt vs HS ĐM) =====
    const dailyRows = rawRows
      .map((r) => ({
        line: r.line,
        hsDat: r.hsDat,
        hsDm: r.hsDm,
        status: r.hsDat >= r.hsDm ? "ĐẠT" : "CHƯA ĐẠT",
      }))
      .sort((a, b) => sortLine(a.line, b.line));

    // ===== 5) LINES LIST =====
    const lines = ["TỔNG HỢP", ...dailyRows.map((x) => x.line)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => {
        if (a === "TỔNG HỢP") return -1;
        if (b === "TỔNG HỢP") return 1;
        return sortLine(a, b);
      });

    // ===== 6) PICK SELECTED LINE =====
    const want = norm(lineParam);
    let selectedLine = "TỔNG HỢP";
    const found = lines.find((x) => norm(x) === want);
    if (found) selectedLine = found;

    // ===== 7) HOURLY for selected line =====
    let base;
    if (selectedLine === "TỔNG HỢP") {
      // tổng hợp = cộng tất cả chuyền
      const sumDmH = rawRows.reduce((s, r) => s + (r.dmH || 0), 0);
      const sumHour = {};
      for (const hc of hourCols) sumHour[hc.label] = 0;
      for (const r of rawRows) {
        for (const hc of hourCols) sumHour[hc.label] += r.hourValues[hc.label] || 0;
      }
      base = { line: "TỔNG HỢP", dmH: sumDmH, hourValues: sumHour };
    } else {
      base = rawRows.find((r) => norm(r.line) === norm(selectedLine));
      if (!base) base = { line: selectedLine, dmH: 0, hourValues: {} };
    }

    const hours = hourCols.map((hc) => {
      const label = hc.label;
      const total = Number(base.hourValues?.[label] ?? 0) || 0;

      const factor = parseHourFactor(label);
      const dmTarget = factor ? (base.dmH || 0) * factor : 0;
      const diff = total - dmTarget;

      return {
        label,
        total,
        dmTarget,
        diff,
        status: diff >= 0 ? "VƯỢT" : "THIẾU",
      };
    });

    return Response.json(
      {
        ok: true,
        chosenDate: date,
        lines,
        selectedLine,
        dailyRows,
        hourly: {
          line: base.line,
          dmH: base.dmH || 0,
          hours,
        },
        _debug: { startRow, endRow, headerIdx, rowCount: rawRows.length },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}