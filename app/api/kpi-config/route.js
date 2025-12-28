import { NextResponse } from "next/server";
import { getSheetsClient } from "../_lib/googleSheetsClient";

export const dynamic = "force-dynamic";

function serialToDateVN(serial) {
  // Google/Excel serial: 1899-12-30
  const base = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(base.getTime() + Number(serial) * 86400000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDateCell(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return serialToDateVN(v);

  const s = String(v).trim();
  if (!s) return "";

  // nếu là số dạng "46014"
  if (/^\d+(\.\d+)?$/.test(s)) return serialToDateVN(Number(s));

  // dạng dd/mm/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split("/");
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }

  // dạng yyyy-mm-dd
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }

  return s;
}

export async function GET() {
  try {
    const CONFIG_SHEET = process.env.CONFIG_KPI_SHEET_NAME || "CONFIG_KPI";
    const range = `${CONFIG_SHEET}!A1:B200`;

    const { sheets, sheetId } = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
    const values = resp.data.values || [];

    if (values.length < 2) {
      return NextResponse.json(
        { status: "success", dates: [], configRows: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const header = values[0].map((x) => String(x || "").trim().toUpperCase());
    const idxDate = header.indexOf("DATE");
    const idxRange = header.indexOf("RANGE");

    if (idxDate === -1 || idxRange === -1) {
      return NextResponse.json(
        { status: "error", message: "CONFIG_KPI phải có header: DATE | RANGE" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const configRows = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const date = normalizeDateCell(row[idxDate]);
      const r = String(row[idxRange] || "").trim();
      if (date && r) configRows.push({ date, range: r });
    }

    // sort theo ngày
    const toKey = (d) => {
      const [dd, mm, yy] = d.split("/");
      return `${yy}-${mm}-${dd}`;
    };
    configRows.sort((a, b) => toKey(a.date).localeCompare(toKey(b.date)));

    const dates = Array.from(new Set(configRows.map((x) => x.date)));

    return NextResponse.json(
      { status: "success", dates, configRows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: e?.message || String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
