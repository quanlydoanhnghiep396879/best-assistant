"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];

function fmtPercent(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Number(v).toFixed(2)}%`;
}

function safeText(v) {
  return (v ?? "").toString();
}

export default function KpiDashboardClient() {
  const [configRows, setConfigRows] = useState([]); // [{date, range}]
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);

  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  const [data, setData] = useState(null); // payload từ /api/check-kpi
  const [selectedLine, setSelectedLine] = useState("");

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");

  const [lineSearch, setLineSearch] = useState("");

  const refreshTimer = useRef(null);

  async function fetchConfig() {
    setLoadingConfig(true);
    setError("");
    try {
      const res = await fetch(`/api/kpi-config?t=${Date.now()}`, { method: "GET" });
      const json = await res.json();
      if (!res.ok || json.status !== "success") throw new Error(json.message || "Không đọc được config.");

      setConfigRows(json.configRows || []);
      setDates(json.dates || []);
      if ((json.dates || []).length > 0) {
        setSelectedDate((prev) => prev || json.dates[0]); // auto chọn ngày đầu
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoadingConfig(false);
    }
  }

  async function fetchData(dateStr) {
    if (!dateStr) return;
    setLoadingData(true);
    setError("");
    try {
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(dateStr)}&t=${Date.now()}`, {
        method: "GET",
      });
      const json = await res.json();
      if (!res.ok || json.status !== "success") throw new Error(json.message || "Không đọc được KPI.");

      setData(json);
      const lines = (json.lines || []).map((x) => x.line);
      setSelectedLine((prev) => (prev && lines.includes(prev) ? prev : (lines[0] || "")));

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      setLastUpdated(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`);
    } catch (e) {
      setData(null);
      setError(e?.message || String(e));
    } finally {
      setLoadingData(false);
    }
  }

  // load config lần đầu
  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto refresh 1 phút
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (!autoRefresh || !selectedDate) return;

    refreshTimer.current = setInterval(() => {
      fetchData(selectedDate);
    }, 60 * 1000);

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedDate]);

  const lines = useMemo(() => (data?.lines || []), [data]);
  const lineMap = useMemo(() => {
    const m = new Map();
    for (const l of lines) m.set(l.line, l);
    return m;
  }, [lines]);

  const filteredLines = useMemo(() => {
    const q = lineSearch.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((x) => x.line.toLowerCase().includes(q));
  }, [lines, lineSearch]);

  const currentLine = selectedLine ? lineMap.get(selectedLine) : null;

  const hourlyCompareRows = useMemo(() => {
    if (!currentLine) return [];

    const dmDay = Number(currentLine.dmDay || 0);
    const dmHourRaw = Number(currentLine.dmHour || 0);

    // nếu DM/H không có thì fallback DM/NGÀY / 8
    const dmHour = dmHourRaw > 0 ? dmHourRaw : (dmDay > 0 ? (dmDay / 8) : 0);

    const rows = MARKS.map((mark, idx) => {
      const i = idx + 1; // mốc thứ i
      const actual = currentLine.hourly?.[mark];
      const expected = dmHour > 0 ? Math.round(dmHour * i) : 0;

      const actualNum = (actual === null || actual === undefined || actual === "" || Number.isNaN(Number(actual)))
        ? null
        : Number(actual);

      const diff = actualNum === null ? null : (actualNum - expected);

      let status = "N/A";
      if (actualNum !== null) {
        if (diff < 0) status = "THIẾU";
        else if (diff === 0) status = "ĐỦ";
        else status = "VƯỢT";
      }

      return {
        mark,
        actual: actualNum,
        expected,
        diff,
        status,
      };
    });

    return rows;
  }, [currentLine]);

  return (
    <div style={{ padding: 18, fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ margin: 0 }}>KPI Dashboard</h1>
      <p style={{ marginTop: 8, color: "#444" }}>
        Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <b>Ngày:</b>
          <select
            disabled={loadingConfig || dates.length === 0}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: "6px 8px", minWidth: 160 }}
          >
            {dates.length === 0 ? (
              <option>Đang tải ngày...</option>
            ) : (
              dates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))
            )}
          </select>
        </div>

        <button
          disabled={!selectedDate || loadingData}
          onClick={() => fetchData(selectedDate)}
          style={{ padding: "8px 14px", cursor: "pointer" }}
        >
          {loadingData ? "Đang tải..." : "Xem dữ liệu"}
        </button>

        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Tự cập nhật (1 phút)
        </label>

        {lastUpdated ? <span style={{ color: "#666" }}>Cập nhật: <b>{lastUpdated}</b></span> : null}
      </div>

      {error ? (
        <div style={{ marginTop: 10, color: "red" }}>
          <b>Lỗi:</b> {error}
        </div>
      ) : null}

      {/* 2 bảng song song */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, marginTop: 14 }}>
        {/* LEFT: hiệu suất ngày */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>So sánh hiệu suất ngày</h3>
            <span style={{ color: "#666" }}>Mốc cuối: <b>{data?.latestMark || "->16h30"}</b></span>
          </div>

          <div style={{ overflow: "auto", marginTop: 10, maxHeight: 520 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  {["Chuyền", "HS đạt", "HS định mức", "Trạng thái"].map((h) => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 10, color: "#666" }}>Chưa có dữ liệu. Hãy chọn ngày rồi bấm “Xem dữ liệu”.</td></tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.line}>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}><b>{l.line}</b></td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>{fmtPercent(l.hsDay)}</td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>{fmtPercent(l.hsTarget)}</td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>
                        {safeText(l.hsStatus || "CHƯA CÓ")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: lũy tiến theo giờ */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3 style={{ margin: 0 }}>So sánh lũy tiến theo giờ (chuyền: <b>{selectedLine || "—"}</b>)</h3>

          {lines.length > 0 ? (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <input
                  value={lineSearch}
                  onChange={(e) => setLineSearch(e.target.value)}
                  placeholder="Tìm chuyền..."
                  style={{ padding: "6px 8px", minWidth: 160 }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {filteredLines.map((l) => (
                    <button
                      key={l.line}
                      onClick={() => setSelectedLine(l.line)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #ccc",
                        cursor: "pointer",
                        background: l.line === selectedLine ? "#111" : "#fff",
                        color: l.line === selectedLine ? "#fff" : "#111",
                      }}
                    >
                      {l.line}
                    </button>
                  ))}
                </div>
              </div>

              {!currentLine ? (
                <div style={{ marginTop: 12, color: "#666" }}>Chưa chọn chuyền.</div>
              ) : (
                <>
                  <div style={{ marginTop: 10, color: "#333" }}>
                    <b>DM/H:</b> {Number(currentLine.dmHour || 0).toFixed(2)} &nbsp;•&nbsp;
                    <b>DM/NGÀY:</b> {Number(currentLine.dmDay || 0).toFixed(0)}
                  </div>

                  <div style={{ overflow: "auto", marginTop: 10 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr>
                          {["Mốc", "Lũy tiến", "ĐM lũy tiến", "Chênh", "Trạng thái"].map((h) => (
                            <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px 6px" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hourlyCompareRows.map((r) => (
                          <tr key={r.mark}>
                            <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>{r.mark}</td>
                            <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>
                              {r.actual === null ? "—" : r.actual}
                            </td>
                            <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>{r.expected || 0}</td>
                            <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>
                              {r.diff === null ? "—" : (r.diff > 0 ? `+${r.diff}` : `${r.diff}`)}
                            </td>
                            <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 6px" }}>
                              <b>{r.status}</b>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{ marginTop: 10, color: "#666" }}>Chưa có dữ liệu.</div>
          )}
        </div>
      </div>
    </div>
  );
}
