// app/api/check-kpi/route.js
import { NextResponse } from "next/server";
import { readRange, normalizeDDMMYYYY } from "../_lib/googleSheetsClient";

export const runtime = "nodejs";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = normalizeDDMMYYYY(searchParams.get("date") || "");

    if (!dateParam) {
      return NextResponse.json({ ok: false, error: "MISSING_DATE" }, { status: 400 });
    }

    // đọc config để map date -> range
    const configRows = await readRange("CONFIG_KPI!A2:B", {
      valueRenderOption: "FORMATTED_VALUE",
    });

    let foundRange = "";
    for (const r of configRows) {
      const d = normalizeDDMMYYYY(r?.[0] || "");
      const range = (r?.[1] || "").trim();
      if (d === dateParam && range) {
        foundRange = range;
        break;
      }
    }

    if (!foundRange) {
      return NextResponse.json({ ok: false, error: "DATE_NOT_FOUND", date: dateParam });
    }

    // Đọc dữ liệu KPI theo range đã cấu hình
    const values = await readRange(foundRange, {
      valueRenderOption: "FORMATTED_VALUE",
    });

    // Bạn có thể giữ parse như code cũ của bạn.
    // Ở đây mình trả raw để UI chắc chắn có data hiển thị trước:
    return NextResponse.json({
      ok: true,
      date: dateParam,
      range: foundRange,
      values,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}