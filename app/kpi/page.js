// app/kpi/page.jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import "./kpi.css";

export default function KpiPage() {
  const [dates, setDates] = useState([]);
  const [lines, setLines] = useState([]);
  const [date, setDate] = useState("");
  const [line, setLine] = useState("TỔNG HỢP");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(dateVal, lineVal) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dateVal) qs.set("date", dateVal);
      if (lineVal) qs.set("line", lineVal);

      const res = await fetch(`/api/check-kpi?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json();

      setData(j);

      const ds = j?.dates || [];
      const ls = j?.lines || [];

      setDates(ds);
      setLines(ls);

      // set default if empty
      if (!dateVal && ds[0]) setDate(ds[0]);
      if (!lineVal && ls.includes("TỔNG HỢP")) setLine("TỔNG HỢP");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("", "TỔNG HỢP");
  }, []);

  useEffect(() => {
    if (!date) return;
    load(date, line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, line]);

  const hourly = data?.hourly || { dmH: 0, dmDay: 0, hours: [], line: line };
  const dailyRows = data?.dailyRows || [];

  const dailyRowSelected = useMemo(() => {
    if (!dailyRows.length) return null;
    return dailyRows.find((r) => r.line === (data?.selectedLine || line)) || null;
  }, [dailyRows, data?.selectedLine, line]);

  return (
    <div className="kpi-page">
      <div className="kpi-title">KPI Dashboard</div>
      <div className="kpi-sub">Chọn ngày và chuyền để xem dữ liệu</div>

      <div className="kpi-toolbar">
        <div className="field">
          <label>Chọn ngày</label>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Chọn chuyền</label>
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            {lines.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <button className="btn" onClick={() => load(date, line)}>
          {loading ? "Đang tải..." : "Refresh"}
        </button>
      </div>

      <div className="grid">
        {/* LEFT: Daily performance */}
        <div className="card">
          <h3>Hiệu suất trong ngày (so với định mức)</h3>

          <table className="kpi-table">
            <thead>
              <tr>
                <th>Chuyền/BP</th>
                <th>Mã hàng</th>
                <th className="right">HS đạt (%)</th>
                <th className="right">HS ĐM (%)</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.length ? (
                dailyRows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.maHang || "-"}</td>
                    <td className="right">{Number(r.hsDat || 0).toFixed(2)}</td>
                    <td className="right">{Number(r.hsDm || 100).toFixed(0)}</td>
                    <td>
                      <span
                        className={
                          "pill " +
                          (String(r.status).includes("ĐẠT")
                            ? "ok"
                            : String(r.status).includes("CHƯA ĐẠT")
                            ? "bad"
                            : "warn")
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="muted">
                    (Chưa có dữ liệu hiệu suất trong ngày)
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {dailyRowSelected ? (
            <div className="small" style={{ marginTop: 10 }}>
              Đang xem: <b>{dailyRowSelected.line}</b> — HS đạt:{" "}
              <b>{Number(dailyRowSelected.hsDat || 0).toFixed(2)}%</b>
            </div>
          ) : null}
        </div>

        {/* RIGHT: Hourly cumulative */}
        <div className="card">
          <div className="hours-head">
            <h3>Kiểm lũy tiến theo giờ (so với DM/H)</h3>
            <div className="small">
              DM/H: <b>{Number(hourly.dmH || 0).toFixed(0)}</b>
            </div>
          </div>

          <table className="kpi-table">
            <thead>
              <tr>
                <th>Giờ</th>
                <th className="right">Tổng kiểm đạt</th>
                <th className="right">DM lũy tiến</th>
                <th className="right">Chênh</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {(hourly.hours || []).map((h) => {
                const diff = Number(h.diff || 0);
                const ok = diff >= 0;
                return (
                  <tr key={h.label}>
                    <td>{h.label}</td>
                    <td className="right">{Number(h.actual || 0).toFixed(0)}</td>
                    <td className="right">{Number(h.target || 0).toFixed(0)}</td>
                    <td className={"right diff " + (ok ? "ok" : "bad")}>{diff.toFixed(0)}</td>
                    <td>
                      <span className={"pill " + (h.status === "VƯỢT" || h.status === "ĐỦ" ? "ok" : "bad")}>
                        {h.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!hourly.hours?.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    (Chưa có dữ liệu giờ cho ngày này)
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <div className="small" style={{ marginTop: 10 }}>
            Logic: = ĐỦ (xanh), &gt; VƯỢT (xanh), &lt; THIẾU (đỏ). Lấy trực tiếp từ bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ,
            NGÀY”.
          </div>
        </div>
      </div>
    </div>
  );
}