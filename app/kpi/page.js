// app/kpi/page.js
"use client";

import { useEffect, useState } from "react";

const HOUR_MULTIPLIERS = {
  "9h": 1,
  "10h": 2,
  "11h": 3,
  "12h30": 4,
  "13h30": 5,
  "14h30": 6,
  "15h30": 7,
  "16h30": 8,
};

const thStyle = {
  border: "1px solid #ccc",
  padding: "6px 10px",
  background: "#f3f3f3",
  textAlign: "center",
  fontWeight: 600,
};

const tdStyle = {
  border: "1px solid #ddd",
  padding: "6px 10px",
  textAlign: "center",
};

const tdNumStyle = {
  ...tdStyle,
  textAlign: "right",
};

export default function KpiDashboardPage() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchData(date) {
    setLoading(true);
    setError("");

    try {
      const url = date
        ? `/api/check-kpi?date=${encodeURIComponent(date)}`
        : "/api/check-kpi";

      const res = await fetch(url);
      const json = await res.json();

      if (json.status !== "success") {
        setError(json.message || "API error");
        setLines([]);
        setDates(json.dates || []);
        return;
      }

      setDates(json.dates || []);
      setSelectedDate(json.date || "");
      setLines(json.lines || []);

      if (json.lines && json.lines.length) {
        setSelectedLine(json.lines[0].chuyen);
      } else {
        setSelectedLine("");
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // load lần đầu
  useEffect(() => {
    fetchData("");
  }, []);

  const handleDateChange = (e) => {
    const d = e.target.value;
    setSelectedDate(d);
    fetchData(d);
  };

  const handleLineChange = (e) => {
    setSelectedLine(e.target.value);
  };

  const currentLine = lines.find((l) => l.chuyen === selectedLine);

  const rows =
    currentLine?.hours?.map((h) => {
      const mult = HOUR_MULTIPLIERS[h.label] || 0;
      const target = currentLine.dmHour * mult;
      const actual = h.actual || 0;
      const diff = actual - target;

      let status = "Đủ";
      if (diff < 0) status = "Thiếu";
      else if (diff > 0) status = "Dư";

      return {
        label: h.label,
        target,
        actual,
        diff,
        status,
      };
    }) || [];

  return (
    <main
      style={{
        padding: "24px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 28 }}>📊</span>
        <span>KPI Dashboard</span>
      </h1>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 24,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label>
          <strong>Ngày: </strong>
          <select
            value={selectedDate}
            onChange={handleDateChange}
            style={{ padding: "4px 8px" }}
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        {lines.length > 0 && (
          <label>
            <strong>Chuyền: </strong>
            <select
              value={selectedLine}
              onChange={handleLineChange}
              style={{ padding: "4px 8px" }}
            >
              {lines.map((l) => (
                <option key={l.chuyen} value={l.chuyen}>
                  {l.chuyen}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p style={{ marginTop: 16, color: "red" }}>
          <strong>Lỗi:</strong> {error}
        </p>
      )}

      {loading && <p style={{ marginTop: 16 }}>Đang tải dữ liệu…</p>}

      {!loading && !error && currentLine && (
        <section style={{ marginTop: 24 }}>
          <h2>
            Chuyền <strong>{currentLine.chuyen}</strong> – DM/H:{" "}
            <strong>{currentLine.dmHour}</strong> – DM/Ngày:{" "}
            <strong>{currentLine.dmDay}</strong>
          </h2>

          <table
            style={{
              marginTop: 12,
              borderCollapse: "collapse",
              minWidth: 620,
              maxWidth: "100%",
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Giờ</th>
                <th style={thStyle}>Kế hoạch lũy tiến</th>
                <th style={thStyle}>Thực tế</th>
                <th style={thStyle}>Chênh lệch</th>
                <th style={thStyle}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td style={tdStyle}>{row.label}</td>
                  <td style={tdNumStyle}>{row.target}</td>
                  <td style={tdNumStyle}>{row.actual}</td>
                  <td style={tdNumStyle}>{row.diff}</td>
                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: 600,
                      color:
                        row.status === "Thiếu"
                          ? "red"
                          : row.status === "Dư"
                          ? "orange"
                          : "green",
                    }}
                  >
                    {row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && !error && !currentLine && (
        <p style={{ marginTop: 16 }}>
          Không có dữ liệu chuyền cho ngày này.
        </p>
      )}
    </main>
  );
}
