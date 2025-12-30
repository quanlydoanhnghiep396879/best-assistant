"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ===================== Helpers ===================== */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayVN() {
  const d = new Date();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// yyyy-mm-dd (input date) -> dd/mm/yyyy
function isoToVN(iso) {
  if (!iso || typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// dd/mm/yyyy -> yyyy-mm-dd
function vnToISO(vn) {
  if (!vn || typeof vn !== "string") return "";
  const m = vn.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function safeStr(x) {
  return String(x ?? "").trim();
}

function normalizeText(s) {
  return safeStr(s).toLowerCase();
}

function formatNumber(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  // giữ số nguyên nếu là integer, không thì 2 số lẻ
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  return x.toFixed(2);
}

function cls(...arr) {
  return arr.filter(Boolean).join(" ");
}

/* ===================== Component ===================== */
export default function KpiDashboardClient({ initialQuery }) {
  // query state
  const [dateVN, setDateVN] = useState(() => {
    // ưu tiên date từ URL (dd/mm/yyyy hoặc yyyy-mm-dd)
    const fromUrl = safeStr(initialQuery?.date);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fromUrl)) return fromUrl;
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromUrl)) return isoToVN(fromUrl) || todayVN();
    return todayVN();
  });

  const [status, setStatus] = useState(() => safeStr(initialQuery?.status) || "all");
  const [q, setQ] = useState(() => safeStr(initialQuery?.q) || "");
  const [auto, setAuto] = useState(() => (safeStr(initialQuery?.auto) === "0" ? false : true));

  // hour table line picker (riêng)
  const [linePick, setLinePick] = useState("ALL");

  // data
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [data, setData] = useState(null);

  const timerRef = useRef(null);

  // sync URL (để share link)
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateVN) params.set("date", dateVN);
    if (status && status !== "all") params.set("status", status);
    if (q) params.set("q", q);
    params.set("auto", auto ? "1" : "0");
    const url = `/kpi?${params.toString()}`;
    window.history.replaceState(null, "", url);
  }, [dateVN, status, q, auto]);

  async function fetchKpi() {
    try {
      setLoading(true);
      setErrorMsg("");

      const url = `/api/check-kpi?date=${encodeURIComponent(dateVN)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();

      if (!json?.ok) {
        setData(null);
        setErrorMsg(json?.message || "Lỗi không xác định từ API");
        return;
      }

      setData(json);
    } catch (e) {
      setData(null);
      setErrorMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // first load + when date changes
  useEffect(() => {
    fetchKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateVN]);

  // auto refresh
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!auto) return;

    timerRef.current = setInterval(() => {
      fetchKpi();
    }, 60 * 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, dateVN]);

  // performance rows (bảng 1)
  const perfRows = useMemo(() => {
    const rows = Array.isArray(data?.lines) ? data.lines : [];
    const qq = normalizeText(q);

    return rows.filter((r) => {
      const st = safeStr(r?.status); // "ĐẠT" / "KHÔNG ĐẠT"
      const passStatus =
        status === "all" ? true : status === "dat" ? st === "ĐẠT" : st === "KHÔNG ĐẠT";

      const hay = normalizeText(`${r?.line} ${r?.mh}`);
      const passQ = qq ? hay.includes(qq) : true;

      return passStatus && passQ;
    });
  }, [data, status, q]);

  // hour rows (bảng 2)
  const hourRows = useMemo(() => {
    const rows = Array.isArray(data?.lines) ? data.lines : [];
    let out = rows.filter((r) => Array.isArray(r?.hours) && r.hours.length > 0);

    // lọc theo search q (chung)
    const qq = normalizeText(q);
    if (qq) out = out.filter((r) => normalizeText(`${r?.line} ${r?.mh}`).includes(qq));

    // lọc riêng theo dropdown linePick
    if (linePick !== "ALL") out = out.filter((r) => safeStr(r?.line) === linePick);

    return out;
  }, [data, q, linePick]);

  // hour columns from meta (giữ đúng thứ tự)
  const hourCols = useMemo(() => {
    const cols = data?.meta?.hourCols;
    if (Array.isArray(cols) && cols.length) {
      // lấy label + key theo route trả về
      return cols
        .filter((c) => c && c.idx >= 0)
        .map((c) => ({ key: c.key, label: c.label, k: c.k }));
    }

    // fallback theo keys chuẩn route mình đã đưa
    return [
      { key: "H09", label: "09:00", k: 1 },
      { key: "H10", label: "10:00", k: 2 },
      { key: "H11", label: "11:00", k: 3 },
      { key: "H1230", label: "12:30", k: 4 },
      { key: "H1330", label: "13:30", k: 5 },
      { key: "H1430", label: "14:30", k: 6 },
      { key: "H1530", label: "15:30", k: 7 },
      { key: "H1630", label: "16:30", k: 8 },
    ];
  }, [data]);

  // counts
  const stats = useMemo(() => {
    const rows = perfRows;
    const total = rows.length;
    const dat = rows.filter((x) => safeStr(x?.status) === "ĐẠT").length;
    const kdat = rows.filter((x) => safeStr(x?.status) === "KHÔNG ĐẠT").length;
    return { total, dat, kdat, showing: total };
  }, [perfRows]);

  // options for linePick dropdown
  const lineOptions = useMemo(() => {
    const rows = Array.isArray(data?.lines) ? data.lines : [];
    const set = new Set(rows.map((x) => safeStr(x?.line)).filter(Boolean));
    return ["ALL", ...Array.from(set)];
  }, [data]);

  // debug: vì sao không hiện số liệu?
  // -> thường do API trả target = 0. Mình show warning nếu phát hiện.
  const hasZeroTarget = useMemo(() => {
    const rows = Array.isArray(data?.lines) ? data.lines : [];
    for (const r of rows) {
      if (!Array.isArray(r?.hours)) continue;
      for (const h of r.hours) {
        if (Number(h?.target) === 0) return true;
      }
    }
    return false;
  }, [data]);

  return (
    <div className="kpi-app">
      <div className="kpi-wrap">
        <header className="kpi-header">
          <div className="kpi-title">
            <div className="kpi-title__main">KPI Dashboard</div>
            <div className="kpi-title__sub">Tech theme • Dark • Auto update</div>
          </div>

          <div className="kpi-actions">
            <button className="btn" onClick={fetchKpi} disabled={loading}>
              {loading ? "Đang tải..." : "Refresh"}
            </button>
          </div>
        </header>

        {errorMsg ? (
          <div className="alert alert--error">
            <div className="alert__title">Lỗi</div>
            <div className="alert__body">{errorMsg}</div>
            <div className="alert__hint">
              Gợi ý: mở <code>/api/check-kpi?date=...</code> xem JSON có <code>ok:true</code> và{" "}
              <code>target &gt; 0</code> không.
            </div>
          </div>
        ) : null}

        {hasZeroTarget ? (
          <div className="alert alert--warn">
            <div className="alert__title">Cảnh báo</div>
            <div className="alert__body">
              API đang trả về <b>target = 0</b> (ĐM giờ/ĐM ngày bị đọc sai) ⇒ bảng lũy tiến sẽ không tô màu đúng.
              Bạn hãy chắc chắn file <code>route.js</code> đã fix DM/H + merge header 2 dòng.
            </div>
          </div>
        ) : null}

        {/* Filters */}
        <section className="panel">
          <div className="panel-title">Bộ lọc</div>

          <div className="filters">
            <div className="field">
              <label>Ngày</label>
              <input
                type="date"
                value={vnToISO(dateVN)}
                onChange={(e) => {
                  const vn = isoToVN(e.target.value);
                  if (vn) setDateVN(vn);
                }}
              />
              <div className="hint">Đang xem: {dateVN}</div>
            </div>

            <div className="field">
              <label>Lọc trạng thái</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">Tất cả</option>
                <option value="dat">ĐẠT</option>
                <option value="kdat">KHÔNG ĐẠT</option>
              </select>
            </div>

            <div className="field grow">
              <label>Tìm (chuyền / MH)</label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="VD: C1 / 088AG" />
            </div>

            <div className="field">
              <label>Tự cập nhật</label>
              <div className="row">
                <input
                  id="auto"
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                />
                <label htmlFor="auto" className="checkbox-label">
                  1 phút
                </label>
              </div>
            </div>
          </div>

          <div className="cards">
            <div className="card">
              <div className="card__label">Tổng dòng</div>
              <div className="card__value">{stats.total}</div>
            </div>
            <div className="card card--ok">
              <div className="card__label">ĐẠT</div>
              <div className="card__value">{stats.dat}</div>
            </div>
            <div className="card card--bad">
              <div className="card__label">KHÔNG ĐẠT</div>
              <div className="card__value">{stats.kdat}</div>
            </div>
            <div className="card">
              <div className="card__label">Đang hiển thị</div>
              <div className="card__value">{stats.showing}</div>
            </div>
          </div>
        </section>

        {/* Two tables side-by-side */}
        <section className="grid2">
          {/* ===== Table 1: Performance ===== */}
          <div className="panel">
            <div className="panel-title">Hiệu suất trong ngày vs Định mức (kèm mã hàng)</div>

            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Chuyền</th>
                    <th>MH</th>
                    <th>AFTER 16H30</th>
                    <th>DM/NGÀY</th>
                    <th>%</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {perfRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty">
                        Không có dữ liệu để hiển thị.
                      </td>
                    </tr>
                  ) : (
                    perfRows.map((r) => {
                      const st = safeStr(r?.status);
                      const percent = Number(r?.percent) || 0;

                      const statusClass =
                        st === "ĐẠT" ? "pill pill--ok" : "pill pill--bad";

                      const rowClass =
                        st === "ĐẠT" ? "row-ok" : "row-bad";

                      return (
                        <tr key={`${r.line}-${r.mh}`} className={rowClass}>
                          <td className="mono">{safeStr(r.line)}</td>
                          <td className="mono">{safeStr(r.mh)}</td>
                          <td className="num">{formatNumber(r.hs_dat)}</td>
                          <td className="num">{formatNumber(r.hs_dm)}</td>
                          <td className="num">{percent.toFixed(2)}%</td>
                          <td>
                            <span className={statusClass}>{st || "-"}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ===== Table 2: Hourly cumulative ===== */}
          <div className="panel">
            <div className="panel-title">
              <div className="title-row">
                <span>So sánh số lượng kiểm đạt lũy tiến vs định mức giờ</span>

                <div className="title-row__right">
                  <span className="mini-label">Chọn chuyền:</span>
                  <select value={linePick} onChange={(e) => setLinePick(e.target.value)}>
                    {lineOptions.map((v) => (
                      <option key={v} value={v}>
                        {v === "ALL" ? "Tất cả" : v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="legend">
              <span className="tag tag--ok">ĐỦ</span>
              <span className="tag tag--ok">VƯỢT</span>
              <span className="tag tag--bad">THIẾU</span>
            </div>

            <div className="table-wrap">
              <table className="tbl tbl--tight">
                <thead>
                  <tr>
                    <th>Chuyền</th>
                    <th>MH</th>
                    {hourCols.map((c) => (
                      <th key={c.key} className="center">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {hourRows.length === 0 ? (
                    <tr>
                      <td colSpan={2 + hourCols.length} className="empty">
                        Không có dữ liệu lũy tiến để hiển thị.
                      </td>
                    </tr>
                  ) : (
                    hourRows.map((r) => {
                      // map hours by key
                      const map = new Map();
                      for (const h of r.hours || []) map.set(h.key, h);

                      return (
                        <tr key={`hour-${r.line}-${r.mh}`}>
                          <td className="mono">{safeStr(r.line)}</td>
                          <td className="mono">{safeStr(r.mh)}</td>

                          {hourCols.map((c) => {
                            const h = map.get(c.key);
                            const actual = Number(h?.actual) || 0;
                            const target = Number(h?.target) || 0;
                            const level = safeStr(h?.level); // ĐỦ / VƯỢT / THIẾU / NO_TARGET

                            let cellClass = "cell";
                            if (target <= 0) cellClass = "cell cell--na";
                            else if (level === "THIẾU") cellClass = "cell cell--bad";
                            else if (level === "ĐỦ") cellClass = "cell cell--ok";
                            else if (level === "VƯỢT") cellClass = "cell cell--ok";
                            else cellClass = "cell";

                            return (
                              <td key={`${r.line}-${c.key}`} className={cellClass}>
                                <div className="cell__top">{formatNumber(actual)}</div>
                                <div className="cell__sub">
                                  target {target > 0 ? formatNumber(target) : "0"}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <details className="debug">
              <summary>Debug (meta)</summary>
              <pre>{JSON.stringify(data?.meta || {}, null, 2)}</pre>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}