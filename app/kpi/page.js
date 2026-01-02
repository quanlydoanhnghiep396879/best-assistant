"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./kpi.css";

const norm = (s) => (s ?? "").toString().trim();
const isTongHop = (x) => ["TONG HOP", "TỔNG HỢP"].includes(norm(x).toUpperCase());

function fmtInt(n) {
  if (n === null || n === undefined) return "-";
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return Math.round(x).toString();
}
function fmtPct(n) {
  if (n === null || n === undefined) return "-";
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return x.toFixed(2);
}

export default function KPIPanel() {
  const [dates, setDates] = useState([]);
  const [chosenDate, setChosenDate] = useState("");
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState("TỔNG HỢP");

  const [dailyRows, setDailyRows] = useState([]);
  const [hourly, setHourly] = useState({ line: "", dmH: 0, hours: [] });

  const [statusText, setStatusText] = useState("...");
  const timerRef = useRef(null);

  const fetchData = async (date, line) => {
    const qs = new URLSearchParams();
    if (date) qs.set("date", date);
    if (line) qs.set("line", line);
    qs.set("t", String(Date.now())); // bust cache

    const res = await fetch(`/api/check-kpi?${qs.toString()}`, { cache: "no-store" });
    const json = await res.json();

    if (!json?.ok) {
      setStatusText("LỖI API");
      return;
    }

    setDates(json.dates || []);
    setChosenDate(json.chosenDate || "");

    const newLines = json.lines || [];
    setLines(newLines);

    let newSelected = json.selectedLine || line || "TỔNG HỢP";
    // fix C10 sort already in API, but keep stable here
    if (!newLines.some((x) => norm(x).toUpperCase() === norm(newSelected).toUpperCase())) {
      newSelected = newLines.find((x) => isTongHop(x)) || newLines[0] || "TỔNG HỢP";
    }
    setSelectedLine(newSelected);

    setDailyRows(json.dailyRows || []);
    setHourly(json.hourly || { line: newSelected, dmH: 0, hours: [] });

    setStatusText("OK (tự cập nhật mỗi 15s)");
  };

  // initial load
  useEffect(() => {
    fetchData("", "TỔNG HỢP");
  }, []);

  // auto refresh (15s) + chỉ refresh khi tab đang visible
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      fetchData(chosenDate, selectedLine);
    };
    timerRef.current = setInterval(tick, 15000);
    return () => clearInterval(timerRef.current);
  }, [chosenDate, selectedLine]);

  // when date changes => load immediately
  const onChangeDate = (v) => {
    setChosenDate(v);
    fetchData(v, selectedLine);
  };

  // when line changes => load immediately (no refresh button)
  const onChangeLine = (v) => {
    setSelectedLine(v);
    fetchData(chosenDate, v);
  };

  const dailyForView = useMemo(() => {
    // show TỔNG HỢP first then C1..C10 (API already sorted)
    return dailyRows || [];
  }, [dailyRows]);

  return (
    <div className="kpi-wrap">
      <div className="kpi-top">
        <div>
          <div className="kpi-title">KPI Dashboard</div>
          <div className="kpi-sub">Chọn ngày và chuyền để xem dữ liệu</div>
        </div>

        <div className="kpi-controls">
          <div className="ctrl">
            <label>Chọn ngày</label>
            <select value={chosenDate} onChange={(e) => onChangeDate(e.target.value)}>
              {(dates || []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="ctrl">
            <label>Chọn chuyền</label>
            <select value={selectedLine} onChange={(e) => onChangeLine(e.target.value)}>
              {(lines || []).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="kpi-badge">{statusText}</div>
        </div>
      </div>

      <div className="kpi-grid">
        {/* DAILY */}
        <div className="card">
          <div className="card-title">Hiệu suất trong ngày (so với định mức)</div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Chuyền/BP</th>
                  <th className="num">HS đạt (%)</th>
                  <th className="num">HS ĐM (%)</th>
                  <th className="center">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {dailyForView.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      (Chưa có dữ liệu % trong sheet)
                    </td>
                  </tr>
                ) : (
                  dailyForView.map((r) => {
                    const ok = r.status === "ĐẠT";
                    return (
                      <tr key={r.line} className={isTongHop(r.line) ? "row-total" : ""}>
                        <td>{r.line}</td>
                        <td className="num">{fmtPct(r.hsDat)}</td>
                        <td className="num">{fmtPct(r.hsDm)}</td>
                        <td className="center">
                          <span className={`pill ${ok ? "pill-ok" : r.status === "CHƯA ĐẠT" ? "pill-bad" : "pill-warn"}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="note">
            * So sánh: nếu <b>HS đạt ≥ HS ĐM</b> → <b>ĐẠT</b>, ngược lại <b>CHƯA ĐẠT</b>.
          </div>
        </div>

        {/* HOURLY */}
        <div className="card">
          <div className="card-title">
            Kiểm lũy tiến theo giờ (so với DM/H) <span className="right">DM/H: {fmtInt(hourly?.dmH)}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Giờ</th>
                  <th className="num">Tổng kiểm đạt</th>
                  <th className="num">DM lũy tiến</th>
                  <th className="num">Chênh</th>
                  <th className="center">Trạng thái</th>
                  <th className="num">Trong giờ</th>
                  <th className="num">DM/H</th>
                  <th className="num">Chênh giờ</th>
                  <th className="center">Trạng thái giờ</th>
                </tr>
              </thead>
              <tbody>
                {(hourly?.hours || []).length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted">
                      (Chưa có dữ liệu theo giờ)
                    </td>
                  </tr>
                ) : (
                  hourly.hours.map((h) => {
                    const okCum = h.diffCum >= 0;
                    const okHour = h.diffHour >= 0;
                    return (
                      <tr key={h.label}>
                        <td>{h.label}</td>
                        <td className="num">{fmtInt(h.cumActual)}</td>
                        <td className="num">{fmtInt(h.expectedCum)}</td>
                        <td className={`num ${okCum ? "good" : "bad"}`}>{fmtInt(h.diffCum)}</td>
                        <td className="center">
                          <span className={`pill ${okCum ? "pill-ok" : "pill-bad"}`}>{okCum ? "VƯỢT/ĐỦ" : "THIẾU"}</span>
                        </td>

                        <td className="num">{fmtInt(h.inHour)}</td>
                        <td className="num">{fmtInt(h.expectedHour)}</td>
                        <td className={`num ${okHour ? "good" : "bad"}`}>{fmtInt(h.diffHour)}</td>
                        <td className="center">
                          <span className={`pill ${okHour ? "pill-ok" : "pill-bad"}`}>{okHour ? "VƯỢT/ĐỦ" : "THIẾU"}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="note">
            * Mốc giờ: <b>DM lũy tiến = DM/H × số mốc giờ</b> (-9h=1, -10h=2, ...).
          </div>
        </div>
      </div>
    </div>
  );
}