// app/kpi/page.js
"use client";

import { useEffect, useState } from "react";

export default function KpiPage() {
  const [dates, setDates] = useState([]);          // list ngày lấy từ CONFIG_KPI
  const [selectedDate, setSelectedDate] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingKpi, setLoadingKpi] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [showJson, setShowJson] = useState(false);

  // 1) load danh sách ngày từ /api/kpi-config
  useEffect(() => {
    async function loadConfig() {
      try {
        setLoadingConfig(true);
        setError("");
        setData(null);

        const res = await fetch("/api/kpi-config", { cache: "no-store" });
        const json = await res.json();

        if (!res.ok || json.status !== "success") {
          throw new Error(json.message || "Lỗi API kpi-config");
        }

        const list = json.dates || [];
        setDates(list);

        if (list.length > 0) {
          setSelectedDate(list[0]); // mặc định chọn ngày đầu tiên
        }
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoadingConfig(false);
      }
    }

    loadConfig();
  }, []);

  // 2) mỗi khi selectedDate thay đổi thì gọi /api/check-kpi
  useEffect(() => {
    if (!selectedDate) return;

    async function loadKpi() {
      try {
        setLoadingKpi(true);
        setError("");
        setData(null);

        const res = await fetch(
          `/api/check-kpi?date=${encodeURIComponent(selectedDate)}`,
          { cache: "no-store" }
        );
        const json = await res.json();

        if (!res.ok || json.status !== "success") {
          throw new Error(json.message || "Lỗi API check-kpi");
        }

        setData(json);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setLoadingKpi(false);
      }
    }

    loadKpi();
  }, [selectedDate]);

  const hourAlerts = data?.hourAlerts || [];
  const dayAlerts = data?.dayAlerts || [];

  const isLoading = loadingConfig || loadingKpi;

  return (
    <main style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "16px" }}>
        📊 KPI Dashboard
      </h1>

      {/* Chọn ngày */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ marginRight: "8px", fontWeight: 600 }}>Ngày:</label>
        {loadingConfig ? (
          <span>Đang tải danh sách ngày...</span>
        ) : dates.length === 0 ? (
          <span style={{ color: "red" }}>
            Không có ngày nào trong CONFIG_KPI
          </span>
        ) : (
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
        )}
      </div>

      {/* Trạng thái / lỗi */}
      {isLoading && <p>Đang tải dữ liệu...</p>}
      {error && <p style={{ color: "red" }}>Lỗi: {error}</p>}

      {/* Nội dung KPI */}
      {!isLoading && !error && data && (
        <>
          <p style={{ marginBottom: "8px" }}>
            Trạng thái API:{" "}
            <span style={{ color: "green", fontWeight: 600 }}>
              {data.status}
            </span>{" "}
            – Ngày: <b>{data.date}</b> – Range:{" "}
            <code>{data.range || "(không có)"}</code>
          </p>
          <p style={{ marginBottom: "16px" }}>
            Số dòng hourAlerts: <b>{hourAlerts.length}</b> – Số dòng dayAlerts:{" "}
            <b>{dayAlerts.length}</b>
          </p>

          {/* Tổng kết ngày */}
          {dayAlerts.length > 0 && (
            <section style={{ marginBottom: "24px" }}>
              <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>
                Tổng kết trong ngày
              </h2>
              <table
                border="1"
                cellPadding="6"
                style={{
                  borderCollapse: "collapse",
                  minWidth: "420px",
                  background: "#fff",
                }}
              >
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Kế hoạch</th>
                    <th>Thực tế</th>
                    <th>Chênh lệch</th>
                    <th>Trạng thái</th>
                    <th>Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {dayAlerts.map((d, i) => (
                    <tr key={i}>
                      <td>{d.date}</td>
                      <td>{d.target}</td>
                      <td>{d.actual}</td>
                      <td>{d.diff}</td>
                      <td>{d.status}</td>
                      <td>{d.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Bảng theo giờ */}
          <section>
            <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>
              Kiểm soát theo giờ (lũy tiến)
            </h2>

            {hourAlerts.length === 0 ? (
              <p>Không có dữ liệu hourAlerts.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  border="1"
                  cellPadding="6"
                  style={{
                    borderCollapse: "collapse",
                    minWidth: "720px",
                    background: "#fff",
                  }}
                >
                  <thead>
                    <tr>
                      <th>Giờ</th>
                      <th>Chuyền</th>
                      <th>Kế hoạch lũy tiến</th>
                      <th>Thực tế</th>
                      <th>Chênh lệch</th>
                      <th>Trạng thái</th>
                      <th>Thông điệp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourAlerts.map((r, idx) => (
                      <tr key={idx}>
                        <td>{r.hour}</td>
                        <td>{r.chuyen}</td>
                        <td>{r.target}</td>
                        <td>{r.actual}</td>
                        <td>{r.diff}</td>
                        <td>{r.status}</td>
                        <td>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* JSON debug */}
          <div style={{ marginTop: "16px" }}>
            <button onClick={() => setShowJson((v) => !v)}>
              {showJson ? "Ẩn JSON" : "Xem toàn bộ JSON"}
            </button>
            {showJson && (
              <pre
                style={{
                  marginTop: "8px",
                  maxHeight: "320px",
                  overflow: "auto",
                  background: "#111",
                  color: "#0f0",
                  padding: "8px",
                  fontSize: "12px",
                }}
              >
                {JSON.stringify(data, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
    </main>
  );
}
