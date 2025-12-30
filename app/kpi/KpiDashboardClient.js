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
          after,
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