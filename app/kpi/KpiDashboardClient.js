// app/kpi/KpiDashboardClient.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function norm(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[._-]/g, "");
}

// parse số rất “trâu” cho dữ liệu Sheets (có , . % …)
function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  let t = String(v).trim();
  if (!t) return 0;

  // bỏ % và khoảng trắng
  t = t.replace(/%/g, "").replace(/\s+/g, "");

  // dấu gạch / text đặc biệt
  if (t === "-" || t.toLowerCase() === "null") return 0;

  // 1) dạng 1.234,56 (VN) => 1234.56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    t = t.replace(/\./g, "").replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }

  // 2) dạng 1,234.56 (US) => 1234.56
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
    t = t.replace(/,/g, "");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }

  // 3) fallback: bỏ dấu phẩy ngăn nghìn
  t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function findIdx(headers, candidates) {
  const h = headers.map(norm);
  for (const c of candidates) {
    const idx = h.findIndex((x) => x.includes(norm(c)));
    if (idx >= 0) return idx;
  }
  return -1;
}

function isHourCol(h) {
  const s = String(h || "").trim();
  // ví dụ: ">9h ->10h", "->11h", "->12h30", ...
  return /->|→/.test(s) || /\b\d{1,2}h(\d{1,2})?\b/i.test(s);
}

