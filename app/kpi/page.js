// app/kpi/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function fmt2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}
function fmtInt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  return Math.round(x).toString();
}

export default function KPIPage() {
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState([]);
  const [lines, setLines] = useState([]);

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedLine, setSelectedLine] = useState("TỔNG HỢP");

  const [dailyRows, setDailyRows] = useState([]);
  const [hourly, setHourly] = useState({ line: "TỔNG HỢP", dmDay: 0, dmH: 0, hours: [] });

  const timerRef = useRef(null);

  async function load(dateArg, lineArg) {
    const date = dateArg ?? selectedDate;
    const line = lineArg ?? selectedLine;

    setLoading(true);
    try {
      const url = `/api/check-kpi?date=${encodeURIComponent(date || "")}&line=${encodeURIComponent(line || "TỔNG HỢP")}&_ts=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();

      if (!data?.ok) throw new Error(data?.error || "API error");

      setDates(data.dates || []);
      setLines(data.lines || []);
      setSelectedDate(data.chosenDate || "");
      setSelectedLine(data.selectedLine || "TỔNG HỢP");

      setDailyRows(data.dailyRows || []);
      setHourly(data.hourly || { line: "TỔNG HỢP", dmDay: 0, dmH: 0, hours: [] });
    } finally {
      setLoading(false);
    }
  }

  // load lần đầu
  useEffect(() => {
    load("", "TỔNG HỢP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // đổi ngày / chuyền -> load ngay (không cần Refresh)
  useEffect(() => {
    if (!selectedDate) return;
    load(selectedDate, selectedLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedLine]);

  // auto refresh mỗi 15s + khi focus/visible lại
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    const tick = () => {
      if (!selectedDate) return;
      load(selectedDate, selectedLine);
    };

    timerRef.current = setInterval(tick, 15000);

    const onFocus = () => tick();
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedLine]);

  const dailyForView = useMemo(() => {
    // dailyRows đã được API lọc bỏ CAT/KCS/NM/HOÀN TẤT
    return dailyRows;
  }, [dailyRows]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 6 }}>KPI Dashboard</h1>
      <div style={{ opacity: 0.8, marginBottom: 12 }}>Chọn ngày và chuyền để xem dữ liệu</div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Chọn ngày</div>
          <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}>
            {(dates || []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Chọn chuyền</div>
          <select value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)}>
            {(lines || []).map((ln) => (
              <option key={ln} value={ln}>
                {ln}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: 12, opacity: 0.8 }}>
          {loading ? "Đang tải..." : "OK"} (tự cập nhật mỗi 15s)
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* DAILY */}
        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Hiệu suất trong ngày (so với định mức)</h3>

          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.85 }}>
                  <th style={{ padding: "8px 6px" }}>Chuyền/BP</th>
                  <th style={{ padding: "8px 6px" }}>HS đạt (%)</th>
                  <th style={{ padding: "8px 6px" }}>HS ĐM (%)</th>
                  <th style={{ padding: "8px 6px" }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {dailyForView.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 10, opacity: 0.7 }}>
                      (Chưa có dữ liệu % trong sheet)
                    </td>
                  </tr>
                ) : (
                  dailyForView.map((r) => (
                    <tr key={r.line} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <td style={{ padding: "8px 6px" }}>{r.line}</td>
                      <td style={{ padding: "8px 6px" }}>{fmt2(r.hsDat)}</td>
                      <td style={{ padding: "8px 6px" }}>{fmt2(r.hsDm)}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.15)",
                            color: r.status === "ĐẠT" ? "#7CFFB2" : "#FF8A8A",
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            * So sánh: nếu HS đạt ≥ HS ĐM → <b>ĐẠT</b>, ngược lại <b>CHƯA ĐẠT</b>.
          </div>
        </div>

        {/* HOURLY */}
        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>
            Kiểm lũy tiến theo giờ (so với ĐM/H){" "}
            <span style={{ fontSize: 12, opacity: 0.75, marginLeft: 8 }}>ĐM/H: {fmtInt(hourly?.dmH || 0)}</span>
          </h3>

          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.85 }}>
                  <th style={{ padding: "8px 6px" }}>Giờ</th>
                  <th style={{ padding: "8px 6px" }}>Tổng kiểm đạt</th>
                  <th style={{ padding: "8px 6px" }}>ĐM lũy tiến</th>
                  <th style={{ padding: "8px 6px" }}>Chênh</th>
                  <th style={{ padding: "8px 6px" }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {(hourly?.hours || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 10, opacity: 0.7 }}>
                      (Chưa có dữ liệu theo giờ)
                    </td>
                  </tr>
                ) : (
                  (hourly.hours || []).map((h, idx) => (
                    <tr key={idx} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <td style={{ padding: "8px 6px" }}>{h.label}</td>
                      <td style={{ padding: "8px 6px" }}>{fmtInt(h.actual)}</td>
                      <td style={{ padding: "8px 6px" }}>{fmtInt(h.target)}</td>
                      <td style={{ padding: "8px 6px", color: (h.diff || 0) >= 0 ? "#7CFFB2" : "#FF8A8A" }}>
                        {fmtInt(h.diff)}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.15)",
                            color: h.status === "VƯỢT" || h.status === "ĐỦ" ? "#7CFFB2" : "#FF8A8A",
                          }}
                        >
                          {h.status === "ĐỦ" ? "ĐỦ" : h.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            * Mỗi giờ: ĐM lũy tiến = ĐM/H × số mốc giờ.
          </div>
        </div>
      </div>
    </div>
  );
}