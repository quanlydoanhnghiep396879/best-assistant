"use client";

import { useEffect, useState } from "react";

export default function KpiDashboard() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  // Lấy danh sách ngày
  useEffect(() => {
    async function loadDates() {
      try {
        const res = await fetch("/api/check-kpi");
        const json = await res.json();
        if (json.status !== "success") {
          throw new Error(json.message);
        }
        setDates(json.dates || []);
        if (json.dates && json.dates.length > 0) {
          setSelectedDate(json.dates[0]);
        }
        setError("");
      } catch (e) {
        setError(e.message);
      }
    }
    loadDates();
  }, []);

  // Khi chọn ngày -> load KPI
  useEffect(() => {
    if (!selectedDate) return;
    async function loadKpi() {
      try {
        const res = await fetch(
          `/api/check-kpi?date=${encodeURIComponent(selectedDate)}`
        );
        const json = await res.json();
        if (json.status !== "success") {
          throw new Error(json.message);
        }
        setData(json);
        setError("");
      } catch (e) {
        setError(e.message);
        setData(null);
      }
    }
    loadKpi();
  }, [selectedDate]);

  return (
    <main style={{ padding: 24 }}>
      <h1>📊 KPI Dashboard</h1>

      <div style={{ marginBottom: 16 }}>
        <span>Ngày:&nbsp;</span>
        {dates.length > 0 ? (
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        ) : (
          <b>Không có ngày nào trong CONFIG_KPI</b>
        )}
      </div>

      {error && (
        <p style={{ color: "red" }}>Lỗi: {error}</p>
      )}

      {data && (
        <details>
          <summary>Xem toàn bộ JSON</summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </main>
  );
}
