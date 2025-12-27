"use client";

import { useEffect, useRef, useState } from "react";

const CHECKPOINTS = new Set([
  "->9h",
  "->10h",
  "->11h",
  "->12h30",
  "->13h30",
  "->14h30",
  "->15h30",
  "->16h30",
]);

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);

  // Lần đầu mở: không gửi mail
  const firstLoadRef = useRef(true);
  const prevRawRef = useRef(null);

  // 1) Load config ngày
  useEffect(() => {
    async function loadConfig() {
      try {
        setError("");
        const res = await fetch("/api/kpi-config", { cache: "no-store" });
        const data = await res.json();

        if (data.status !== "success") {
          setError(data.message || "Không đọc được CONFIG_KPI");
          return;
        }

        const ds = data.dates || [];
        setDates(ds);
        if (ds.length > 0) setSelectedDate(ds[ds.length - 1]);
      } catch (err) {
        setError(err.message || "Lỗi khi đọc CONFIG_KPI");
      }
    }
    loadConfig();
  }, []);

  // 2) Poll để cập nhật hiển thị + phát hiện thay đổi lũy tiến
  useEffect(() => {
    if (!selectedDate) return;

    let stopped = false;

    const tick = async () => {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams({ date: selectedDate });
        const res = await fetch(`/api/check-kpi?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();

        if (data.status !== "success") {
          setError(data.message || "Không đọc được KPI");
          return;
        }

        const newRaw = data.raw || [];
        setRows(newRaw);

        // lần đầu: chỉ lưu, không gửi
        if (firstLoadRef.current) {
          firstLoadRef.current = false;
          prevRawRef.current = newRaw;
          return;
        }

        const oldRaw = prevRawRef.current;
        prevRawRef.current = newRaw;

        if (!oldRaw || oldRaw.length < 2 || newRaw.length < 2) return;

        const header = newRaw[0] || [];
        const oldHeader = oldRaw[0] || [];
        if (JSON.stringify(header) !== JSON.stringify(oldHeader)) return;

        // tìm cột chuyền theo header
        let lineCol = 0;
        const headerNorm = header.map((h) => norm(h));
        const idxLine =
          headerNorm.indexOf("chuyen") !== -1
            ? headerNorm.indexOf("chuyen")
            : headerNorm.indexOf("chuyền") !== -1
            ? headerNorm.indexOf("chuyền")
            : headerNorm.indexOf("line") !== -1
            ? headerNorm.indexOf("line")
            : 0;
        lineCol = idxLine;

        // checkpoint cols
        const cpCols = [];
        header.forEach((h, i) => {
          if (CHECKPOINTS.has(String(h).trim())) cpCols.push(i);
        });

        const changes = [];
        const n = Math.min(oldRaw.length, newRaw.length);

        for (let r = 1; r < n; r++) {
          const lineName = String(newRaw[r]?.[lineCol] || "").trim();
          if (!lineName) continue;

          for (const c of cpCols) {
            const a = String(oldRaw[r]?.[c] ?? "");
            const b = String(newRaw[r]?.[c] ?? "");
            if (a !== b) {
              changes.push({ checkpoint: String(header[c]).trim(), lineName });
            }
          }
        }

        // có thay đổi mới gọi POST gửi mail
        if (changes.length && !stopped) {
          await fetch("/api/check-kpi", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: selectedDate, changes }),
          });
        }
      } catch (err) {
        setError(err.message || "Lỗi khi gọi API KPI");
      } finally {
        setLoading(false);
      }
    };

    tick(); // gọi ngay
    const id = setInterval(tick, 2000); // 2s/lần (bạn tăng 3-5s cũng được)

    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [selectedDate]);

  const handleDateChange = (e) => {
    firstLoadRef.current = true;
    prevRawRef.current = null;
    setSelectedDate(e.target.value);
  };

  const hasData = rows && rows.length > 1;
  const header = hasData ? rows[0] : [];
  const bodyRows = hasData ? rows.slice(1) : [];

  return (
    <section className="mt-6">
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

      {loading && <p>Đang tải dữ liệu...</p>}
      {error && <p className="text-red-600">Lỗi: {error}</p>}

      {!loading && !error && !hasData && selectedDate && (
        <p>Không có dữ liệu cho ngày này.</p>
      )}

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
                    <td key={cIdx} className="border px-2 py-1 whitespace-nowrap">
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
