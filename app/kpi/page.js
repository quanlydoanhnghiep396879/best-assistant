"use client";
import { useEffect, useState } from "react";

export default function KPIPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadKPI = () => {
    fetch("/api/check-kpi", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        setAlerts(data.alerts || []);
        setLoading(false);
      })
      .catch((err) => console.error("Lỗi load KPI:", err));
  };

  useEffect(() => {
    loadKPI();
    const interval = setInterval(loadKPI, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p style={{ padding: 20 }}>⏳ Đang tải dữ liệu...</p>;

  // Nhóm dữ liệu theo giờ
  const grouped = {};
  alerts.forEach((item) => {
    if (!grouped[item.time]) grouped[item.time] = [];
    grouped[item.time].push(item);
  });

  return (
    <div style={{ padding: 30, background: "#0A192F", minHeight: "100vh", color: "white" }}>
      <h1 style={{ textAlign: "center", color: "#00E5FF", fontSize: 32 }}>
        📊 Dashboard KPI theo giờ (Tự động cập nhật)
      </h1>

      {Object.entries(grouped).map(([time, items]) => (
        <div
          key={time}
          style={{
            background: "#112240",
            padding: 20,
            borderRadius: 12,
            marginBottom: 25,
            boxShadow: "0 0 12px rgba(0,255,255,0.2)",
          }}
        >
          <h2 style={{ color: "#7B61FF", fontSize: 24 }}>🕒 Giờ: {time}</h2>

          <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1B2F4A" }}>
                <th style={th}>Công đoạn</th>
                <th style={th}>KPI</th>
                <th style={th}>Thực tế</th>
                <th style={th}>Chênh lệch</th>
                <th style={th}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={idx} style={{ background: idx % 2 ? "#0F1E33" : "#14263F" }}>
                  <td style={td}>{i.step}</td>
                  <td style={td}>{i.kpi}</td>
                  <td style={td}>{i.real}</td>
                  <td style={td}>{i.diff}</td>
                  <td
                    style={{
                      ...td,
                      fontWeight: "bold",
                      color:
                        i.status === "lack"
                          ? "#FF4F4F"
                          : i.status === "over"
                          ? "#FFD400"
                          : "#00FF9C", // màu xanh cho "Đủ"
                      textShadow:
                        i.status === "lack"
                          ? "0 0 6px #FF4F4F"
                          : i.status === "over"
                          ? "0 0 6px #FFD400"
                          : "0 0 6px #00FF9C",
                    }}
                  >
                    {i.status === "lack"
                      ? "❌ Thiếu"
                      : i.status === "over"
                      ? "⚠️ Vượt"
                      : "✅ Đủ"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
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
