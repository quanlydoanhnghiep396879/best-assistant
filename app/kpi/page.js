// app/kpi/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import "./kpi.css";

function nowDdMmYyyy() {
  // dd/MM/yyyy (VN)
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function fmt(n, digits = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  return x.toFixed(digits);
}

export default function KPIPage() {
  const [date, setDate] = useState(nowDdMmYyyy());
  const [line, setLine] = useState("TỔNG HỢP");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("Đang tải...");
  const [tick, setTick] = useState(0);

  async function load(nextDate = date, nextLine = line) {
    try {
      setStatus("Đang tải...");
      const ts = Date.now();
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(nextDate)}&line=${encodeURIComponent(nextLine)}&_ts=${ts}`, {
        cache: "no-store",
      });
      const j = await res.json();
      if (!j.ok) {
        setStatus("Lỗi: " + (j.error || "unknown"));
        setData(null);
        return;
      }
      setData(j);
      setStatus("OK (tự cập nhật mỗi 15s)");
    } catch (e) {
      setStatus("Lỗi: " + String(e?.message || e));
      setData(null);
    }
  }

  // load lần đầu + khi đổi ngày/line => load ngay, không cần refresh
  useEffect(() => {
    load(date, line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, line]);

  // auto refresh 15s
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    load(date, line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const lines = useMemo(() => data?.lines || ["TỔNG HỢP"], [data]);
  const dailyRows = useMemo(() => data?.dailyRows || [], [data]);
  const hourly = useMemo(() => data?.hourly || { dmH: 0, hours: [] }, [data]);

  return (
    <div className="kpi-root">
      <div className="kpi-header">
        <div>
          <div className="kpi-title">KPI Dashboard</div>
          <div className="kpi-sub">Chọn ngày và chuyền để xem dữ liệu</div>
        </div>

        <div className="kpi-controls">
          <div className="kpi-field">
            <label>Chọn ngày</label>
            <input
              className="kpi-input"
              value={date}
              onChange={(e) => setDate(e.target.value.trim())}
              placeholder="dd/MM/yyyy"
            />
          </div>

          <div className="kpi-field">
            <label>Chọn chuyền</label>
            <select className="kpi-select" value={line} onChange={(e) => setLine(e.target.value)}>
              {lines.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>

          <div className="kpi-status">{status}</div>
        </div>
      </div>

      <div className="kpi-grid">
        {/* DAILY */}
        <div className="kpi-card">
          <div className="kpi-card-title">Hiệu suất trong ngày (so với định mức)</div>

          <table className="kpi-table">
            <thead>
              <tr>
                <th>Chuyền/BP</th>
                <th className="num">HS đạt (%)</th>
                <th className="num">HS ĐM (%)</th>
                <th className="center">Trạng thái</th>
              </tr>
            </thead>

            <tbody>
              {dailyRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    (Chưa có dữ liệu % trong sheet)
                  </td>
                </tr>
              ) : (
                dailyRows.map((r) => (
                  <tr key={r.line}>
                    <td className="mono">{r.line}</td>
                    <td className="num">{fmt(r.hsDat, 2)}</td>
                    <td className="num">{fmt(r.hsDm, 2)}</td>
                    <td className="center">
                      <span className={`pill ${r.status === "ĐẠT" ? "pill-ok" : "pill-bad"}`}>{r.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="kpi-note">* So sánh: nếu HS đạt ≥ HS ĐM → <b>ĐẠT</b>, ngược lại <b>CHƯA ĐẠT</b>.</div>
        </div>

        {/* HOURLY */}
        <div className="kpi-card">
          <div className="kpi-card-title">
            Kiểm lũy tiến theo giờ (so với DM/H)
            <span className="kpi-right">DM/H: {fmt(hourly.dmH, 2)}</span>
          </div>

          <table className="kpi-table">
            <thead>
              <tr>
                <th>Giờ</th>
                <th className="num">Tổng kiểm đạt</th>
                <th className="num">DM lũy tiến</th>
                <th className="num">Chênh</th>
                <th className="center">Trạng thái</th>
              </tr>
            </thead>

            <tbody>
              {(!hourly.hours || hourly.hours.length === 0) ? (
                <tr>
                  <td colSpan={5} className="muted">
                    (Chưa có dữ liệu theo giờ)
                  </td>
                </tr>
              ) : (
                hourly.hours.map((h) => (
                  <tr key={h.label}>
                    <td className="mono">{h.label}</td>
                    <td className="num">{fmt(h.actual, 0)}</td>
                    <td className="num">{fmt(h.dmCum, 0)}</td>
                    <td className={`num ${h.diff >= 0 ? "good" : "bad"}`}>{fmt(h.diff, 0)}</td>
                    <td className="center">
                      <span className={`pill ${h.status === "VƯỢT" ? "pill-ok" : "pill-bad"}`}>{h.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="kpi-note">
            * Mỗi giờ: <b>DM lũy tiến = DM/H × số mốc giờ</b> (-&t;9h = 1, -&t;10h = 2, -&t;12h30 = 4.5, ...).
          </div>
        </div>
      </div>

      {data?._debug ? (
        <div className="kpi-debug">
          debug: anchorRow={data._debug.anchorRow}, dailyCount={data._debug.dailyCount}, hourlyCount={data._debug.hourlyCount}
        </div>
      ) : null}
    </div>
  );
}