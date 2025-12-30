"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ===== Helpers =====
function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayVN() {
  const now = new Date();
  // Lấy ngày theo giờ VN
  const vn = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
  );
  return `${pad2(vn.getDate())}/${pad2(vn.getMonth() + 1)}/${vn.getFullYear()}`;
}
function vnToISO(vnDate) {
  // dd/mm/yyyy -> yyyy-mm-dd
  const m = String(vnDate || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const dd = pad2(m[1]);
  const mm = pad2(m[2]);
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}
function isoToVNDate(iso) {
  // yyyy-mm-dd -> dd/mm/yyyy
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function buildQS(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v);
    if (!s) return;
    p.set(k, s);
  });
  return p.toString();
}
function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function statusDailyFromPercent(p) {
  return p >= 100 ? "ĐẠT" : "KHÔNG ĐẠT";
}
function statusHourFromDelta(delta) {
  if (delta === 0) return "ĐỦ";
  if (delta > 0) return "VƯỢT";
  return "THIẾU";
}
function clsStatus(s) {
  if (s === "ĐẠT" || s === "ĐỦ" || s === "VƯỢT") return "kpi-pill ok";
  if (s === "KHÔNG ĐẠT" || s === "THIẾU") return "kpi-pill bad";
  return "kpi-pill";
}

