"use client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { useEffect, useState } from "react";

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/check-kpi", { method: "POST" })
      .then(res => res.json())
      .then(data => {
        setAlerts(data.alerts || []);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>⏳ Đang tải dashboard...</p>;

  return (
    <div style={{ padding: 20 }}>
      <h2>📊 KPI Dashboard</h2>

      <table border="1" cellPadding="6">
        <thead>
          <tr>
            <th>Giờ</th>
            <th>Công đoạn</th>
            <th>KPI</th>
            <th>Thực tế</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a, i) => (
            <tr key={i}>
              <td>{a.time}</td>
              <td>{a.step}</td>
              <td>{a.kpi}</td>
              <td>{a.real}</td>
              <td
                style={{
                  color:
                    a.diff < 0
                      ? "#dc2626"
                      : a.diff > 0
                      ? "#f59e0b"
                      : "#16a34a",
                  fontWeight: "bold",
                }}
              >
                {a.message}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th = {
  padding: 12,
  color: "#00E5FF",
  borderBottom: "1px solid rgba(255,255,255,0.2)",
};

const td = {
  padding: 10,
  textAlign: "center",
};