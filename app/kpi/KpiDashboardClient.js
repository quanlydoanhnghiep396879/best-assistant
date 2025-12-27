"use client";

import { useEffect, useMemo, useState } from "react";

function pct(x) {
  if (x === null || x === undefined) return "—";
  return (x * 100).toFixed(2) + "%";
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [data, setData] = useState(null);
  const [selectedLine, setSelectedLine] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");

  async function loadDates() {
    setErr("");
    const r = await fetch("/api/kpi-config", { cache: "no-store" });
    const j = await r.json();
    if (j.status !== "success") throw new Error(j.message || "kpi-config error");
    setDates(j.dates || []);
    if (!date && j.dates?.length) setDate(j.dates[j.dates.length - 1]);
  }

  async function loadData(d) {
    if (!d) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.status !== "success") throw new Error(j.message || "check-kpi error");

      setData(j);
      setLastUpdated(new Date().toLocaleString("vi-VN"));
      // auto chọn chuyền đầu tiên nếu chưa chọn
      if (!selectedLine && j.lines?.length) setSelectedLine(j.lines[0].line);
    } catch (e) {
      setErr(e.message || "Error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDates().catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!date) return;
    loadData(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    if (!auto || !date) return;
    const id = setInterval(() => loadData(date), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const lineObj = useMemo(() => {
    if (!data?.lines?.length) return null;
    return data.lines.find((x) => x.line === selectedLine) || null;
  }, [data, selectedLine]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ margin: 0 }}>KPI Dashboard</h1>
      <div style={{ marginTop: 8, marginBottom: 12, color: "#444" }}>
        Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <b>Ngày:</b>{" "}
          <select value={date} onChange={(e) => setDate(e.target.value)} disabled={!dates.length}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <button onClick={() => loadData(date)} disabled={!date || loading}>
          {loading ? "Đang tải..." : "Xem dữ liệu"}
        </button>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Tự cập nhật (1 phút)
        </label>

        <div style={{ color: "#666" }}>{lastUpdated ? `Cập nhật: ${lastUpdated}` : ""}</div>
      </div>

      {err ? <div style={{ marginTop: 10, color: "crimson" }}>Lỗi: {err}</div> : null}

      {!data?.lines?.length ? (
        <div style={{ marginTop: 16, color: "#666" }}>
          {data ? "Không parse được dòng nào. Hãy chắc RANGE có dòng tiêu đề chứa '->9h' và 'DM/H'." : ""}
        </div>
      ) : (
        <>
          {/* chọn chuyền */}
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.lines.map((x) => (
              <button
                key={x.line}
                onClick={() => setSelectedLine(x.line)}
                style={{
                  padding: "6px 10px",
                  border: "1px solid #ccc",
                  background: x.line === selectedLine ? "#111" : "#fff",
                  color: x.line === selectedLine ? "#fff" : "#111",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {x.line}
              </button>
            ))}
          </div>

          {/* 2 bảng song song */}
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
            {/* LEFT: hiệu suất ngày */}
            <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>So sánh hiệu suất ngày</div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Chuyền", "HS đạt", "HS định mức", "Trạng thái"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "6px 4px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((x) => (
                    <tr key={x.line} style={{ background: x.line === selectedLine ? "#f6f6f6" : "transparent" }}>
                      <td style={{ padding: "6px 4px" }}>{x.line}</td>
                      <td style={{ padding: "6px 4px" }}>{pct(x.hsDat)}</td>
                      <td style={{ padding: "6px 4px" }}>{pct(x.hsTarget)}</td>
                      <td style={{ padding: "6px 4px" }}>{x.hsStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* RIGHT: lũy tiến theo giờ */}
            <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                So sánh lũy tiến theo giờ (chuyền: {selectedLine || "—"})
              </div>

              {!lineObj ? (
                <div style={{ color: "#666" }}>Chưa chọn chuyền.</div>
              ) : (
                <>
                  <div style={{ marginBottom: 10, color: "#444" }}>
                    DM/H: <b>{lineObj.baseDmH?.toFixed(2)}</b>{" "}
                    <span style={{ color: "#888" }}>(nếu thiếu DM/H sẽ dùng DM/NGÀY/8)</span>
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Mốc", "Lũy tiến", "DM lũy tiến", "Chênh", "Trạng thái"].map((h) => (
                          <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "6px 4px" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(lineObj.actual).map((m) => (
                        <tr key={m}>
                          <td style={{ padding: "6px 4px" }}>{m}</td>
                          <td style={{ padding: "6px 4px" }}>{lineObj.actual[m]}</td>
                          <td style={{ padding: "6px 4px" }}>{lineObj.target[m]}</td>
                          <td style={{ padding: "6px 4px" }}>{lineObj.diff[m]}</td>
                          <td style={{ padding: "6px 4px" }}>{lineObj.status[m]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
