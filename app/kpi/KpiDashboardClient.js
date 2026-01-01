// app/kpi/KpiDashboardClient.js
"use client";

import { useEffect, useMemo, useState } from "react";
import "./kpi.css";

function cls(...xs) {
  return xs.filter(Boolean).join(" ");
}

export default function KpiDashboardClient() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [dates, setDates] = useState([]);
  const [hourCandidates, setHourCandidates] = useState([]);

  const [date, setDate] = useState("");     // dd/mm/yyyy
  const [hour, setHour] = useState("");     // "08:00"

  const [perf, setPerf] = useState([]);
  const [qc, setQc] = useState([]);
  const [stats, setStats] = useState(null);

  async function fetchData(nextDate, nextHour) {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams();
      if (nextDate) params.set("date", nextDate);
      if (nextHour) params.set("hour", nextHour);

      const res = await fetch(`/api/check-kpi?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();

      if (!json.ok) {
        setErr(json.error || "Unknown error");
        setPerf([]);
        setQc([]);
        setStats(null);
        setDates(json?.meta?.dates || []);
        setHourCandidates(json?.meta?.hourCandidates || []);
        return;
      }

      setDates(json.meta?.dates || []);
      setHourCandidates(json.meta?.hourCandidates || []);
      setStats(json.meta?.stats || null);

      // set default date/hour if empty
      if (!nextDate) setDate(json.date || "");
      if (!nextHour) setHour(json.meta?.selectedHour || "");

      setPerf(json.perf || []);
      setQc(json.qc || []);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // first load
  useEffect(() => {
    fetchData("", "");
  }, []);

  // auto refresh
  useEffect(() => {
    const t = setInterval(() => {
      fetchData(date, hour);
    }, 20000);
    return () => clearInterval(t);
  }, [date, hour]);

  const perfSummary = useMemo(() => {
    const ok = perf.filter(x => x.ok).length;
    return { total: perf.length, ok, fail: perf.length - ok };
  }, [perf]);

  const qcSummary = useMemo(() => {
    const ok = qc.filter(x => x.ok).length;
    return { total: qc.length, ok, fail: qc.length - ok };
  }, [qc]);

  return (
    <div className="kpi-page">
      <div className="kpi-header">
        <div>
          <div className="kpi-title">KPI Dashboard</div>
          <div className="kpi-sub">
            {stats ? (
              <>
                <span>Hiệu suất: Tổng {stats.perf_total} | Đạt {stats.perf_ok} | Không đạt {stats.perf_fail}</span>
                <span className="sep">•</span>
                <span>Kiểm: Tổng {stats.qc_total} | OK {stats.qc_ok} | Lỗi {stats.qc_fail}</span>
              </>
            ) : (
              <span>Chọn ngày để xem dữ liệu</span>
            )}
          </div>
        </div>

        <div className="kpi-controls">
          <div className="ctrl">
            <label>Chọn ngày</label>
            <select
              value={date}
              onChange={(e) => {
                const v = e.target.value;
                setDate(v);
                fetchData(v, hour);
              }}
            >
              <option value="">(Tự chọn ngày mới nhất)</option>
              {dates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="ctrl">
            <label>Định mức giờ</label>
            <select
              value={hour}
              onChange={(e) => {
                const v = e.target.value;
                setHour(v);
                fetchData(date, v);
              }}
              disabled={!hourCandidates.length}
            >
              {!hourCandidates.length ? (
                <option value="">(Chưa có cột giờ)</option>
              ) : (
                <>
                  <option value="">(Mặc định giờ mới nhất)</option>
                  {hourCandidates.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          <button className="btn" onClick={() => fetchData(date, hour)} disabled={loading}>
            {loading ? "Đang tải..." : "Refresh"}
          </button>
        </div>
      </div>

      {err ? (
        <div className="kpi-error">
          <div className="kpi-error-title">Lỗi</div>
          <div className="kpi-error-text">{err}</div>
        </div>
      ) : null}

      <div className="kpi-grid-2">
        {/* TABLE 1: HIỆU SUẤT */}
        <div className="card">
          <div className="card-title">
            Hiệu suất trong ngày (so với định mức)
            <span className="chip">
              Tổng {perfSummary.total} • Đạt {perfSummary.ok} • Không đạt {perfSummary.fail}
            </span>
          </div>

          <div className="table-wrap">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền/BP</th>
                  <th>Mã hàng</th>
                  <th className="num">HS đạt</th>
                  <th className="num">HS ĐM</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {perf.map((x, i) => (
                  <tr key={i} className={x.ok ? "row-ok" : "row-bad"}>
                    <td className="mono">{x.line}</td>
                    <td className="mono">{x.mh || "-"}</td>
                    <td className="num">{x.hs_dat}</td>
                    <td className="num">{x.hs_dm}</td>
                    <td>
                      <span className={cls("badge", x.ok ? "badge-ok" : "badge-bad")}>
                        {x.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!perf.length ? (
                  <tr><td colSpan={5} className="empty">Không có dữ liệu</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* TABLE 2: KIỂM LŨY TIẾN */}
        <div className="card">
          <div className="card-title">
            Kiểm lũy tiến (so với định mức giờ)
            <span className="chip">
              Tổng {qcSummary.total} • OK {qcSummary.ok} • Lỗi {qcSummary.fail}
            </span>
          </div>

          <div className="table-wrap">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền/BP</th>
                  <th>Mã hàng</th>
                  <th className="num">Tổng kiểm đạt</th>
                  <th className="num">ĐM giờ</th>
                  <th className="num">Chênh</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {qc.map((x, i) => (
                  <tr key={i} className={x.ok ? "row-ok" : "row-bad"}>
                    <td className="mono">{x.line}</td>
                    <td className="mono">{x.mh || "-"}</td>
                    <td className="num">{x.totalKiemDat}</td>
                    <td className="num">{x.dmGio}</td>
                    <td className={cls("num", x.delta < 0 ? "neg" : "pos")}>{x.delta}</td>
                    <td>
                      <span className={cls("badge", x.ok ? "badge-ok" : "badge-bad")}>
                        {x.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!qc.length ? (
                  <tr><td colSpan={6} className="empty">Không có dữ liệu</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="hint">
            * Logic: = hoặc &gt; định mức → xanh. &lt; định mức → đỏ.
          </div>
        </div>
      </div>
    </div>
  );
}