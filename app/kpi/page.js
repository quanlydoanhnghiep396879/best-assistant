"use client";

import { useEffect, useState } from "react";

export default function KpiTestPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("2025-12-24");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/check-kpi?date=${date}`, {
          method: "GET", // vì route giờ GET cũng trả dữ liệu
        });
        const json = await res.json();
        if (!res.ok || json.status !== "success") {
          throw new Error(json.message || "API error");
        }
        if (!cancelled) {
          setData(json);
        }
      } catch (e) {
        console.error("KPI PAGE ERROR:", e);
        if (!cancelled) {
          setError(String(e.message || e));
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <main style={{ padding: 20 }}>
      <h1>📊 KPI Dashboard (test)</h1>

      <div style={{ marginBottom: 10 }}>
        <label>
          <b>Ngày: </b>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
          >
            <option value="2025-12-23">23/12/2025</option>
            <option value="2025-12-24">24/12/2025</option>
          </select>
        </label>
      </div>

      {loading && <p>Đang tải dữ liệu...</p>}
      {error && <p style={{ color: "red" }}>Lỗi: {error}</p>}

      {!loading && !error && data && (
        <>
          <p>
            Trạng thái API: <b>{data.status}</b> – Ngày:{" "}
            <b>{data.date}</b>
          </p>
          <p>
            Số dòng hourAlerts:{" "}
            <b>{data.hourAlerts?.length || 0}</b> – Số dòng dayAlerts:{" "}
            <b>{data.dayAlerts?.length || 0}</b>
          </p>

          <details>
            <summary>Xem toàn bộ JSON</summary>
            <pre style={{ fontSize: 11 }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </>
      )}
    </main>
  );
}
