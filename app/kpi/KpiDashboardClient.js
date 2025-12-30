"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** ========= Helpers (date) ========= */
function pad2(n) {
  return String(n).padStart(2, "0");
}

// yyyy-mm-dd -> dd/mm/yyyy
function isoToVN(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// dd/mm/yyyy -> yyyy-mm-dd (cho input date)
function vnToISO(vn) {
  const m = String(vn || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
}

// lấy ngày VN hiện tại
function todayVN() {
  const now = new Date();
  const vn = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return `${pad2(vn.getDate())}/${pad2(vn.getMonth() + 1)}/${vn.getFullYear()}`;
}

function normText(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toNumberSafe(v) {
  if (v === null || v === undefined) return 0;
  const t = String(v).trim();
  if (!t) return 0;
  const cleaned = t.replace(/,/g, "").replace(/%/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function fmtInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  return Math.round(x).toLocaleString("vi-VN");
}

/** ========= UI badges ========= */
function Badge({ tone, children }) {
  return <span className={`kpi-badge ${tone}`}>{children}</span>;
}

/** ========= Main ========= */
export default function KpiDashboardClient() {
  // date state
  const [vnDate, setVnDate] = useState(todayVN());
  const [isoDate, setIsoDate] = useState(vnToISO(todayVN()));

  // filters
  const [statusFilter, setStatusFilter] = useState("all"); // all | ok | not_ok
  const [search, setSearch] = useState("");
  const [auto, setAuto] = useState(true);

  // hourly compare filters
  const [linePick, setLinePick] = useState("all");
  const [hourPick, setHourPick] = useState(""); // label: "09:00"...

  // data
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState(null);

  const timerRef = useRef(null);

  /** Fetch API */
  async function fetchData(dateStr = vnDate) {
    setLoading(true);
    setErr("");
    try {
      const url = `/api/check-kpi?date=${encodeURIComponent(dateStr)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        setPayload(json || null);
        setErr(json?.error || "API error");
      } else {
        setPayload(json);
      }
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  /** initial + when date changes */
  useEffect(() => {
    fetchData(vnDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vnDate]);

  /** auto refresh */
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!auto) return;

    timerRef.current = setInterval(() => {
      fetchData(vnDate);
    }, 60 * 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, vnDate]);

  /** derive lines */
  const lines = useMemo(() => {
    const raw = payload?.lines || [];
    // đảm bảo luôn có line/mh/hs_dat/hs_dm/hours
    return raw.map((r) => {
      const line = r?.line ?? "";
      const mh = r?.mh ?? "";
      const hs_dat = toNumberSafe(r?.hs_dat);
      const hs_dm = toNumberSafe(r?.hs_dm);
      const percent = hs_dm > 0 ? (hs_dat / hs_dm) * 100 : 0;
      const ok = percent >= 100;

      const hours = Array.isArray(r?.hours) ? r.hours : [];
      return {
        line,
        mh,
        hs_dat,
        hs_dm,
        percent,
        ok,
        status: ok ? "ĐẠT" : "KHÔNG ĐẠT",
        hours,
      };
    });
  }, [payload]);

  /** options for line dropdown */
  const lineOptions = useMemo(() => {
    const uniq = new Map();
    for (const r of lines) {
      const key = String(r.line || "").trim();
      if (key && !uniq.has(key)) uniq.set(key, key);
    }
    return ["all", ...Array.from(uniq.keys())];
  }, [lines]);

  /** hour candidates: prefer payload.meta.hourCandidates, fallback from first line */
  const hourOptions = useMemo(() => {
    const meta = payload?.meta;
    if (meta?.hourCandidates?.length) {
      const arr = meta.hourCandidates
        .map((h) => h?.label)
        .filter(Boolean);
      return arr;
    }
    const first = lines[0]?.hours || [];
    const arr = first.map((h) => h?.label).filter(Boolean);
    return arr;
  }, [payload, lines]);

  /** set default hourPick when options change */
  useEffect(() => {
    if (!hourPick && hourOptions.length) {
      setHourPick(hourOptions[hourOptions.length - 1]); // lấy mốc cuối (thường 16:30)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourOptions.join("|")]);

  /** apply filters for daily table */
  const dailyRows = useMemo(() => {
    const q = normText(search);
    return lines.filter((r) => {
      if (statusFilter === "ok" && !r.ok) return false;
      if (statusFilter === "not_ok" && r.ok) return false;

      if (q) {
        const hay = normText(`${r.line} ${r.mh}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lines, search, statusFilter]);

  /** hourly compare rows */
  const hourlyRows = useMemo(() => {
    const picked = linePick === "all" ? dailyRows : dailyRows.filter((r) => r.line === linePick);

    return picked.map((r) => {
      const h = (r.hours || []).find((x) => x?.label === hourPick);
      const actual = toNumberSafe(h?.actual);
      const target = toNumberSafe(h?.target);
      const diff = actual - target;

      let tone = "red";
      let label = "THIẾU";
      if (diff === 0) {
        tone = "green";
        label = "ĐỦ";
      } else if (diff > 0) {
        tone = "green";
        label = "VƯỢT";
      }

      return {
        line: r.line,
        mh: r.mh,
        actual,
        target,
        diff,
        label,
        tone,
      };
    });
  }, [dailyRows, linePick, hourPick]);

  /** summary counts */
  const summary = useMemo(() => {
    const total = dailyRows.length;
    const okCount = dailyRows.filter((x) => x.ok).length;
    const notOk = total - okCount;
    return { total, okCount, notOk, showing: total };
  }, [dailyRows]);

  /** Handlers */
  function onPickISO(e) {
    const iso = e.target.value; // yyyy-mm-dd
    setIsoDate(iso);
    const vn = isoToVN(iso);
    if (vn) setVnDate(vn);
  }

  function refreshNow() {
    fetchData(vnDate);
  }

  return (
    <div className="kpi-root">
      <div className="kpi-bg" />

      <header className="kpi-header">
        <div>
          <div className="kpi-title">KPI Dashboard</div>
          <div className="kpi-sub">Tech theme • Dark • Auto update</div>
        </div>

        <div className="kpi-actions">
          <button className="kpi-btn" onClick={refreshNow} disabled={loading}>
            {loading ? "Đang tải..." : "Refresh"}
          </button>
        </div>
      </header>

      <section className="kpi-card kpi-filters">
        <div className="kpi-grid filters-grid">
          <div className="kpi-field">
            <div className="kpi-label">Ngày</div>
            <input className="kpi-input" type="date" value={isoDate || ""} onChange={onPickISO} />
            <div className="kpi-hint">Đang xem: {vnDate}</div>
          </div>

          <div className="kpi-field">
            <div className="kpi-label">Lọc trạng thái</div>
            <select className="kpi-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Tất cả</option>
              <option value="ok">Đạt</option>
              <option value="not_ok">Không đạt</option>
            </select>
          </div>

          <div className="kpi-field">
            <div className="kpi-label">Tìm (chuyền / MH)</div>
            <input
              className="kpi-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="VD: C1 / 088AG / Baby Carrier..."
            />
          </div>

          <div className="kpi-field kpi-inline">
            <div>
              <div className="kpi-label">Tự cập nhật</div>
              <div className="kpi-hint">mỗi 1 phút</div>
            </div>
            <label className="kpi-switch">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span />
            </label>
          </div>
        </div>

        <div className="kpi-grid cards-grid">
          <div className="kpi-mini">
            <div className="kpi-mini-title">Tổng dòng</div>
            <div className="kpi-mini-val">{summary.total}</div>
          </div>
          <div className="kpi-mini ok">
            <div className="kpi-mini-title">ĐẠT</div>
            <div className="kpi-mini-val">{summary.okCount}</div>
          </div>
          <div className="kpi-mini bad">
            <div className="kpi-mini-title">KHÔNG ĐẠT</div>
            <div className="kpi-mini-val">{summary.notOk}</div>
          </div>
          <div className="kpi-mini">
            <div className="kpi-mini-title">Đang hiển thị</div>
            <div className="kpi-mini-val">{summary.showing}</div>
          </div>
        </div>

        {err ? <div className="kpi-error">Lỗi: {err}</div> : null}
      </section>

      {/* ===== 2 bảng NẰM NGANG ===== */}
      <section className="kpi-grid two-tables">
        {/* Daily efficiency */}
        <div className="kpi-card">
          <div className="kpi-card-title">Hiệu suất trong ngày vs Định mức (kèm mã hàng)</div>

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
                    <tr key={`${r.line}-${r.mh}-${idx}`}>
                      <td className="mono">{r.line}</td>
                      <td>{r.mh}</td>
                      <td className="num">{fmtInt(r.hs_dat)}</td>
                      <td className="num">{fmtInt(r.hs_dm)}</td>
                      <td className="num">{r.hs_dm > 0 ? `${r.percent.toFixed(1)}%`: "-"}</td>
                      <td>
                        {r.ok ? <Badge tone="green">ĐẠT</Badge> : <Badge tone="red">KHÔNG ĐẠT</Badge>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="kpi-note">
            Quy tắc: <b>≥ 100%</b> → <span className="okText">ĐẠT</span>, &nbsp;
            <b>&lt; 100%</b> → <span className="badText">KHÔNG ĐẠT</span>
          </div>
        </div>

        {/* Hourly compare */}
        <div className="kpi-card">
          <div className="kpi-card-head">
            <div className="kpi-card-title">So sánh số lượng kiểm đạt lũy tiến vs định mức giờ</div>
            <div className="kpi-head-tools">
              <div className="kpi-field small">
                <div className="kpi-label">Chọn chuyền</div>
                <select className="kpi-input" value={linePick} onChange={(e) => setLinePick(e.target.value)}>
                  <option value="all">Tất cả</option>
                  {lineOptions.filter((x) => x !== "all").map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              <div className="kpi-field small">
                <div className="kpi-label">Mốc giờ</div>
                <select className="kpi-input" value={hourPick} onChange={(e) => setHourPick(e.target.value)}>
                  {hourOptions.length === 0 ? <option value="">Chưa có giờ</option> : null}
                  {hourOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="kpi-badges-row">
            <Badge tone="green">ĐỦ</Badge>
            <Badge tone="green">VƯỢT</Badge>
            <Badge tone="red">THIẾU</Badge>
          </div>

          <div className="kpi-table-wrap">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>MH</th>
                  <th>Lũy tiến</th>
                  <th>DM giờ</th>
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
                  hourlyRows.map((r, idx) => (
                    <tr key={`${r.line}-${r.mh}-${idx}`}>
                      <td className="mono">{r.line}</td>
                      <td>{r.mh}</td>
                      <td className="num">{fmtInt(r.actual)}</td>
                      <td className="num">{fmtInt(r.target)}</td>
                      <td className={`num ${r.diff < 0 ? "badText" : "okText"}`}>{fmtInt(r.diff)}</td>
                      <td>
                        <Badge tone={r.tone}>{r.label}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="kpi-note">
            Quy tắc: <b>=</b> → <span className="okText">ĐỦ</span>, &nbsp;
            <b>&gt;</b> → <span className="okText">VƯỢT</span>, &nbsp;
            <b>&lt;</b> → <span className="badText">THIẾU</span>
          </div>
        </div>
      </section>

      <details className="kpi-card kpi-debug">
        <summary>Debug (meta)</summary>
        <pre className="kpi-pre">{JSON.stringify(payload?.meta || payload || {}, null, 2)}</pre>
      </details>
    </div>
  );
}
