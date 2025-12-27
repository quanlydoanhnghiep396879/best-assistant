// app/kpi/KpiDashboardClient.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [error, setError] = useState("");

  const [data, setData] = useState(null);
  const [selectedLine, setSelectedLine] = useState("");

  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const AUTO_REFRESH_MS = 60 * 1000;

  const inflightRef = useRef(false);
  const lastUpdatedRef = useRef(null);
  const [, forceTick] = useState(0);

  // load dates
  useEffect(() => {
    (async () => {
      try {
        setLoadingConfig(true);
        setError("");
        const res = await fetch("/api/kpi-config", { cache: "no-store" });
        const json = await res.json();
        if (json.status !== "success") throw new Error(json.message || "kpi-config error");

        setDates(json.dates || []);
        if ((json.dates || []).length) setSelectedDate(json.dates[json.dates.length - 1]);
      } catch (e) {
        setError(e?.message || "Không đọc được CONFIG_KPI");
      } finally {
        setLoadingConfig(false);
      }
    })();
  }, []);

  async function loadKpiOnce() {
    if (!selectedDate) return;
    if (inflightRef.current) return;

    try {
      inflightRef.current = true;
      setLoadingData(true);
      setError("");

      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(selectedDate)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.message || "check-kpi error");

      setData(json);

      const lines = json.lines || [];
      if (lines.length) {
        if (!selectedLine) setSelectedLine(lines[0].line);
        if (selectedLine && !lines.some((x) => x.line === selectedLine)) {
          setSelectedLine(lines[0].line);
        }
      }

      lastUpdatedRef.current = new Date();
      forceTick((x) => x + 1);
    } catch (e) {
      setError(e?.message || "Lỗi khi gọi check-kpi");
    } finally {
      inflightRef.current = false;
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (!selectedDate) return;
    loadKpiOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!autoRefresh) return;
    if (!selectedDate) return;
    const id = setInterval(() => loadKpiOnce(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedDate]);

  const lines = data?.lines || [];
  const currentLine = useMemo(
    () => lines.find((l) => l.line === selectedLine) || null,
    [lines, selectedLine]
  );

  const lastUpdatedText = useMemo(() => {
    const d = lastUpdatedRef.current;
    return d ? d.toLocaleString("vi-VN") : "";
  }, [data]);

  const styles = {
    row: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 },
    select: { padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, minWidth: 180 },
    btn: {
      padding: "7px 12px",
      border: "1px solid #111",
      background: "#111",
      color: "#fff",
      borderRadius: 6,
      cursor: "pointer",
    },
    btnOff: { opacity: 0.6, cursor: "not-allowed" },
    wrap: {
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      flexWrap: "nowrap",
    },
    panel: {
      border: "1px solid #ddd",
      borderRadius: 10,
      padding: 12,
      background: "#fff",
      width: "50%",
      minWidth: 0,
      maxHeight: "calc(100vh - 220px)",
      overflow: "auto",
    },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
    th: { border: "1px solid #ddd", padding: "6px 8px", background: "#f6f6f6", textAlign: "left" },
    td: { border: "1px solid #ddd", padding: "6px 8px" },
    tdR: { border: "1px solid #ddd", padding: "6px 8px", textAlign: "right" },
    tdC: { border: "1px solid #ddd", padding: "6px 8px", textAlign: "center" },
    chipRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 },
    chip: { border: "1px solid #bbb", borderRadius: 8, padding: "4px 8px", background: "#fff" },
    chipOn: { background: "#111", color: "#fff", borderColor: "#111" },
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={styles.row}>
        <div>
          <b>Ngày:</b>{" "}
          <select
            style={styles.select}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            disabled={loadingConfig || !dates.length}
          >
            {loadingConfig && <option>Đang tải ngày...</option>}
            {!loadingConfig && !dates.length && <option>Không có ngày</option>}
            {!loadingConfig &&
              dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
          </select>
        </div>

        <button
          style={{ ...styles.btn, ...(loadingData ? styles.btnOff : {}) }}
          disabled={!selectedDate || loadingData}
          onClick={loadKpiOnce}
        >
          {loadingData ? "Đang tải..." : "Xem dữ liệu"}
        </button>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Tự cập nhật (1 phút)
        </label>

        {lastUpdatedText && (
          <span style={{ fontSize: 13, color: "#555" }}>
            Cập nhật: <b>{lastUpdatedText}</b>
          </span>
        )}
      </div>

      {error && <div style={{ color: "red", marginBottom: 10 }}>Lỗi: {error}</div>}
      {!data && !error && <div style={{ color: "#666" }}>Chọn ngày rồi bấm “Xem dữ liệu”.</div>}

      {data && (
        <div style={styles.wrap}>
          {/* LEFT = bảng hiệu suất ngày */}
          <div style={styles.panel}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <b>So sánh hiệu suất ngày</b>
              <span style={{ fontSize: 12, color: "#666" }}>
                Mốc cuối: <b>{data.latestMark}</b>
              </span>
            </div>

            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Chuyền</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>HS đạt</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>HS định mức</th>
                  <th style={{ ...styles.th, textAlign: "center" }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const ach = l.dayAch == null ? null : l.dayAch * 100;
                  const tar = (l.dayTarget ?? 0) * 100;

                  const st = l.dayStatus;
                  const stStyle =
                    st === "ĐẠT"
                      ? { color: "green", fontWeight: 700 }
                      : st === "KHÔNG ĐẠT"
                      ? { color: "red", fontWeight: 700 }
                      : { color: "#555" };

                  return (
                    <tr
                      key={l.line}
                      onClick={() => setSelectedLine(l.line)}
                      style={{ cursor: "pointer", background: selectedLine === l.line ? "#f9f9f9" : "transparent" }}
                    >
                      <td style={styles.td}><b>{l.line}</b></td>
                      <td style={styles.tdR}>{ach == null ? "—" : `${ach.toFixed(2)}%`}</td>
                      <td style={styles.tdR}>{`${tar.toFixed(2)}%`}</td>
                      <td style={{ ...styles.tdC, ...stStyle }}>{st}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* RIGHT = bảng lũy tiến theo giờ */}
          <div style={styles.panel}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <b>So sánh lũy tiến theo giờ (chuyền: {selectedLine || "—"})</b>
            </div>

            <div style={styles.chipRow}>
              {lines.map((l) => (
                <button
                  key={l.line}
                  onClick={() => setSelectedLine(l.line)}
                  style={{ ...styles.chip, ...(selectedLine === l.line ? styles.chipOn : {}) }}
                >
                  {l.line}
                </button>
              ))}
            </div>

            {currentLine ? (
              <>
                <div style={{ fontSize: 13, color: "#444", marginBottom: 10 }}>
                  DM/H: <b>{currentLine.dmH ? currentLine.dmH.toFixed(2) : 0}</b> • DM/NGÀY:{" "}
                  <b>{currentLine.dmDay ? currentLine.dmDay.toFixed(2) : 0}</b>
                </div>

                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Mốc</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Lũy tiến</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>DM lũy tiến</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Chênh</th>
                      <th style={{ ...styles.th, textAlign: "center" }}>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentLine.marks.map((m) => {
                      let stStyle = { color: "#666" };
                      if (m.status === "THIẾU") stStyle = { color: "red", fontWeight: 700 };
                      if (m.status === "ĐỦ") stStyle = { color: "#0b5", fontWeight: 700 };
                      if (m.status === "VƯỢT") stStyle = { color: "green", fontWeight: 700 };

                      return (
                        <tr key={m.mark}>
                          <td style={styles.td}>{m.mark}</td>
                          <td style={styles.tdR}>{m.actual == null ? "—" : m.actual}</td>
                          <td style={styles.tdR}>{m.expected ? m.expected.toFixed(0) : 0}</td>
                          <td style={styles.tdR}>{m.delta == null ? "—" : m.delta.toFixed(0)}</td>
                          <td style={{ ...styles.tdC, ...stStyle }}>{m.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ color: "#666" }}>Chưa chọn chuyền.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
