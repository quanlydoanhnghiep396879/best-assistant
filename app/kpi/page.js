
// app/kpi/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import "./kpi.css";

function ddmmyyyyFromISO(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function pillClass(status) {
  const s = String(status || "").toUpperCase();
  if (s === "ĐẠT" || s === "VUOT" || s === "VƯỢT") return "pill pill-ok";
  if (s === "ĐỦ" || s === "DU") return "pill pill-warn";
  return "pill pill-bad";
}

export default function KPIPage() {
  const [isoDate, setIsoDate] = useState(todayISO());
  const [line, setLine] = useState("TỔNG HỢP");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const ddmmyyyy = useMemo(() => ddmmyyyyFromISO(isoDate), [isoDate]);

  async function loadKPI({ silent = false } = {}) {
    if (!ddmmyyyy) return;
    if (!silent) setLoading(true);
    setErr("");

    try {
      const qs = new URLSearchParams({
        date: ddmmyyyy,
        line,
        _ts: String(Date.now()), // cache-bust để sheet đổi là thấy
      });

      const res = await fetch(`/api/check-kpi?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();

      if (!json.ok) throw new Error(json.error || "API error");
      setData(json);
    } catch (e) {
      setErr(e?.message || "Load failed");
      setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // load khi đổi ngày / đổi chuyền (KHÔNG CẦN REFRESH)
  useEffect(() => {
    loadKPI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddmmyyyy, line]);

  // auto refresh mỗi 15s
  useEffect(() => {
    const t = setInterval(() => loadKPI({ silent: true }), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddmmyyyy, line]);

  // nếu line hiện tại không tồn tại trong data.lines thì reset về TỔNG HỢP
  useEffect(() => {
    const lines = data?.lines || [];
    if (!lines.length) return;
    if (!lines.includes(line.toUpperCase())) setLine("TỔNG HỢP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.lines?.join("|")]);

  const lines = data?.lines || [];
  const dailyRows = data?.dailyRows || [];
  const hourly = data?.hourly || null;

  return (
    <div className="kpi-wrap">
      <h1 className="kpi-title">KPI Dashboard</h1>
      <p className="kpi-sub">Chọn ngày và chuyền để xem dữ liệu</p>

      <div className="kpi-toolbar">
        <div className="kpi-field">
          <div className="kpi-label">Chọn ngày</div>
          <input
            className="kpi-input"
            type="date"
            value={isoDate}
            onChange={(e) => setIsoDate(e.target.value)}
          />
        </div>

        <div className="kpi-field">
          <div className="kpi-label">Chọn chuyền</div>
          <select
            className="kpi-select"
            value={line}
            onChange={(e) => setLine(e.target.value)}
          >
            {/* nếu API chưa có lines thì vẫn cho chọn tổng hợp */}
            <option value="TỔNG HỢP">TỔNG HỢP</option>
            {lines
              .filter((x) => x !== "TỔNG HỢP")
              .map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
          </select>
        </div>

        <div className="kpi-status">
          {loading ? "Đang tải..." : err ? `Lỗi: ${err}` : `OK (tự cập nhật mỗi 15s)`}
        </div>
      </div>

      <div className="kpi-grid">
        {/* ===== DAILY ===== */}
        <div className="kpi-card">
          <h3>Hiệu suất trong ngày (so với định mức)</h3>

          {!dailyRows.length ? (
            <div className="kpi-note">(Chưa có dữ liệu ngày này)</div>
          ) : (
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền/BP</th>
                  <th className="num">HS đạt (%)</th>
                  <th className="num">HS ĐM (%)</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td className="num">{Number(r.hsDat).toFixed(2)}</td>
                    <td className="num">{Number(r.hsDm).toFixed(2)}</td>
                    <td>
                      <span className={pillClass(r.status)}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="kpi-note">
            * So sánh: nếu <b>HS đạt ≥ HS ĐM</b> → <b>ĐẠT</b>, ngược lại <b>CHƯA ĐẠT</b>.
          </div>
        </div>

        {/* ===== HOURLY ===== */}
        <div className="kpi-card">
          <h3>Kiểm lũy tiến theo giờ (so với DM/H)</h3>

          {!hourly?.hours?.length ? (
            <div className="kpi-note">(Chưa có dữ liệu theo giờ cho chuyền/ngày này)</div>
          ) : (
            <>
              <div className="kpi-note" style={{ marginTop: 0 }}>
                DM/H: <b className="num">{Number(hourly.dmH).toFixed(2)}</b>
              </div>

              <table className="kpi-table" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Giờ</th>
                    <th className="num">Tổng kiểm đạt</th>
                    <th className="num">DM lũy tiến</th>
                    <th className="num">Chênh</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {hourly.hours.map((h) => (
                    <tr key={h.label}>
                      <td>{h.label}</td>
                      <td className="num">{Number(h.total).toFixed(2)}</td>
                      <td className="num">{Number(h.dmTarget).toFixed(2)}</td>
                      <td className="num">{Number(h.diff).toFixed(2)}</td>
                      <td>
                        <span className={pillClass(h.status)}>{h.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="kpi-note">
                * Mỗi giờ: <b>DM lũy tiến = DM/H × số mốc giờ</b> (→9h=1, →10h=2, →12h30=4.5, …).
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}