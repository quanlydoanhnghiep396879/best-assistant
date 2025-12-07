"use client";
import { useEffect, useState } from "react";

export default function KPIPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/check-kpi")
      .then((res) => res.json())
      .then((data) => {
        const parsed = convertAlertsToTable(data.alerts || []);
        setRows(parsed);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Fetch KPI error:", err);
        setLoading(false);
      });
  }, []);

  if (loading)
    return (
      <p style={{ padding: 20, textAlign: "center", color: "#fff" }}>
        ⏳ Đang tải dữ liệu...
      </p>
    );

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 900,
        margin: "0 auto",
        background: "#0d1117",
        minHeight: "100vh",
        color: "#e6edf3",
      }}
    >
      <h1 style={{ textAlign: "center", fontSize: 32, marginBottom: 30 }}>
        📊 Dashboard KPI Nhà Máy
      </h1>

      {/* ======================= KPI THEO GIỜ ======================= */}
      {rows.map((row, idx) => (
        <div
          key={idx}
          style={{
            marginBottom: 25,
            padding: 20,
            borderRadius: 12,
            background: "#161b22",
            boxShadow: "0 0 12px rgba(0,0,0,0.45)",
            border: "1px solid #30363d",
          }}
        >
          <h2 style={{ marginBottom: 12, fontSize: 22 }}>
            ⏰ {row.time}
          </h2>

          {Object.entries(row.data).map(([step, result], i2) => (
            <div
              key={i2}
              style={{
                padding: "12px 16px",
                margin: "10px 0",
                borderRadius: 8,
                background:
                  result.type === "lack"
                    ? "rgba(255, 75, 75, 0.15)"
                    : result.type === "over"
                    ? "rgba(255, 200, 0, 0.15)"
                    : "rgba(0, 200, 100, 0.15)",
                border:
                  result.type === "lack"
                    ? "1px solid #ff4d4d"
                    : result.type === "over"
                    ? "1px solid #e6c200"
                    : "1px solid #28a745",
                display: "flex",
                justifyContent: "space-between",
                color:
                  result.type === "lack"
                    ? "#ff7b7b"
                    : result.type === "over"
                    ? "#f2d46f"
                    : "#7ee787",
                fontSize: 17,
              }}
            >
              <b>{step}</b>
              <span>
                {icon(result.type)} {result.message}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------- ICON HIỂN THỊ -------------------- */
function icon(type) {
  if (type === "lack") return "🔻"; // Thiếu
  if (type === "over") return "⚠️"; // Vượt
  return "✔️"; // Đủ
}

/* -------------------- CHUYỂN ALERT → DỮ LIỆU THEO GIỜ -------------------- */
function convertAlertsToTable(alerts) {
  const stepNames = ["Giờ", "Cắt", "In/Thêu", "May 1", "May 2", "Đính nút", "Đóng gói"];

  const rowsMap = {
    "09:00": { time: "09:00", data: {} },
    "10:00": { time: "10:00", data: {} },
    "11:00": { time: "11:00", data: {} },
    "12:00": { time: "12:00", data: {} },
  };

  const regex = /Giờ (\d\d:\d\d) – ([^:]+): KPI (\d+), Thực tế (\d+), Chênh lệch ([\-0-9]+)/;

  alerts.forEach((alert) => {
    const m = alert.match(regex);
    if (!m) return;

    const [, time, step, kpi, real, diff] = m;

    const type =
      diff < 0 ? "lack" : diff > 0 ? "over" : "equal";

    rowsMap[time].data[step] = {
      message: `Chênh lệch ${diff}`,
      type,
    };
  });

  return Object.values(rowsMap);
}
