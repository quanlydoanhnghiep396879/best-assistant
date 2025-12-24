"use client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { useEffect, useState } from "react";

export default function KpiDashboardPage() {
  const [hourAlerts, setHourAlerts] = useState([]);
  const [dayAlerts, setDayAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState(null); // debug

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      try {
        if (!isMounted) return;
        setError(null);

        // GỌI API CHECK-KPI
        const res = await fetch("/api/check-kpi", { method: "POST" });
        const json = await res.json();
        setRaw(json);

        if (!res.ok || json.status !== "success") {
          throw new Error(json.message || "API error");
        }

        if (!isMounted) return;
        setHourAlerts(json.hourAlerts || []);
        setDayAlerts(json.dayAlerts || []);
        setLoading(false);
      } catch (e) {
        console.error("KPI PAGE ERROR:", e);
        if (!isMounted) return;
        setError(e.message || "Unknown error");
        setLoading(false);
      }
    }

    fetchData(); // gọi lần đầu
    const id = setInterval(fetchData, 5000); // auto refresh mỗi 5s

    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, []);

  if (loading) return <p>⏳ Đang tải dashboard...</p>;

  return (
    <main style={{ padding: "20px" }}>
      <h1>📊 KPI Dashboard</h1>

      {loading && <p>Đang tải dữ liệu...</p>}
      {error && <p style={{ color: "red" }}>Lỗi: {error}</p>}

      {/* BẢNG THEO GIỜ */}
      <h2>Kiểm soát theo giờ (lũy tiến)</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Giờ</th>
            <th>Chuyền</th>
            <th>Kế hoạch lũy tiến</th>
            <th>Thực tế</th>
            <th>Chênh lệch</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {hourAlerts.map((a, idx) => (
            <tr key={idx}>
              <td>{a.hour}</td>
              <td>{a.chuyen}</td>
              <td>{a.target}</td>
              <td>{a.actual}</td>
              <td>{a.diff}</td>
              <td>
                {a.status === "equal" && "✅ Đủ"}
                {a.status === "over" && "⚠️ Vượt"}
                {a.status === "lack" && "❌ Thiếu"}
              </td>
            </tr>
          ))}
          {hourAlerts.length === 0 && !loading && !error && (
            <tr>
              <td colSpan={6}>Chưa có dữ liệu hourAlerts từ API.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* BẢNG HIỆU SUẤT NGÀY */}
      <h2 style={{ marginTop: 30 }}>Hiệu suất trong ngày</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Chuyền</th>
            <th>Hiệu suất ngày (%)</th>
            <th>Định mức ngày (%)</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {dayAlerts.map((a, idx) => (
            <tr key={idx}>
              <td>{a.chuyen}</td>
              <td>{a.effDay.toFixed(2)}</td>
              <td>{a.targetEffDay.toFixed(2)}</td>
              <td>{a.status === "day_ok" ? "✅ Đạt" : "❌ Không đạt"}</td>
            </tr>
          ))}
          {dayAlerts.length === 0 && !loading && !error && (
            <tr>
              <td colSpan={4}>Chưa có dữ liệu dayAlerts từ API.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* DEBUG JSON */}
      {raw && (
        <details style={{ marginTop: 20 }}>
          <summary>Debug JSON từ /api/check-kpi</summary>
          <pre style={{ fontSize: 11 }}>{JSON.stringify(raw, null, 2)}</pre>
        </details>
      )}
    </main>
  );
}