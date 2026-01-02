"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./kpi.css";

export default function KpiPage() {
  const [dates, setDates] = useState([]);
  const [lines, setLines] = useState([]);
  const [date, setDate] = useState("");
  const [line, setLine] = useState("TỔNG HỢP");

  const [dailyRows, setDailyRows] = useState([]);
  const [hourly, setHourly] = useState(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const abortRef = useRef(null);

  async function loadData(nextDate, nextLine) {
    setLoading(true);
    setErr("");

    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const qs = new URLSearchParams();
      if (nextDate) qs.set("date", nextDate);
      if (nextLine) qs.set("line", nextLine);

      const res = await fetch(`/api/check-kpi?${qs.toString()}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });

      const js = await res.json();
      if (!js?.ok) throw new Error(js?.error || "API error");

      setDates(js.dates || []);
      setLines(js.lines || []);

      // nếu lần đầu chưa có date => set theo chosenDate
      setDate((prev) => prev || js.chosenDate || "");

      // nếu line hiện tại không còn trong list => fallback
      const validLine = (js.lines || []).includes(nextLine) ? nextLine : "TỔNG HỢP";
      setLine(validLine);

      setDailyRows(js.dailyRows || []);
      setHourly(js.hourly || null);
    } catch (e) {
      if (e?.name === "AbortError") return;
      setErr(String(e?.message || e));
      setDailyRows([]);
      setHourly(null);
    } finally {
      setLoading(false);
    }
  }

  // load lần đầu
  useEffect(() => {
    loadData("", "TỔNG HỢP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ auto load khi đổi ngày / chuyền (không cần Refresh)
  useEffect(() => {
    if (!date) return;
    loadData(date, line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, line]);

  const dailySorted = useMemo(() => {
    // luôn đưa TỔNG HỢP lên đầu nếu có
    const a = [...dailyRows];
    a.sort((x, y) => (x.line === "TỔNG HỢP" ? -1 : y.line === "TỔNG HỢP" ? 1 : x.line.localeCompare(y.line)));
    return a;
  }, [dailyRows]);

  return (
    <div className="kpi-wrap">
      <div className="kpi-header">
        <div>
          <div className="kpi-title">KPI Dashboard</div>
          <div className="kpi-sub">Chọn ngày và chuyền để xem dữ liệu</div>
        </div>

        <div className="kpi-controls">
          <div className="ctrl">
            <label>Chọn ngày</label>
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {(dates || []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="ctrl">
            <label>Chọn chuyền</label>
            <select value={line} onChange={(e) => setLine(e.target.value)}>
              {(lines || []).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="ctrl meta">
            {loading ? <span className="pill">Đang tải…</span> : <span className="pill ok">OK</span>}
          </div>
        </div>
      </div>

      {err ? <div className="kpi-error">Lỗi: {err}</div> : null}

      <div className="kpi-grid">
        {/* ===== BẢNG HIỆU SUẤT NGÀY ===== */}
        <div className="card">
          <div className="card-title">Hiệu suất trong ngày (so với định mức)</div>

          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Chuyền/BP</th>
                  <th>HS đạt (%)</th>
                  <th>HS ĐM (%)</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {dailySorted.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      (Chưa có dữ liệu bảng % trong sheet)
                    </td>
                  </tr>
                ) : (
                  dailySorted.map((r) => (
                    <tr key={r.line}>
                      <td className="mono">{r.line}</td>
                      <td>{Number(r.hsDat || 0).toFixed(2)}</td>
                      <td>{Number(r.hsDm || 0).toFixed(2)}</td>
                      <td>
                        <span className={`badge ${r.status === "ĐẠT" ? "good" : "bad"}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="hint">
            * So sánh: nếu <b>HS đạt ≥ HS ĐM</b> → <b>ĐẠT</b>, ngược lại <b>CHƯA ĐẠT</b>.
          </div>
        </div>

        {/* ===== BẢNG THEO GIỜ ===== */}
        <div className="card">
          <div className="card-title">
            Kiểm lũy tiến theo giờ (so với ĐM/H){" "}
            <span className="small">
              {hourly?.dmH ? `ĐM/H: ${hourly.dmH}` : ""}
            </span>
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
                {(!hourly?.hours || hourly.hours.length === 0) ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      (Chưa tìm thấy bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY” cho ngày này)
                    </td>
                  </tr>
                ) : (
                  hourly.hours.map((h) => (
                    <tr key={h.label}>
                      <td className="mono">{h.label}</td>
                      <td>{h.actual}</td>
                      <td>{h.target}</td>
                      <td className={h.diff < 0 ? "neg" : "pos"}>{h.diff}</td>
                      <td>
                        <span className={`badge ${h.status === "VƯỢT" || h.status === "ĐỦ" ? "good" : "bad"}`}>
                          {h.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="hint">
            * Mỗi giờ: <b>ĐM lũy tiến = ĐM/H × số mốc giờ</b>. (Để sếp so sánh nhanh)
          </div>
        </div>
      </div>
    </div>
  );
}