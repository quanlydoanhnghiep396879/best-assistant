// app/kpi/KpiDashboardClient.js
'use client';

import { useEffect, useState } from 'react';

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]); // dữ liệu thô từ /api/check-kpi

  // 1. Lấy danh sách ngày từ CONFIG_KPI
  useEffect(() => {
    async function loadConfig() {
      try {
        setError('');
        const res = await fetch('/api/kpi-config');
        const data = await res.json();

        if (data.status !== 'success') {
          setError(data.message || 'Không đọc được CONFIG_KPI');
          return;
        }

        const ds = data.dates || [];
        setDates(ds);

        // mặc định chọn ngày cuối cùng trong list
        if (ds.length > 0) {
          const last = ds[ds.length - 1];
          setSelectedDate(last);
        }
      } catch (err) {
        setError(err.message || 'Lỗi khi đọc CONFIG_KPI');
      }
    }

    loadConfig();
  }, []);

  // 2. Mỗi khi selectedDate đổi thì gọi /api/check-kpi?date=...
  useEffect(() => {
    if (!selectedDate) return;

    async function loadKpi() {
      try {
        setLoading(true);
        setError('');
        setRows([]);

        const params = new URLSearchParams({ date: selectedDate });
        const res = await fetch(`/api/check-kpi?${params.toString()}`);
        const data = await res.json();

        if (data.status !== 'success') {
          setError(data.message || 'Không đọc được KPI');
          return;
        }

        const raw = data.raw || [];
        setRows(raw);
      } catch (err) {
        setError(err.message || 'Lỗi khi gọi API KPI');
      } finally {
        setLoading(false);
      }
    }

    loadKpi();
  }, [selectedDate]);

  const handleDateChange = (e) => {
    setSelectedDate(e.target.value);
  };

  const hasData = rows && rows.length > 1; // có header + ít nhất 1 dòng
  const header = hasData ? rows[0] : [];
  const bodyRows = hasData ? rows.slice(1) : [];

  return (
    <section className="mt-6">
      {/* Chọn ngày */}
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="kpi-date" className="font-medium">
          Ngày:
        </label>
        <select
          id="kpi-date"
          className="border px-2 py-1 rounded min-w-[160px]"
          value={selectedDate}
          onChange={handleDateChange}
          disabled={!dates.length}
        >
          {!dates.length && <option>Đang tải ngày...</option>}
          {dates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Trạng thái */}
      {loading && <p>Đang tải dữ liệu chuyền...</p>}
      {error && <p className="text-red-600">Lỗi: {error}</p>}

      {/* Không có dữ liệu */}
      {!loading && !error && !hasData && selectedDate && (
        <p>Không có dữ liệu chuyền cho ngày này.</p>
      )}

      {/* Bảng KPI */}
      {!loading && !error && hasData && (
        <div className="overflow-x-auto border rounded bg-white">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-gray-100">
              <tr>
                {header.map((col, idx) => (
                  <th
                    key={idx}
                    className="border px-2 py-1 text-left whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-gray-50">
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="border px-2 py-1 whitespace-nowrap"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
