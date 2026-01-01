"use client";

import { useEffect, useMemo, useState } from "react";

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [loadingDates, setLoadingDates] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [error, setError] = useState("");
  const [daily, setDaily] = useState([]);

  // load dates list
  useEffect(() => {
    let alive = true;
    setLoadingDates(true);
    setError("");

    fetch("/api/kpi-config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j?.ok) throw new Error(j?.message || j?.error || "Load dates failed");
        const list = Array.isArray(j.dates) ? j.dates : [];
        setDates(list);

        // default chọn ngày mới nhất (list đã sort mới nhất trước)
        if (!date && list.length) setDate(list[0]);
      })
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoadingDates(false));

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load data by date
  useEffect(() => {
    if (!date) return;

    let alive = true;
    setLoadingData(true);
    setError("");

    fetch(`/api/check-kpi?date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j?.ok) throw new Error(j?.message || j?.error || "Load KPI failed");
        setDaily(Array.isArray(j.daily) ? j.daily : []);
      })
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoadingData(false));

    return () => {
      alive = false;
    };
  }, [date]);

  const summary = useMemo(() => {
    const ok = daily.filter((x) => x.status === "ĐẠT").length;
    const bad = daily.filter((x) => x.status !== "ĐẠT").length;
    return { ok, bad, total: daily.length };
  }, [daily]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, Arial" }}>
      <h2 style={{ margin: "0 0 12px 0" }}>KPI Dashboard</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Chọn ngày</div>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={loadingDates || !dates.length}
            style={{ padding: 8, minWidth: 180 }}
          >
            {dates.length === 0 ? (
              <option value="">{loadingDates ? "Đang tải..." : "Không có ngày"}</option>
            ) : (
              dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            )}
          </select>
        </div>

        <div style={{ fontSize: 13, opacity: 0.85 }}>
          {loadingData ? "Đang tải dữ liệu..." : `Tổng: ${summary.total} | Đạt: ${summary.ok} | Không đạt: ${summary.bad}`}
        </div>
      </div>

      {error ? (
        <div style={{ padding: 12, background: "#ffecec", border: "1px solid #ffb3b3", marginBottom: 12 }}>
          <b>Lỗi:</b> {error}
        </div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Chuyền</th>
              <th style={th}>MH</th>
              <th style={th}>HS đạt</th>
              <th style={th}>HS định mức</th>
              <th style={th}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {daily.length === 0 ? (
              <tr>
                <td style={td} colSpan={5}>
                  {loadingData ? "Đang tải..." : "Không có dữ liệu"}
                </td>
              </tr>
            ) : (
              daily.map((r, i) => (
                <tr key={i}>
                  <td style={td}>{r.line}</td>
                  <td style={td}>{r.mh || ""}</td>
                  <td style={td}>{Number(r.hs_dat || 0).toFixed(2)}%</td>
                  <td style={td}>{Number(r.hs_dm || 0).toFixed(2)}%</td>
                  <td style={td}>
                    <b>{r.status}</b>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = {
  border: "1px solid #ddd",
  padding: 8,
  textAlign: "left",
  background: "#f6f6f6",
  whiteSpace: "nowrap",
};

const td = {
  border: "1px solid #ddd",
  padding: 8,
  whiteSpace: "nowrap",
};
