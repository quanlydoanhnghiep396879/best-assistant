"use client";

import { useEffect, useMemo, useState } from "react";

function pct(x) {
  if (x == null) return "—";
  return (x * 100).toFixed(2) + "%";
}

function isGreenStatus(s) {
  const up = String(s || "").toUpperCase();
  return ["VƯỢT","ĐỦ","ĐẠT"].some(k => up.includes(k));
}
function isRedStatus(s) {
  const up = String(s || "").toUpperCase();
  return ["THIẾU","CHƯA ĐẠT","KHÔNG ĐẠT","CHƯA CÓ"].some(k => up.includes(k));
}

function StatusPill({ value }) {
  const v = value || "—";
  const style = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #ccc",
    fontSize: 12,
    fontWeight: 700,
    background: "#f3f4f6",
    color: "#374151",
  };

  if (isGreenStatus(v)) {
    style.background = "#dcfce7";
    style.border = "1px solid #86efac";
    style.color = "#166534";
  } else if (isRedStatus(v)) {
    style.background = "#fee2e2";
    style.border = "1px solid #fca5a5";
    style.color = "#991b1b";
  }

  return <span style={style}>{v}</span>;
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [auto, setAuto] = useState(true);

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [selectedLine, setSelectedLine] = useState("");

  async function loadConfig() {
    const r = await fetch("/api/kpi-config", { cache: "no-store" });
    const j = await r.json();
    if (j.status !== "success") throw new Error(j.message || "Config error");
    setDates(j.dates || []);
    setSelectedDate((prev) => prev || (j.dates?.[j.dates.length - 1] || ""));
  }

  async function loadData(d) {
    if (!d) return;
    setErr("");
    const r = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, { cache: "no-store" });
    const j = await r.json();
    if (j.status !== "success") throw new Error(j.message || "Load data error");
    setData(j);

    const firstLine = j.lines?.[0]?.line || "";
    setSelectedLine((prev) => prev || firstLine);
  }

  useEffect(() => {
    loadConfig().catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!auto) return;
    if (!selectedDate) return;

    const t = setInterval(() => {
      loadData(selectedDate).catch((e) => setErr(String(e.message || e)));
    }, 60_000);

    return () => clearInterval(t);
  }, [auto, selectedDate]);

  const lines = data?.lines || [];
  const filteredLines = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return lines;
    return lines.filter((x) => String(x.line).toUpperCase().includes(s));
  }, [lines, q]);

  const current = useMemo(() => {
    return lines.find((x) => x.line === selectedLine) || null;
  }, [lines, selectedLine]);

  const marks = data?.marks || [];

  const hourlyRows = useMemo(() => {
    if (!current) return [];
    const dmHour = Number.isFinite(current.dmHour) ? current.dmHour : null;

    return marks.map((m, idx) => {
      const actual = current.hourly?.[m];
      const dmCum = Number.isFinite(dmHour) ? dmHour * (idx + 1) : null;

      let status = "N/A";
      let diff = null;

      if (Number.isFinite(dmCum) && dmCum > 0 && Number.isFinite(actual)) {
        diff = actual - dmCum;
        if (diff === 0) status = "ĐỦ";
        else if (diff > 0) status = "VƯỢT";
        else status = "THIẾU";
      }

      return { mark: m, actual, dmCum, diff, status };
    });
  }, [current, marks]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 44, fontWeight: 900, marginBottom: 6 }}>KPI Dashboard</h1>
      <div style={{ color: "#374151", marginBottom: 16 }}>
        Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>Ngày:</div>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px" }}
        >
          <option value="">—</option>
          {dates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        <button
          onClick={() => loadData(selectedDate).catch((e) => setErr(String(e.message || e)))}
          disabled={!selectedDate}
          style={{
            border: "1px solid #111827",
            borderRadius: 8,
            padding: "6px 12px",
            fontWeight: 800,
            cursor: selectedDate ? "pointer" : "not-allowed",
          }}
        >
          Xem dữ liệu
        </button>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Tự cập nhật (1 phút)</span>
        </label>

        {data?.updatedAt && (
          <div style={{ color: "#6b7280" }}>
            Cập nhật: {new Date(data.updatedAt).toLocaleTimeString("vi-VN")} {new Date(data.updatedAt).toLocaleDateString("vi-VN")}
          </div>
        )}
      </div>

      {err && <div style={{ color: "#dc2626", fontWeight: 900, marginBottom: 12 }}>Lỗi: {err}</div>}

      {/* GRID 2 CỘT (CSS CỨNG) */}
      <div className="kpiGrid">
        {/* LEFT */}
        <div className="card">
          <div className="cardHeader">
            <div className="cardTitle">So sánh hiệu suất ngày</div>
            <div className="muted">Mốc cuối: -&gt;16h30</div>
          </div>

          <div className="tableWrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>HS đạt</th>
                  <th>HS định mức</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((x) => (
                  <tr
                    key={x.line}
                    onClick={() => setSelectedLine(x.line)}
                    className={x.line === selectedLine ? "rowActive" : ""}
                  >
                    <td style={{ fontWeight: 800 }}>{x.line}</td>
                    <td>{pct(x.hsDay)}</td>
                    <td>{pct(x.hsTarget)}</td>
                    <td><StatusPill value={x.hsStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT */}
        <div className="card">
          <div className="cardHeader" style={{ marginBottom: 10 }}>
            <div className="cardTitle">So sánh lũy tiến theo giờ (chuyền: {selectedLine || "—"})</div>
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm chuyền..."
            style={{ width: 240, border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}
          />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {filteredLines.map((x) => (
              <button
                key={x.line}
                onClick={() => setSelectedLine(x.line)}
                style={{
                  border: "1px solid #d1d5db",
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontWeight: 800,
                  background: x.line === selectedLine ? "#111827" : "white",
                  color: x.line === selectedLine ? "white" : "#111827",
                }}
              >
                {x.line}
              </button>
            ))}
          </div>

          <div style={{ fontWeight: 800, marginBottom: 12 }}>
            DM/H: {Number.isFinite(current?.dmHour) ? current.dmHour.toFixed(2) : "—"} &nbsp; • &nbsp;
            DM/NGÀY: {Number.isFinite(current?.dmDay) ? current.dmDay : "—"}
          </div>

          <div className="tableWrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mốc</th>
                  <th>Lũy tiến</th>
                  <th>DM lũy tiến</th>
                  <th>Chênh</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {hourlyRows.map((r) => (
                  <tr key={r.mark}>
                    <td>{r.mark}</td>
                    <td>{Number.isFinite(r.actual) ? r.actual : "—"}</td>
                    <td>{Number.isFinite(r.dmCum) ? Math.round(r.dmCum) : "—"}</td>
                    <td>{Number.isFinite(r.diff) ? (r.diff > 0 ? `+${Math.round(r.diff)}` : `${Math.round(r.diff)}`) : "—"}</td>
                    <td><StatusPill value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Debug parse: DM/NGÀY col={data?.parsed?.colDmDay}, ĐM/H col={data?.parsed?.colDmHour}
          </div>
        </div>
      </div>

      <style jsx>{`
        .kpiGrid{
          display:grid;
          grid-template-columns: 1.35fr 1fr;
          gap: 20px;
          align-items:start;
        }
        @media (max-width: 1024px){
          .kpiGrid{ grid-template-columns: 1fr; }
        }
        .card{
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 14px;
          background: white;
        }
        .cardHeader{
          display:flex;
          align-items:center;
          justify-content:space-between;
          margin-bottom: 10px;
        }
        .cardTitle{ font-size: 20px; font-weight: 900; }
        .muted{ color:#6b7280; font-weight:600; }
        .tableWrap{ overflow:auto; }
        .tbl{ width:100%; border-collapse: collapse; font-size: 14px; }
        .tbl th{ text-align:left; padding: 10px 8px; border-bottom: 1px solid #e5e7eb; }
        .tbl td{ padding: 10px 8px; border-bottom: 1px solid #f3f4f6; }
        .tbl tr:hover{ background:#f9fafb; cursor:pointer; }
        .rowActive{ background:#f3f4f6; }
      `}</style>
    </div>
  );
}
