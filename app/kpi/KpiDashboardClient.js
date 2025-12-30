"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function pad2(n) {
  return String(n).padStart(2, "0");
}

// yyyy-mm-dd  -> dd/mm/yyyy
function isoToVNDate(iso) {
  if (!iso || typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// dd/mm/yyyy -> yyyy-mm-dd
function vnToISODate(vn) {
  if (!vn || typeof vn !== "string") return "";
  const m = vn.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// lấy "hôm nay" theo VN và trả về yyyy-mm-dd (cho input type=date)
function todayISO_VN() {
  const now = new Date();
  // trick: format theo vi-VN rồi parse lại
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now); // yyyy-mm-dd
  return s;
}

function toNum(x) {
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  const t = String(x).trim().replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function buildQS(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (s === "") return;
    p.set(k, s);
  });
  return p.toString();
}

function setUrlQuery(next) {
  const url = new URL(window.location.href);
  Object.entries(next).forEach(([k, v]) => {
    const s = String(v ?? "").trim();
    if (!s) url.searchParams.delete(k);
    else url.searchParams.set(k, s);
  });
  window.history.replaceState(null, "", url.toString());
}

function badgeClass(kind) {
  if (kind === "OK") return "kpi-badge kpi-ok";
  if (kind === "FAIL") return "kpi-badge kpi-fail";
  if (kind === "ENOUGH") return "kpi-badge kpi-ok";
  if (kind === "OVER") return "kpi-badge kpi-ok";
  if (kind === "UNDER") return "kpi-badge kpi-fail";
  return "kpi-badge";
}

export default function KpiDashboardClient({ initialQuery }) {
  // --- Query state (UI) ---
  const [dateISO, setDateISO] = useState(() => {
    // ưu tiên ?date=dd/mm/yyyy, không có thì hôm nay
    const isoFromQuery = vnToISODate(initialQuery?.date || "");
    return isoFromQuery || todayISO_VN();
  });

  const [statusFilter, setStatusFilter] = useState(initialQuery?.status || "all");
  const [q, setQ] = useState(initialQuery?.q || "");
  const [auto, setAuto] = useState((initialQuery?.auto ?? "1") === "1");

  // hourly board controls
  const [linePick, setLinePick] = useState(initialQuery?.line || "all");
  const [hourPick, setHourPick] = useState(initialQuery?.hour || ""); // "16:30"

  // --- Data ---
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [data, setData] = useState(null);

  const timerRef = useRef(null);

  const vnDate = useMemo(() => isoToVNDate(dateISO), [dateISO]);

  // Fetch data from API
  async function fetchData() {
    setLoading(true);
    setErrMsg("");

    try {
      const qs = buildQS({ date: vnDate });
      const res = await fetch(`/api/check-kpi?${qs}`, { cache: "no-store" });
      const js = await res.json();

      if (!js?.ok) {
        setData(null);
        setErrMsg(js?.message || "API error");
        return;
      }
      setData(js);

      // set default hour if empty
      if (!hourPick) {
        const candidates = js?.meta?.hourCandidates || [];
        const last = candidates.length ? candidates[candidates.length - 1]?.label : "";
        if (last) setHourPick(last);
        else {
          const fallback = js?.lines?.[0]?.hours?.[js?.lines?.[0]?.hours?.length - 1]?.label;
          if (fallback) setHourPick(fallback);
        }
      }
    } catch (e) {
      setData(null);
      setErrMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Auto update
  useEffect(() => {
    // run once on mount
    fetchData();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    if (auto) {
      timerRef.current = setInterval(() => {
        fetchData();
      }, 60_000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, vnDate]);

  // Sync URL query
  useEffect(() => {
    setUrlQuery({
      date: vnDate,
      status: statusFilter,
      q,
      auto: auto ? "1" : "0",
      line: linePick,
      hour: hourPick,
    });
  }, [vnDate, statusFilter, q, auto, linePick, hourPick]);

  // --- Derived ---
  const lines = useMemo(() => {
    const raw = Array.isArray(data?.lines) ? data.lines : [];
    const keyword = q.trim().toLowerCase();

    const mapped = raw.map((r) => {
      const hs_dat = toNum(r.hs_dat);
      const hs_dm = toNum(r.hs_dm);
      const pct = hs_dm > 0 ? (hs_dat / hs_dm) * 100 : 0;
      const okDay = pct >= 100;
      return {
        line: r.line || "",
        mh: r.mh || "",
        hs_dat,
        hs_dm,
        pct,
        okDay,
        hours: Array.isArray(r.hours) ? r.hours : [],
      };
    });

    let out = mapped;

    if (keyword) {
      out = out.filter((x) => (x.line + " " + x.mh).toLowerCase().includes(keyword));
    }

    if (statusFilter === "ok") out = out.filter((x) => x.okDay);
    if (statusFilter === "fail") out = out.filter((x) => !x.okDay);

    return out;
  }, [data, q, statusFilter]);

  const counts = useMemo(() => {
    const total = lines.length;
    const ok = lines.filter((x) => x.okDay).length;
    const fail = total - ok;
    return { total, ok, fail };
  }, [lines]);

  const hourCandidates = useMemo(() => {
    const c = data?.meta?.hourCandidates;
    if (Array.isArray(c) && c.length) return c.map((x) => x.label).filter(Boolean);
    // fallback
    const h = data?.lines?.[0]?.hours?.map((x) => x.label).filter(Boolean);
    return Array.isArray(h) ? h : [];
  }, [data]);

  const lineOptions = useMemo(() => {
    const uniq = new Set(lines.map((x) => x.line).filter(Boolean));
    return ["all", ...Array.from(uniq)];
  }, [lines]);

  const hourlyRows = useMemo(() => {
    const pick = hourPick;
    const filtered = linePick === "all" ? lines : lines.filter((x) => x.line === linePick);

    return filtered.map((x) => {
      const h = (x.hours || []).find((t) => String(t.label) === String(pick));
      const actual = toNum(h?.actual);
      const target = toNum(h?.target);
      const diff = actual - target;

      let kind = "ENOUGH";
      let label = "ĐỦ";
      if (diff > 0) {
        kind = "OVER";
        label = "VƯỢT";
      } else if (diff < 0) {
        kind = "UNDER";
        label = "THIẾU";
      }

      return {
        line: x.line,
        mh: x.mh,
        actual,
        target,
        diff,
        kind,
        label,
      };
    });
  }, [lines, linePick, hourPick]);

  // --- UI ---
  return (
    <div className="kpi-bg">
      <div className="kpi-container">
        <header className="kpi-header">
          <div>
            <div className="kpi-title">KPI Dashboard</div>
            <div className="kpi-sub">Tech theme • Dark • Auto update</div>
          </div>

          <div className="kpi-actions">
            <button className="kpi-btn" onClick={fetchData} disabled={loading}>
              {loading ? "Đang tải..." : "Refresh"}
            </button>
          </div>
        </header>

        <section className="kpi-card kpi-filters">
          <div className="kpi-filter-row">
            <div className="kpi-field">
              <label>Ngày</label>
              <input
                className="kpi-input"
                type="date"
                value={dateISO}
                onChange={(e) => {
                  setDateISO(e.target.value);
                }}
              />
              <div className="kpi-hint">Đang xem: {vnDate || "--"}</div>
            </div>

            <div className="kpi-field">
              <label>Lọc trạng thái</label>
              <select
                className="kpi-input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Tất cả</option>
                <option value="ok">ĐẠT</option>
                <option value="fail">KHÔNG ĐẠT</option>
              </select>
            </div>

            <div className="kpi-field kpi-grow">
              <label>Tìm (chuyền / MH)</label>
              <input
                className="kpi-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="VD: C1 / 088AG / Baby Carrier..."
              />
            </div>

            <div className="kpi-field kpi-auto">
              <label>Tự cập nhật</label>
              <div className="kpi-inline">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                />
                <span>1 phút</span>
              </div>
            </div>
          </div>

          <div className="kpi-metrics">
            <div className="kpi-metric">
              <div className="kpi-metric-label">Tổng dòng</div>
              <div className="kpi-metric-value">{counts.total}</div>
            </div>
            <div className="kpi-metric kpi-metric-ok">
              <div className="kpi-metric-label">ĐẠT</div>
              <div className="kpi-metric-value">{counts.ok}</div>
            </div>
            <div className="kpi-metric kpi-metric-fail">
              <div className="kpi-metric-label">KHÔNG ĐẠT</div>
              <div className="kpi-metric-value">{counts.fail}</div>
            </div>
            <div className="kpi-metric">
              <div className="kpi-metric-label">Đang hiển thị</div>
              <div className="kpi-metric-value">{lines.length}</div>
            </div>
          </div>

          {errMsg ? <div className="kpi-error">Lỗi: {errMsg}</div> : null}
        </section>

        {/* 2 bảng nằm ngang */}
        <section className="kpi-grid-2">
          {/* Bảng 1: Hiệu suất ngày */}
          <div className="kpi-card">
            <div className="kpi-card-title">
              Hiệu suất trong ngày vs Định mức (kèm mã hàng)
            </div>

            <div className="kpi-table-wrap">
              <table className="kpi-table">
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
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="kpi-empty">
                        Không có dữ liệu để hiển thị.
                      </td>
                    </tr>
                  ) : (
                    lines.map((r) => (
                      <tr key={r.line} className={r.okDay ? "row-ok" : "row-fail"}>
                        <td className="mono">{r.line}</td>
                        <td>{r.mh}</td>
                        <td className="num">{r.hs_dat}</td>
                        <td className="num">{r.hs_dm}</td>
                        <td className="num">{r.pct.toFixed(2)}%</td>
                        <td>
                          <span className={badgeClass(r.okDay ? "OK" : "FAIL")}>
                            {r.okDay ? "ĐẠT" : "KHÔNG ĐẠT"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="kpi-note">
              Quy tắc: <b>≥ 100%</b> → <b>ĐẠT</b>, &lt; 100% → <b>KHÔNG ĐẠT</b>
            </div>
          </div>

          {/* Bảng 2: Lũy tiến vs ĐM giờ */}
          <div className="kpi-card">
            <div className="kpi-card-title">
              So sánh số lượng kiểm đạt lũy tiến vs định mức giờ
            </div>

            <div className="kpi-split-controls">
              <div className="kpi-field">
                <label>Chọn chuyền</label>
                <select
                  className="kpi-input"
                  value={linePick}
                  onChange={(e) => setLinePick(e.target.value)}
                >
                  {lineOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "all" ? "Tất cả" : opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="kpi-field">
                <label>Mốc giờ</label>
                <select
                  className="kpi-input"
                  value={hourPick}
                  onChange={(e) => setHourPick(e.target.value)}
                >
                  {hourCandidates.length ? (
                    hourCandidates.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))
                  ) : (
                    <option value="">(Chưa có giờ)</option>
                  )}
                </select>
              </div>
            </div>

            <div className="kpi-badges">
              <span className={badgeClass("ENOUGH")}>ĐỦ</span>
              <span className={badgeClass("OVER")}>VƯỢT</span>
              <span className={badgeClass("UNDER")}>THIẾU</span>
            </div>

            <div className="kpi-table-wrap">
              <table className="kpi-table">
                <thead>
                  <tr>
                    <th>Chuyền</th>
                    <th>MH</th>
                    <th>Lũy tiến</th>
                    <th>ĐM giờ</th>
                    <th>Chênh</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {hourlyRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="kpi-empty">
                        Không có dữ liệu lũy tiến để hiển thị.
                      </td>
                    </tr>
                  ) : (
                    hourlyRows.map((r) => (
                      <tr key={r.line} className={r.kind === "UNDER" ? "row-fail" : "row-ok"}>
                        <td className="mono">{r.line}</td>
                        <td>{r.mh}</td>
                        <td className="num">{r.actual}</td>
                        <td className="num">{r.target}</td>
                        <td className={"num " + (r.diff < 0 ? "neg" : "pos")}>
                          {r.diff > 0 ? "+" : ""}
                          {r.diff}
                        </td>
                        <td>
                          <span className={badgeClass(r.kind)}>{r.label}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* cảnh báo rất quan trọng */}
            <div className="kpi-note">
              Nếu “ĐM giờ” luôn = 0 trong khi Google Sheet có số ⇒ <b>API đang đọc nhầm cột/range DM giờ</b>.
              Dashboard này lấy đúng theo JSON API trả về.
            </div>
          </div>
        </section>

        <details className="kpi-debug">
          <summary>Debug (meta)</summary>
          <pre className="kpi-pre">{JSON.stringify(data?.meta || {}, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}