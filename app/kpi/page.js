"use client";
import { useEffect, useState } from "react";

export default function KPIPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);   // ← THÊM DÒNG NÀY
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/check-kpi")
      .then((res) => res.json())
      .then((data) => {
        const parsed = convertAlertsToTable(data.alerts || []);
        setRows(parsed);
        setSummary(data.dailySummary || {});     // ← THÊM DÒNG NÀY
        setLoading(false);
      })
      .catch((err) => {
        console.error("Fetch KPI error:", err);
        setLoading(false);
      });
  }, []);

  if (loading)
    return <p style={{ padding: 20 }}>⏳ Đang tải dữ liệu...</p>;

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center" }}>📊 Tổng quan KPI theo giờ</h1>

      {/* ======================= TỔNG HỢP KPI NGÀY ======================= */}
      {summary && (
        <div
          style={{
            padding: 20,
            borderRadius: 15,
            marginBottom: 20,
            background: "linear-gradient(to bottom right,#fff8d1,#ffeaa7)",
            boxShadow: "0 4px 10px rgba(0,0,0,0.15)"
          }}
        >
          <h2>📌 TỔNG HỢP KPI NGÀY</h2>

          {Object.entries(summary).map(([step, data]) => (
            <div
              key={step}
              style={{
                padding: "10px 12px",
                margin: "6px 0",
                borderRadius: 8,
                background:
                  data.status === "lack"
                    ? "#ffe5e5"
                    : data.status === "over"
                    ? "#fff6d6"
                    : "#e8ffe8",
                border:
                  data.status === "lack"
                    ? "1px solid #ff4d4d"
                    : data.status === "over"
                    ? "1px solid #e6b800"
                    : "1px solid #28a745",
              }}
            >
              <strong>{step}</strong> — KPI: {data.kpi}, Thực tế: {data.real},
              Chênh lệch: {data.diff}
            </div>
          ))}
        </div>
      )}

      {/* ======================= KPI THEO GIỜ ======================= */}
      {rows.map((row, idx) => (
        <div
          key={idx}
          style={{
            marginBottom: 25,
            padding: 20,
            borderRadius: 15,
            background: "linear-gradient(to bottom right, #ffffff, #f0f4ff)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          <h2>⏰ {row.time}</h2>

          {Object.entries(row.data).map(([step, result], i2) => (
            <div
              key={i2}
              style={{
                padding: "10px 14px",
                margin: "8px 0",
                borderRadius: 10,
                background:
                  result.type === "lack"
                    ? "#ffe5e5"
                    : result.type === "over"
                    ? "#fff6d6"
                    : "#e8ffe8",
                border:
                  result.type === "lack"
                    ? "1px solid #ff4d4d"
                    : result.type === "over"
                    ? "1px solid #e6b800"
                    : "1px solid #28a745",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <b>{step}</b>
              <span>{result.message}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------- CHUYỂN ALERT → DỮ LIỆU THEO GIỜ -------------------- */
function convertAlertsToTable(alerts) {
  const stepNames = ["Giờ", "Cắt", "In/Thêu", "May 1", "May 2", "Đính nút", "Đóng gói"];

  const rowsMap = {
    "2": { time: "08:00", data: {} },
    "3": { time: "09:00", data: {} },
    "4": { time: "10:00", data: {} },
    "5": { time: "11:00", data: {} },
    "6": { time: "12:00", data: {} },
  };

  const regex = /dòng (\d+), cột (\d+): (.*)/;

  alerts.forEach((alert) => {
    const m = alert.match(regex);
    if (!m) return;

    const row = m[1];
    const col = m[2];
    const message = m[3];

    if (!rowsMap[row]) return;

    const step = stepNames[col];
    const lower = message.toLowerCase();

    rowsMap[row].data[step] = {
      message,
      type: lower.includes("thiếu")
        ? "lack"
        : lower.includes("vượt")
        ? "over"
        : "equal",
    };
  });

  return Object.values(rowsMap);
}