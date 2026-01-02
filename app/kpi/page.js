"use client";

import React, { useEffect, useMemo, useState } from "react";
import "./kpi.css";

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return x.toLocaleString("vi-VN");
}
function fmt2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return x.toFixed(2);
}

function StatusPill({ s }) {
  const t = String(s || "").toUpperCase();
  let cls = "pill";
  if (t.includes("ĐẠT") || t.includes("ĐỦ") || t.includes("VƯỢT")) cls += " ok";
  else if (t.includes("THIẾU") || t.includes("CHƯA ĐẠT")) cls += " bad";
  else cls += " warn";
  return <span className={cls}>{s || "-"}</span>;
}

export default function KPIPage() {
  const [dates, setDates] = useState([]);
  const [lines, setLines] = useState([]);
  const [date, setDate] = useState("");
  const [line, setLine] = useState("TỔNG HỢP");
  const [dailyRows, setDailyRows] = useState([]);
  const [hourly, setHourly] = useState({ line: "TỔNG HỢP", dmDay: 0, dmH: 0, hours: [] });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function load(d = date, l = line) {
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (d) qs.set("date", d);
      if (l) qs.set("line", l);
      const res = await fetch(`/api/check-kpi?${qs.toString()}`, { cache: "no-store" });
      const js = await res.json();
      if (!js.ok) throw new Error(js.error || "API error");

      setDates(js.dates || []);
      setLines(js.lines || []);
      setDate(js.chosenDate || d || "");
      setLine(js.selectedLine || l || "TỔNG HỢP");
      setDailyRows(js.dailyRows || []);
      setHourly(js.hourly || { line: "TỔNG HỢP", dmDay: 0, dmH: 0, hours: [] });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("", "TỔNG HỢP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedDaily = useMemo(() => {
    // nếu muốn chỉ hiện 1 chuyền đang chọn thì filter ở đây
    return dailyRows;
  }, [dailyRows]);

  return (
    <div className="kpi-page">
      <div className="topbar">
        <div>
          <div className="title">KPI Dashboard</div>
          <div className="subtitle">Chọn ngày và chuyền để xem dữ liệu</div>
        </div>

        <div className="controls">
          <div className="control">
            <label>Chọn ngày</label>
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="control">
            <label>Chọn chuyền</label>
            <select value={line} onChange={(e) => setLine(e.target.value)}>
              {(lines.length ? lines : ["TỔNG HỢP"]).map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>

          <button className="btn" onClick={() => load(date, line)} disabled={loading}>
            {loading ? "Đang tải..." : "Refresh"}
          </button>
        </div>
      </div>

      {err ? <div className="error">Lỗi: {err}</div> : null}

      <div className="grid">
        {/* ===== BẢNG HIỆU SUẤT NGÀY ===== */}
        <div className="card">
          <div className="card-title">Hiệu suất trong ngày (so với định mức)</div>

          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Chuyền/BP</th>
                  <th>Mã hàng</th>
                  <th>HS đạt (%)</th>
                  <th>HS ĐM (%)</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {selectedDaily?.length ? (
                  selectedDaily.map((r) => (
                    <tr key={r.line}>
                      <td className="mono">{r.line}</td>
                      <td className="mono">{r.maHang || "-"}</td>
                      <td>{fmt2(r.hsDat)}</td>
                      <td>{fmt2(r.hsDm)}</td>
                      <td><StatusPill s={r.status} /></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="muted">Chưa có dữ liệu.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="hint">
            * HS đạt đang tính theo: <b>Giờ cuối / ĐM lũy tiến</b> (dựa bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY”).
          </div>
        </div>

        {/* ===== BẢNG TỪNG GIỜ ===== */}
        <div className="card">
          <div className="card-title">
            Kiểm lũy tiến theo giờ (so với ĐM/H) — <span className="mono">{hourly?.line || "-"}</span>
            <span className="right-note">ĐM/H: <b>{fmt(hourly?.dmH)}</b></span>
          </div>

          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Giờ</th>
                  <th>Tổng kiểm đạt</th>
                  <th>ĐM lũy tiến</th>
                  <th>Chênh</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {hourly?.hours?.length ? (
                  hourly.hours.map((h, idx) => (
                    <tr key={idx}>
                      <td className="mono">{h.label}</td>
                      <td>{fmt(h.actual)}</td>
                      <td>{fmt(h.target)}</td>
                      <td className={Number(h.diff) < 0 ? "neg" : "pos"}>{fmt(h.diff)}</td>
                      <td><StatusPill s={h.status} /></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="muted">Chưa đọc được bảng giờ (kiểm tra sheet).</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="hint">
            Logic: = ĐỦ (xanh), &gt; VƯỢT (xanh), &lt; THIẾU (đỏ). Lấy trực tiếp từ bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY”.
          </div>
        </div>
      </div>
    </div>
  );
}