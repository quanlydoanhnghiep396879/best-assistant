"use client";

import { useEffect, useState } from "react";

const DATE_OPTIONS = ["23/12/2025", "24/12/2025"]; // tạm thời fix cứng

export default function KpiDashboardTest() {
  const [date, setDate] = useState(DATE_OPTIONS[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(date)}`);
      const json = await res.json();
      setData(json);
      if (json.status !== "success") {
        setError(json.message || "API trả về lỗi");
      }
    } catch (e) {
      console.error(e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [date]);

  const rawValues = data?.rawValues || [];

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>📊 KPI Dashboard (test)</h1>

      <div style={{ marginBottom: 16 }}>
        <label>
          Ngày:{" "}
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: 4 }}
          >
            {DATE_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Đang tải dữ liệu...</p>}
      {error && <p style={{ color: "red" }}>Lỗi: {error}</p>}

      {data && (
        <>
          <p>
            Trạng thái API: <strong>{data.status}</strong> – Ngày:{" "}
            <strong>{data.date}</strong>
          </p>
          <p>
            Range đang đọc:{" "}
            <code>{data.range || "(không tìm thấy trong DATE_RANGE)"}</code>
          </p>

          <h2 style={{ marginTop: 24 }}>Bảng dữ liệu thô từ Google Sheet</h2>

          {rawValues.length === 0 ? (
            <p>Không có dữ liệu trong range này.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                border="1"
                cellPadding="4"
                style={{ borderCollapse: "collapse", minWidth: 600 }}
              >
                <tbody>
                  {rawValues.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details style={{ marginTop: 24 }}>
            <summary>Xem toàn bộ JSON</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </>
      )}
    </main>
  );
}
