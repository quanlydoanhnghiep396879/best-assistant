'use client';

import { useEffect, useState } from 'react';

const thStyle = {
  border: '1px solid #ddd',
  padding: '6px 10px',
  textAlign: 'left',
  background: '#f3f4f6',
  fontWeight: 600,
};

const tdStyle = {
  border: '1px solid #eee',
  padding: '6px 10px',
};

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [lines, setLines] = useState([]);
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetchKpi(date) {
    setLoading(true);
    setError('');

    try {
      const url = date
        ? `/api/check-kpi?date=${encodeURIComponent(date)}`
        : '/api/check-kpi';

      const res = await fetch(url);
      const data = await res.json();

      if (data.status !== 'success') {
        setError(data.message || 'API error');
        setLines([]);
        setRaw([]);
        setDates(data.dates || []);
        return;
      }

      setDates(data.dates || []);
      setSelectedDate(data.date || date || data.dates?.[0] || '');
      setLines(data.lines || []);
      setRaw(data.raw || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  }

  // Load lần đầu
  useEffect(() => {
    fetchKpi();
  }, []);

  const handleDateChange = (e) => {
    const d = e.target.value;
    setSelectedDate(d);
    fetchKpi(d);
  };

  return (
    <main style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1
        style={{
          fontSize: '28px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 32 }}>📊</span>
        KPI Dashboard
      </h1>

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <label style={{ fontWeight: 600, marginRight: 8 }}>Ngày:</label>
        <select
          value={selectedDate}
          onChange={handleDateChange}
          disabled={!dates.length}
        >
          {dates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p style={{ color: 'red', marginTop: 8 }}>
          Lỗi: {error}
        </p>
      )}

      {loading && <p>Đang tải dữ liệu…</p>}

      {!loading && !error && lines.length === 0 && (
        <p>Không có dữ liệu chuyền cho ngày này.</p>
      )}

      {!loading && !error && lines.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, marginBottom: 8 }}>
            Tổng quan theo chuyền
          </h2>

          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              maxWidth: 1100,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Chuyền</th>
                <th style={thStyle}>Hiệu suất ngày (ước tính)</th>
                <th style={thStyle}>Trạng thái</th>
                <th style={thStyle}>Sản lượng (tham khảo)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.line}>
                  <td style={tdStyle}>{line.line}</td>
                  <td style={tdStyle}>{line.effDay || '-'}</td>
                  <td style={tdStyle}>{line.status || '-'}</td>
                  <td style={tdStyle}>{line.prodToday || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <details style={{ marginTop: 24 }}>
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Xem toàn bộ dữ liệu thô (raw từ Google Sheet)
            </summary>
            <pre
              style={{
                marginTop: 8,
                maxHeight: 400,
                overflow: 'auto',
                fontSize: 12,
                background: '#fafafa',
                padding: 8,
              }}
            >
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        </>
      )}
    </main>
  );
}