export default function KpiDashboardClient({ initialQuery }) {
  // ===== init =====
  const initVN = initialQuery?.date || todayVN();
  const [vnDate, setVnDate] = useState(initVN);
  const [dateISO, setDateISO] = useState(vnToISO(initVN) || "");

  const [statusFilter, setStatusFilter] = useState(initialQuery?.status || "all"); // all | ok | fail
  const [searchText, setSearchText] = useState(initialQuery?.q || "");
  const [autoUpdate, setAutoUpdate] = useState((initialQuery?.auto ?? "1") !== "0");

  // bảng lũy tiến
  const [linePick, setLinePick] = useState(initialQuery?.line || "all");
  const [hourPick, setHourPick] = useState(initialQuery?.hour || ""); // label "16:30"

  // data
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [data, setData] = useState(null);

  const timerRef = useRef(null);

  // ===== Fetch API =====
  async function fetchDataForVNDate(vn) {
    setLoading(true);
    setErrMsg("");

    try {
      const qs = buildQS({ date: vn });
      const res = await fetch(`/api/check-kpi?${qs}`, { cache: "no-store" });
      const js = await res.json();

      if (!js?.ok) {
        setData(null);
        setErrMsg(js?.message || "API error");
        return;
      }

      setData(js);

      // set default hourPick nếu chưa có
      if (!hourPick) {
        const candidates = js?.meta?.hourCandidates || [];
        const last = candidates.length ? candidates[candidates.length - 1]?.label : "";
        if (last) setHourPick(last);
        else {
          // fallback: lấy label cuối từ hours của dòng đầu tiên
          const first = js?.lines?.[0];
          const last2 = first?.hours?.[first?.hours?.length - 1]?.label || "";
          if (last2) setHourPick(last2);
        }
      }
    } catch (e) {
      setData(null);
      setErrMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchData() {
    return fetchDataForVNDate(vnDate);
  }

  // initial fetch
  useEffect(() => {
    fetchDataForVNDate(vnDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto update
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    if (autoUpdate) {
      timerRef.current = setInterval(() => {
        fetchDataForVNDate(vnDate);
      }, 60 * 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpdate, vnDate]);

  // ===== Derived =====
  const linesRaw = data?.lines || [];

  // daily rows (hiệu suất ngày)
  const dailyRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    return linesRaw
      .map((r) => {
        const after = toNum(r.hs_dat ?? r.after ?? r.after16h30 ?? r.actualDay);
        const dm = toNum(r.hs_dm ?? r.dm ?? r.dm_ngay ?? r.targetDay);
        const percent = dm > 0 ? (after / dm) * 100 : 0;
        const st = statusDailyFromPercent(percent);
        return {
          line: r.line || "",
          mh: r.mh || "",
          after,"use client";

import { useEffect, useMemo, useState } from "react";

function fmt(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString("vi-VN");
}

function pct(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0%";
  return `${x.toFixed(2)}%`;
}

function clsStatusDaily(s) {
  return s === "ĐẠT" ? "kpi-pill kpi-ok" : "kpi-pill kpi-bad";
}

function clsStatusHour(s) {
  if (s === "THIẾU") return "kpi-pill kpi-bad";
  // ĐỦ / VƯỢT đều xanh theo yêu cầu
  return "kpi-pill kpi-ok";
}

export default function KpiDashboardClient({ initialQuery = {} }) {
  const [dateISO, setDateISO] = useState(initialQuery.dateISO || "");
  const [statusFilter, setStatusFilter] = useState("all"); // all | ok | bad
  const [q, setQ] = useState("");
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);

  // hourly controls
  const [linePick, setLinePick] = useState("all");
  const [hourPick, setHourPick] = useState(""); // label like "16:30"

  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const url = new URL("/api/check-kpi", window.location.origin);
      if (dateISO) url.searchParams.set("date", dateISO);

      const res = await fetch(url.toString(), { cache: "no-store" });
      const js = await res.json();
      if (!js.ok) throw new Error(js.error || "API error");
      setData(js);

      // default hour pick (prefer 16:30 if exists)
      const hours = (js.meta?.hourCols || []).filter((h) => h.idx >= 0).map((h) => h.label);
      if (!hourPick) {
        setHourPick(hours.includes("16:30") ? "16:30" : (hours[0] || ""));
      }
    } catch (e) {
      setError(String(e?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // initial load
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto refresh each minute
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => fetchData(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, dateISO]);

  // update URL (so bạn share link vẫn giữ filter/date)
  useEffect(() => {
    const u = new URL(window.location.href);
    if (dateISO) u.searchParams.set("date", dateISO);
    else u.searchParams.delete("date");
    u.searchParams.set("auto", auto ? "1" : "0");
    history.replaceState({}, "", u.toString());
  }, [dateISO, auto]);

  const lines = data?.lines || [];

  const filteredDaily = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return lines.filter((x) => {
      const hitQ =
        !qq ||
        String(x.line || "").toLowerCase().includes(qq) ||
        String(x.mh || "").toLowerCase().includes(qq);

      const hitStatus =
        statusFilter === "all" ||
        (statusFilter === "ok" && x.status === "ĐẠT") ||
        (statusFilter === "bad" && x.status !== "ĐẠT");

      return hitQ && hitStatus;
    });
  }, [lines, q, statusFilter]);

  const stats = useMemo(() => {
    const total = filteredDaily.length;
    const ok = filteredDaily.filter((x) => x.status === "ĐẠT").length;
    const bad = total - ok;
    return { total, ok, bad };
  }, [filteredDaily]);

  const lineOptions = useMemo(() => {
    const set = new Set();
    for (const x of lines) {
      const v = String(x.line || "").trim();
      if (v) set.add(v);
    }
    return ["all", ...Array.from(set)];
  }, [lines]);

  const hourOptions = useMemo(() => {
    const cols = data?.meta?.hourCols || [];
    return cols.filter((h) => h.idx >= 0).map((h) => h.label);
  }, [data]);

  const hourlyRows = useMemo(() => {
    if (!hourPick) return [];
    let arr = lines;

    if (linePick !== "all") arr = arr.filter((x) => x.line === linePick);

    // pick hour object from each line
    const out = [];
    for (const x of arr) {
      const h = (x.hours || []).find((hh) => hh.label === hourPick);
      if (!h) continue;

      out.push({
        line: x.line,
        mh: x.mh,
        actual: h.actual,
        target: h.target,
        diff: h.diff,
        status: h.status,
      });
    }
    return out;
  }, [lines, hourPick, linePick]);

  const hourlyStats = useMemo(() => {
    let du = 0, vuot = 0, thieu = 0;
    for (const r of hourlyRows) {
      if (r.status === "THIẾU") thieu++;
      else if (r.status === "VƯỢT") vuot++;
      else du++;
    }
    return { du, vuot, thieu };
  }, [hourlyRows]);

  return (
    <div className="kpi-root">
      <div className="kpi-bg" />

      <header className="kpi-header">
        <div>
          <h1 className="kpi-title">KPI Dashboard</h1>
          <div className="kpi-sub">Tech theme • Dark • Auto update</div>
        </div>

        <div className="kpi-actions">
          <button className="kpi-btn" onClick={fetchData} disabled={loading}>
            {loading ? "Đang tải..." : "Refresh"}
          </button>
        </div>
      </header>

      <section className="kpi-card kpi-filters">
        <div className="kpi-grid-filters">
          <div className="kpi-field">
            <label>Ngày</label>
            <input
              type="date"
              value={dateISO}
              onChange={(e) => setDateISO(e.target.value)}
              className="kpi-input"
            />
            <div className="kpi-hint">
              Đang xem: <b>{data?.date || "—"}</b>
            </div>
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
              <option value="bad">KHÔNG ĐẠT</option>
            </select>
          </div>

          <div className="kpi-field">
            <label>Tìm (chuyền / MH)</label>
            <input
              className="kpi-input"
              placeholder="VD: C1 / 088AG / Baby Carrier..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="kpi-field kpi-autobox">
            <label>Tự cập nhật</label>
            <div className="kpi-check">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
              />
              <span>1 phút</span>
            </div>
          </div>
        </div>

        <div className="kpi-stats">
          <div className="kpi-stat kpi-card-mini">
            <div className="kpi-stat-label">Tổng dòng</div>
            <div className="kpi-stat-value">{stats.total}</div>
          </div>
          <div className="kpi-stat kpi-card-mini kpi-ok-border">
            <div className="kpi-stat-label">ĐẠT</div>
            <div className="kpi-stat-value">{stats.ok}</div>
          </div>
          <div className="kpi-stat kpi-card-mini kpi-bad-border">
            <div className="kpi-stat-label">KHÔNG ĐẠT</div>
            <div className="kpi-stat-value">{stats.bad}</div>
          </div>
          <div className="kpi-stat kpi-card-mini">
            <div className="kpi-stat-label">Đang hiển thị</div>
            <div className="kpi-stat-value">{filteredDaily.length}</div>
          </div>
        </div>

        {error ? <div className="kpi-error">{error}</div> : null}
      </section>

      {/* ===== 2 BẢNG NẰM NGANG ===== */}
      <section className="kpi-two">
        {/* ===== BẢNG 1: HIỆU SUẤT NGÀY ===== */}
        <div className="kpi-card">
          <div className="kpi-card-title">
            Hiệu suất trong ngày vs Định mức <span className="kpi-muted">(kèm mã hàng)</span>
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
                {filteredDaily.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="kpi-empty">
                      Không có dữ liệu để hiển thị.
                    </td>
                  </tr>
                ) : (
                  filteredDaily.map((x, i) => (
                    <tr key={`${x.line}-${i}`}>
                      <td className="kpi-td-strong">{x.line}</td>
                      <td className="kpi-td-mh">{x.mh || "—"}</td>
                      <td>{fmt(x.after)}</td>
                      <td>{fmt(x.dmNgay)}</td>
                      <td>{pct(x.percent)}</td>
                      <td>
                        <span className={clsStatusDaily(x.status)}>
                          {x.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="kpi-note">
            Quy tắc: <b>≥ 100%</b> → <span className="kpi-ok-txt">ĐẠT</span>,{" "}
            <b>&lt; 100%</b> → <span className="kpi-bad-txt">KHÔNG ĐẠT</span>
          </div>
        </div>

        {/* ===== BẢNG 2: LŨY TIẾN VS ĐM GIỜ ===== */}
        <div className="kpi-card">
          <div className="kpi-card-title">
            So sánh số lượng kiểm đạt lũy tiến vs định mức giờ
          </div>

          <div className="kpi-hour-controls">
            <div className="kpi-field">
              <label>Chọn chuyền</label>
              <select
                className="kpi-input"
                value={linePick}
                onChange={(e) => setLinePick(e.target.value)}
              >
                <option value="all">Tất cả</option>
                {lineOptions
                  .filter((x) => x !== "all")
                  .map((x) => (
                    <option key={x} value={x}>
                      {x}
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
                <option value="">Chưa có giờ</option>
                {hourOptions.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="kpi-chips">
            <span className="kpi-pill kpi-ok">ĐỦ: {hourlyStats.du}</span>
            <span className="kpi-pill kpi-ok">VƯỢT: {hourlyStats.vuot}</span>
            <span className="kpi-pill kpi-bad">THIẾU: {hourlyStats.thieu}</span>
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
                  hourlyRows.map((r, i) => (
                    <tr key={`${r.line}-${r.mh}-${i}`}>
                      <td className="kpi-td-strong">{r.line}</td>
                      <td className="kpi-td-mh">{r.mh || "—"}</td>
                      <td>{fmt(r.actual)}</td>
                      <td>{fmt(r.target)}</td>
                      <td className={r.diff < 0 ? "kpi-bad-txt" : "kpi-ok-txt"}>
                        {fmt(r.diff)}
                      </td>
                      <td>
                        <span className={clsStatusHour(r.status)}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="kpi-note">
            Quy tắc: <b>=</b> → <span className="kpi-ok-txt">ĐỦ</span>,{" "}
            <b>&gt;</b> → <span className="kpi-ok-txt">VƯỢT</span>,{" "}
            <b>&lt;</b> → <span className="kpi-bad-txt">THIẾU</span>
          </div>
        </div>
      </section>

      <details className="kpi-card kpi-debug">
        <summary>Debug (meta)</summary>
        <pre className="kpi-pre">{JSON.stringify(data?.meta || {}, null, 2)}</pre>
      </details>
    </div>
  );
}
          dm,
          percent,
          status: st,
        };
      })
      .filter((r) => {
        if (statusFilter === "ok" && r.status !== "ĐẠT") return false;
        if (statusFilter === "fail" && r.status !== "KHÔNG ĐẠT") return false;
        if (q) {
          const hay = `${r.line} ${r.mh}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [linesRaw, searchText, statusFilter]);

  // summary cards
  const summary = useMemo(() => {
    const total = dailyRows.length;
    const ok = dailyRows.filter((x) => x.status === "ĐẠT").length;
    const fail = dailyRows.filter((x) => x.status === "KHÔNG ĐẠT").length;
    return { total, ok, fail, show: total };
  }, [dailyRows]);

  // candidates for line dropdown
  const lineOptions = useMemo(() => {
    const set = new Set();
    linesRaw.forEach((r) => set.add(String(r.line || "").trim()));
    const arr = Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return ["all", ...arr];
  }, [linesRaw]);

  // hour candidates
  const hourOptions = useMemo(() => {
    const metaCand = data?.meta?.hourCandidates || [];
    if (metaCand.length) return metaCand.map((x) => x.label);

    // fallback from first line
    const first = linesRaw[0];
    const hs = first?.hours || [];
    return hs.map((h) => h.label).filter(Boolean);
  }, [data, linesRaw]);

  // pick one hour info from each line
  const hourCompareRows = useMemo(() => {
    const pick = hourPick || "";

    const q = searchText.trim().toLowerCase();

    const rows = linesRaw.map((r) => {
      const hours = r.hours || [];
      const found = hours.find((h) => String(h.label) === String(pick));
      const actual = toNum(found?.actual);
      const target = toNum(found?.target);
      const delta = actual - target;
      const st = statusHourFromDelta(delta);

      return {
        line: r.line || "",
        mh: r.mh || "",
        hourLabel: pick,
        actual,
        target,
        delta,
        status: st,
      };
    });

    return rows
      .filter((x) => {
        // line filter riêng cho bảng lũy tiến
        if (linePick !== "all" && String(x.line) !== String(linePick)) return false;

        if (q) {
          const hay = `${x.line} ${x.mh}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [linesRaw, hourPick, linePick, searchText]);

  // ===== Events =====
  function onPickDateISO(nextISO) {
    setDateISO(nextISO);
    const nextVN = isoToVNDate(nextISO);
    if (!nextVN) return;
    setVnDate(nextVN);
    fetchDataForVNDate(nextVN); // tải ngay khi đổi ngày
  }

  // ===== Render =====
  return (
    <div className="kpi-root">
      <header className="kpi-header">
        <div>
          <h1 className="kpi-title">KPI Dashboard</h1>
          <div className="kpi-sub">Tech theme • Dark • Auto update</div>
        </div>

        <div className="kpi-actions">
          <button className="kpi-btn" onClick={fetchData} disabled={loading}>
            {loading ? "Đang tải..." : "Refresh"}
          </button>
        </div>
      </header>

      {errMsg ? (
        <div className="kpi-alert">
          <b>Lỗi:</b> {errMsg}
          <div className="kpi-hint">
            Gợi ý: mở <code>/api/check-kpi?date=dd/mm/yyyy</code> để xem JSON có <code>ok:true</code> và
            có <code>lines</code> không.
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <section className="kpi-card kpi-filters">
        <div className="kpi-grid-filters">
          <div className="kpi-field">
            <div className="kpi-label">Ngày</div>
            <input
              className="kpi-input"
              type="date"
              value={dateISO}
              onChange={(e) => onPickDateISO(e.target.value)}
            />
            <div className="kpi-mini">Đang xem: {vnDate}</div>
          </div>

          <div className="kpi-field">
            <div className="kpi-label">Lọc trạng thái</div>
            <select
              className="kpi-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tất cả</option>
              <option value="ok">Đạt</option>
              <option value="fail">Không đạt</option>
            </select>
          </div>

          <div className="kpi-field">
            <div className="kpi-label">Tìm (chuyền / MH)</div>
            <input
              className="kpi-input"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="VD: C1 / 088AG / Baby Carrier..."
            />
          </div>

          <div className="kpi-field kpi-field-inline">
            <div className="kpi-label">Tự cập nhật</div>
            <label className="kpi-toggle">
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => setAutoUpdate(e.target.checked)}
              />
              <span>1 phút</span>
            </label>
          </div>
        </div>

        <div className="kpi-metrics">
          <div className="kpi-metric">
            <div className="kpi-metric-title">Tổng dòng</div>
            <div className="kpi-metric-value">{summary.total}</div>
          </div>
          <div className="kpi-metric ok">
            <div className="kpi-metric-title">ĐẠT</div>
            <div className="kpi-metric-value">{summary.ok}</div>
          </div>
          <div className="kpi-metric bad">
            <div className="kpi-metric-title">KHÔNG ĐẠT</div>
            <div className="kpi-metric-value">{summary.fail}</div>
          </div>
          <div className="kpi-metric">
            <div className="kpi-metric-title">Đang hiển thị</div>
            <div className="kpi-metric-value">{summary.show}</div>
          </div>
        </div>
      </section>

      {/* 2 tables side-by-side */}
      <section className="kpi-grid-2">
        {/* Table 1: Daily performance */}
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
                {dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="kpi-empty">
                      Không có dữ liệu để hiển thị.
                    </td>
                  </tr>
                ) : (
                  dailyRows.map((r, idx) => (
                    <tr key={idx}>
                      <td className="mono">{r.line}</td>
                      <td className="mono">{r.mh}</td>
                      <td className="num">{r.after}</td>
                      <td className="num">{r.dm}</td>
                      <td className="num">{r.percent.toFixed(2)}%</td>
                      <td>
                        <span className={clsStatus(r.status)}>{r.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="kpi-note">
            Quy tắc: <b>≥ 100%</b> → <b>ĐẠT</b> (xanh), &nbsp; <b>&lt; 100%</b> → <b>KHÔNG ĐẠT</b> (đỏ)
          </div>
        </div>

        {/* Table 2: Hour cumulative vs target */}
        <div className="kpi-card">
          <div className="kpi-card-head">
            <div className="kpi-card-title">
              So sánh số lượng kiểm đạt lũy tiến vs định mức giờ
            </div>

            <div className="kpi-head-right">
              <div className="kpi-inline">
                <span className="kpi-label-inline">Chọn chuyền:</span>
                <select
                  className="kpi-select"
                  value={linePick}
                  onChange={(e) => setLinePick(e.target.value)}
                >
                  {lineOptions.map((x) => (
                    <option key={x} value={x}>
                      {x === "all" ? "Tất cả" : x}
                    </option>
                  ))}
                </select>
              </div>

              <div className="kpi-inline">
                <span className="kpi-label-inline">Mốc giờ:</span>
                <select
                  className="kpi-select"
                  value={hourPick}
                  onChange={(e) => setHourPick(e.target.value)}
                >
                  {hourOptions.length === 0 ? (
                    <option value="">Chưa có giờ</option>
                  ) : (
                    hourOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </div>

          <div className="kpi-legend">
            <span className="kpi-pill ok">ĐỦ</span>
            <span className="kpi-pill ok">VƯỢT</span>
            <span className="kpi-pill bad">THIẾU</span>
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
                {hourCompareRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="kpi-empty">
                      Không có dữ liệu lũy tiến để hiển thị.
                    </td>
                  </tr>
                ) : (
                  hourCompareRows.map((r, idx) => (
                    <tr key={idx}>
                      <td className="mono">{r.line}</td>
                      <td className="mono">{r.mh}</td>
                      <td className="num">{r.actual}</td>
                      <td className="num">{r.target}</td>
                      <td className={"num " + (r.delta < 0 ? "bad" : "ok")}>
                        {r.delta}
                      </td>
                      <td>
                        <span className={clsStatus(r.status)}>{r.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="kpi-note">
            Quy tắc: <b>=</b> → <b>ĐỦ</b> (xanh), &nbsp; <b>&gt;</b> → <b>VƯỢT</b> (xanh), &nbsp; <b>&lt;</b> → <b>THIẾU</b> (đỏ)
          </div>
        </div>
      </section>

      {/* Debug */}
      <details className="kpi-card kpi-debug">
        <summary>Debug (meta)</summary>
        <pre className="kpi-pre">{JSON.stringify(data?.meta || {}, null, 2)}</pre>
      </details>
    </div>
  );
}