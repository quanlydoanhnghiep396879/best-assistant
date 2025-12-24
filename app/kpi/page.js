"use client";

import { useEffect, useState, useMemo } from "react";

export default function KpiDashboardPage() {
  const [hourAlerts, setHourAlerts] = useState([]);
  const [dayAlerts, setDayAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState(null); // debug
  const [selectedChuyen, setSelectedChuyen] = useState("ALL");

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      try {
        if (!isMounted) return;
        setError(null);

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

    fetchData();
    const id = setInterval(fetchData, 5000); // refresh 5s

    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, []);

  // ====== LẤY DANH SÁCH CHUYỀN (UNIQUES) ======
  const chuyenOptions = useMemo(() => {
    const set = new Set();
    hourAlerts.forEach((a) => {
      if (a.chuyen) set.add(a.chuyen);
    });
    dayAlerts.forEach((a) => {
      if (a.chuyen) set.add(a.chuyen);
    });
    return ["ALL", ...Array.from(set)];
  }, [hourAlerts, dayAlerts]);

  // ====== FILTER THEO CHUYỀN ======
  const filteredHourAlerts =
    selectedChuyen === "ALL"
      ? hourAlerts
      : hourAlerts.filter((a) => a.chuyen === selectedChuyen);

  const filteredDayAlerts =
    selectedChuyen === "ALL"
      ? dayAlerts
      : dayAlerts.filter((a) => a.chuyen === selectedChuyen);

  return (
    <main style={{ padding: "20px" }}>
      <h1>📊 KPI Dashboard</h1>

      {/* CHỌN CHUYỀN */}
      <div style={{ margin: "10px 0 20px 0" }}>
        <label>
          <strong>Chọn chuyền:&nbsp;</strong>
          <select
            value={selectedChuyen}
            onChange={(e) => setSelectedChuyen(e.target.value)}
          >
            {chuyenOptions.map((name) => (
              <option key={name} value={name}>
                {name === "ALL" ? "Tất cả chuyền" : name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Đang tải dữ liệu...</p>}
      {error && <p style={{ color: "red" }}>Lỗi: {error}</p>}

      {/* BẢNG THEO GIỜ */}
      <h2>Kiểm soát theo giờ (lũy tiến)</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Chuyền</th>
            <th>Giờ</th>
            <th>Kế hoạch lũy tiến</th>
            <th>Thực tế</th>
            <th>Chênh lệch</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {filteredHourAlerts.map((a, idx) => (
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
          {filteredHourAlerts.length === 0 && !loading && !error && (
            <tr>
              <td colSpan={6}>Không có dữ liệu cho chuyền đã chọn.</td>
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
          {filteredDayAlerts.map((a, idx) => (
            <tr key={idx}>
              <td>{a.chuyen}</td>
              <td>{a.effDay.toFixed(2)}</td>
              <td>{a.targetEffDay.toFixed(2)}</td>
              <td>{a.status === "day_ok" ? "✅ Đạt" : "❌ Không đạt"}</td>
            </tr>
          ))}
          {filteredDayAlerts.length === 0 && !loading && !error && (
            <tr>
              <td colSpan={4}>Không có dữ liệu cho chuyền đã chọn.</td>
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