export default function KpiDashboardClient({ initialQuery }) {
  const router = useRouter();

  const [date, setDate] = useState(initialQuery?.date || "");
  const [status, setStatus] = useState(initialQuery?.status || "all");
  const [q, setQ] = useState(initialQuery?.q || "");
  const [auto, setAuto] = useState(Boolean(initialQuery?.auto ?? true));

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  // đồng bộ query lên URL (để bạn share link vẫn đúng)
  useEffect(() => {
    const sp = new URLSearchParams();
    if (date) sp.set("date", date);
    if (status && status !== "all") sp.set("status", status);
    if (q) sp.set("q", q);
    sp.set("auto", auto ? "1" : "0");
    router.replace(`/kpi?${sp.toString()}`, { scroll: false });
  }, [date, status, q, auto, router]);

  async function fetchKpi(d) {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.message || "CHECK_KPI_ERROR");
      setData(json);
    } catch (e) {
      setData(null);
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // load lần đầu + khi đổi ngày
  useEffect(() => {
    if (date) fetchKpi(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // auto refresh 1 phút
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      if (date) fetchKpi(date);
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const lines = useMemo(() => {
    const arr = data?.lines || [];
    const keyword = q.trim().toLowerCase();

    let out = arr;

    if (status === "dat") out = out.filter(x => x.status === "ĐẠT");
    if (status === "kdat") out = out.filter(x => x.status !== "ĐẠT");

    if (keyword) {
      out = out.filter(x =>
        String(x.line || "").toLowerCase().includes(keyword) ||
        String(x.mh || "").toLowerCase().includes(keyword)
      );
    }

    return out;
  }, [data, q, status]);

  const stats = useMemo(() => {
    const total = lines.length;
    const dat = lines.filter(x => x.status === "ĐẠT").length;
    const kdat = total - dat;
    return { total, dat, kdat, showing: total };
  }, [lines]);

  // ====== tạo bảng “KIỂM ĐẠT luỹ tiến” từ values/raw headers (nếu sheet có cột giờ) ======
  const luyTien = useMemo(() => {
    const values = data?.values;
    if (!Array.isArray(values) || values.length < 2) return null;

    const headers = values[0] || [];
    const rows = values.slice(1);

    const hourIdxs = [];
    headers.forEach((h, i) => {
      if (isHourCol(h)) hourIdxs.push(i);
    });

    if (hourIdxs.length === 0) return null;

    const idxLine = 0; // cột A
    const idxDMNgay = findIdx(headers, ["DM/NGAY", "ĐM/NGÀY", "DINH MUC NGAY", "DM NGAY"]);

    const items = rows
      .map(r => {
        const line = String(r[idxLine] ?? "").trim();
        if (!line) return null;

        const dm = idxDMNgay >= 0 ? toNumberSafe(r[idxDMNgay]) : 0;

        let sum = 0;
        const cols = hourIdxs.map(ix => {
          const v = toNumberSafe(r[ix]);
          sum += v;
          return { label: String(headers[ix] ?? ""), v, cum: sum };
        });

        return { line, dm, cols };
      })
      .filter(Boolean);

    return { headers, hourIdxs, items };
  }, [data]);

  return (
    <div className="kpi-wrap">
      <h1 className="kpi-title">KPI Dashboard</h1>

      {err ? (
        <div className="kpi-error">
          <b>Lỗi:</b> {err}
          <div className="kpi-hint">
            Gợi ý: mở thử <code>/api/check-kpi?date=...</code> để xem JSON có <code>ok:true</code> và <code>lines</code> không.
          </div>
        </div>
      ) : null}

      <div className="kpi-toolbar">
        <label className="kpi-field">
          <div className="kpi-label">Ngày</div>
          <input
            className="kpi-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="DD/MM/YYYY"
          />
        </label>

        <label className="kpi-field">
          <div className="kpi-label">Lọc trạng thái</div>
          <select className="kpi-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Tất cả</option>
            <option value="dat">ĐẠT</option>
            <option value="kdat">KHÔNG ĐẠT</option>
          </select>
        </label>

        <label className="kpi-field kpi-field-grow">
          <div className="kpi-label">Tìm (chuyền / MH)</div>
          <input
            className="kpi-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="VD: C1 / 088AG / Baby Carrier..."
          />
        </label>

        <label className="kpi-check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Tự cập nhật (1 phút)</span>
        </label>

        <button className="kpi-btn" onClick={() => fetchKpi(date)} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="kpi-cards">
        <div className="kpi-card"><div className="kpi-card-title">Tổng dòng</div><div className="kpi-card-val">{stats.total}</div></div>
        <div className="kpi-card kpi-card-ok"><div className="kpi-card-title">ĐẠT</div><div className="kpi-card-val">{stats.dat}</div></div>
        <div className="kpi-card kpi-card-bad"><div className="kpi-card-title">KHÔNG ĐẠT</div><div className="kpi-card-val">{stats.kdat}</div></div>
        <div className="kpi-card"><div className="kpi-card-title">Đang hiển thị</div><div className="kpi-card-val">{stats.showing}</div></div>
      </div>

      <h2 className="kpi-subtitle">Bảng KPI</h2>

      <div className="kpi-table-wrap">
        <table className="kpi-table">
          <thead>
            <tr>
              <th>Chuyền</th>
              <th>MH</th>
              <th className="kpi-num">AFTER 16H30</th>
              <th className="kpi-num">DM/NGÀY</th>
              <th className="kpi-num">%</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="kpi-empty">
                  {loading ? "Đang tải..." : "Không có dữ liệu để hiển thị."}
                </td>
              </tr>
            ) : (
              lines.map((x, i) => {
                const ok = x.status === "ĐẠT";
                return (
                  <tr key={i} className={ok ? "row-ok" : "row-bad"}>
                    <td>{x.line}</td>
                    <td>{x.mh}</td>
                    <td className="kpi-num">{x.hs_dat}</td>
                    <td className="kpi-num">{x.hs_dm}</td>
                    <td className="kpi-num">{x.percent}</td>
                    <td>
                      <span className={ok ? "badge badge-ok" : "badge badge-bad"}>
                        {x.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Bảng kiểm đạt luỹ tiến (nếu có cột giờ) ===== */}
      {luyTien ? (
        <>
          <h2 className="kpi-subtitle">Kiểm đạt luỹ tiến (theo các cột giờ trong Sheet)</h2>
          <div className="kpi-table-wrap">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền</th>
                  {luyTien.hourIdxs.map((ix) => (
                    <th key={ix} className="kpi-num">{String(luyTien.headers[ix] || "")}</th>
                  ))}
                  <th className="kpi-num">Luỹ tiến</th>
                  <th className="kpi-num">% vs DM/NGÀY</th>
                </tr>
              </thead>
              <tbody>
                {luyTien.items.map((it, idx) => {
                  const last = it.cols[it.cols.length - 1];
                  const cum = last?.cum ?? 0;
                  const pct = it.dm > 0 ? (cum / it.dm) * 100 : 0;
                  const ok = pct >= 100;

                  return (
                    <tr key={idx} className={ok ? "row-ok" : "row-bad"}>
                      <td>{it.line}</td>
                      {it.cols.map((c, j) => (
                        <td key={j} className="kpi-num">{c.cum}</td>
                      ))}
                      <td className="kpi-num"><b>{cum}</b></td>
                      <td className="kpi-num">{Number(pct.toFixed(2))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {/* Debug */}
      {data?.meta ? (
        <details className="kpi-debug">
          <summary>Debug (meta)</summary>
          <pre>{JSON.stringify(data.meta, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}