"use client";
import { useEffect, useState } from "react";

export default function KPIPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/check-kpi")
      .then((res) => res.json())
      .then((data) => {
        setRows(convertAlertsToHours(data.alerts || []));
        setSummary(data.dailySummary || {});
        setLoading(false);
      })
      .catch((err) => {
        console.error("Fetch KPI error:", err);
        setLoading(false);
      });
  }, []);

  if (loading)
    return (
      <p style={{ padding: 20, fontSize: 18 }}>⏳ Đang tải dữ liệu KPI...</p>
    );

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center", fontSize: 32, marginBottom: 20 }}>
        📊 <b>Dashboard KPI Nhà Máy</b>
      </h1>

      {/* ================== TỔNG HỢP KPI NGÀY ================== */}
      <SummarySection summary={summary} />

      {/* ================== KPI THEO GIỜ ================== */}
      {rows.map((row, idx) => (
        <HourCard key={idx} row={row} />
      ))}
    </div>
  );
}

function SummarySection({ summary }) {
  return (
    <div
      style={{
        background: "linear-gradient(to right, #fff3b0, #ffe8a0)",
        padding: 20,
        borderRadius: 15,
        marginBottom: 30,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
      }}
    >
      <h2>📌 TỔNG HỢP KPI NGÀY</h2>

      {Object.entries(summary).map(([step, data]) => (
        <SummaryItem key={step} step={step} data={data} />
      ))}
    </div>
  );
}

function SummaryItem({ step, data }) {
  const icon =
    data.status === "lack" ? "🔻" : data.status === "over" ? "⚠️" : "✅";

  const bg =
    data.status === "lack"
      ? "#ffe5e5"
      : data.status === "over"
      ? "#fff6d6"
      : "#e8ffe8";

  const border =
    data.status === "lack"
      ? "1px solid #ff4d4d"
      : data.status === "over"
      ? "1px solid #e6b800"
      : "1px solid #28a745";

  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 14px",
        borderRadius: 10,
        background: bg,
        border: border,
        display: "flex",
        justifyContent: "space-between",
        fontSize: 16,
      }}
    >
      <b>
        {icon} {step}
      </b>

      <span>
        KPI: <b>{data.kpi}</b> — Thực tế: <b>{data.real}</b> — Chênh lệch:{" "}
        <b>{data.diff}</b>
      </span>
    </div>
  );
}

function HourCard({ row }) {
  return (
    <div
      style={{
        marginBottom: 25,
        padding: 20,
        borderRadius: 15,
        background: "linear-gradient(to right, #f8fbff, #eef3ff)",
        boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
      }}
    >
      <h2>⏰ {row.time}</h2>

      {Object.entries(row.data).map(([step, d], id2) => (
        <HourItem key={id2} step={step} data={d} />
      ))}
    </div>
  );
}

function HourItem({ step, data }) {
  const icon =
    data.type === "lack" ? "🔻" : data.type === "over" ? "⚠️" : "✅";

  const bg =
    data.type === "lack"
      ? "#ffe5e5"
      : data.type === "over"
      ? "#fff6d6"
      : "#e8ffe8";

  const border =
    data.type === "lack"
      ? "1px solid #ff4d4d"
      : data.type === "over"
      ? "1px solid #e6b800"
      : "1px solid #28a745";

  return (
    <div
      style={{
        padding: 12,
        margin: "6px 0",
        borderRadius: 10,
        background: bg,
        border,
        display: "flex",
        justifyContent: "space-between",
        fontSize: 16,
      }}
    >
      <b>
        {icon} {step}
      </b>
      <span>{data.message}</span>
    </div>
  );
}

/* ======================== ALERT → KPI GIỜ ======================== */
function convertAlertsToHours(alerts) {
  const stepNames = ["Giờ", "Cắt", "In/Thêu", "May 1", "May 2", "Đính nút", "Đóng gói"];

  const rows = {
    "2": { time: "08:00", data: {} },
    "3": { time: "09:00", data: {} },
    "4": { time: "10:00", data: {} },
    "5": { time: "11:00", data: {} },
    "6": { time: "12:00", data: {} },
  };

  const regex = /dòng (\d+), cột (\d+): (.*)/;

  alerts.forEach((alert) => {
    const match = alert.match(regex);
    if (!match) return;

    const [_, row, col, msg] = match;
    const step = stepNames[col];

    let type = "equal";
    if (msg.includes("thiếu")) type = "lack";
    if (msg.includes("vượt")) type = "over";

    rows[row].data[step] = {
      message: msg,
      type,
    };
  });

  return Object.values(rows);
}
