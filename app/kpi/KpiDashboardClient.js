// app/kpi/KpiDashboardClient.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);

  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  const [data, setData] = useState(null);
  const [selectedLine, setSelectedLine] = useState("");
  const [searchLine, setSearchLine] = useState("");

  const [autoRefresh, setAutoRefresh] = useState(true);
  const AUTO_REFRESH_MS = 60 * 1000;

  const inflightRef = useRef(false);
  const lastUpdatedRef = useRef(null);
  const [, forceTick] = useState(0);

  // Load config
  useEffect(() => {
    async function loadConfig() {
      try {
        setLoadingConfig(true);
        setError("");

        const res = await fetch("/api/kpi-config", { cache: "no-store" });
        const json = await res.json();

        if (json.status !== "success") {
          setError(json.message || "Không đọc được CONFIG_KPI");
          setDates([]);
          return;
        }

        const ds = json.dates || [];
        setDates(ds);

        if (ds.length) setSelectedDate(ds[ds.length - 1]);
      } catch (e) {
        setError(e?.message || "Lỗi khi đọc CONFIG_KPI");
      } finally {
        setLoadingConfig(false);
      }
    }
    loadConfig();
  }, []);

  async function loadKpiOnce() {
    if (!selectedDate) return;
    if (inflightRef.current) return;

    try {
      inflightRef.current = true;
      setLoadingData(true);
      setError("");

      const params = new URLSearchParams({ date: selectedDate });
      const res = await fetch(`/api/check-kpi?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();

      if (json.status !== "success") {
        setError(json.message || "Không đọc được KPI");
        return;
      }

      setData(json);

      const lines = json.lines || [];
      if (lines.length) {
        if (!selectedLine) setSelectedLine(lines[0].line);
        if (selectedLine && !lines.some((x) => x.line === selectedLine)) {
          setSelectedLine(lines[0].line);
        }
      }

      lastUpdatedRef.current = new Date();
      forceTick((x) => x + 1);
    } catch (e) {
      setError(e?.message || "Lỗi khi gọi API KPI");
    } finally {
      inflightRef.current = false;
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (!selectedDate) return;
    loadKpiOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!autoRefresh) return;
    if (!selectedDate) return;

    const id = setInterval(() => loadKpiOnce(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedDate]);

  const lines = data?.lines || [];

  const filteredLines = useMemo(() => {
    const q = searchLine.trim().toUpperCase();
    if (!q) return lines;
    return lines.filter((l) => String(l.line).toUpperCase().includes(q));
  }, [lines, searchLine]);

  const currentLine = useMemo(() => {
    return lines.find((l) => l.line === selectedLine) || null;
  }, [lines, selectedLine]);

  const lastUpdatedText = useMemo(() => {
    const d = lastUpdatedRef.current;
    return d ? d.toLocaleString("vi-VN") : "";
  }, [data]);

  return (
    <section className="mt-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="font-medium">Ngày:</label>
          <select
            className="border px-2 py-1 rounded min-w-[180px]"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            disabled={loadingConfig || !dates.length}
          >
            {loadingConfig && <option>Đang tải ngày...</option>}
            {!loadingConfig && !dates.length && <option>Không có ngày</option>}
            {!loadingConfig &&
              dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
          </select>
        </div>

        <button
          className="border px-3 py-1 rounded bg-black text-white disabled:opacity-50"
          onClick={loadKpiOnce}
          disabled={!selectedDate || loadingData}
          type="button"
        >
          {loadingData ? "Đang tải..." : "Xem dữ liệu"}
        </button>

        <label className="flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Tự cập nhật (1 phút)
        </label>

        {lastUpdatedText && (
          <span className="text-sm text-gray-600">
            Cập nhật: <b>{lastUpdatedText}</b>
          </span>
        )}
      </div>

      {error && <div className="text-red-600 mb-3">Lỗi: {error}</div>}

      {!data && !error && (
        <div className="text-gray-600">Chọn ngày rồi bấm “Xem dữ liệu”.</div>
      )}

      {data && (
        // md trở lên: 2 cột để “kề nhau”
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* LEFT: Day efficiency */}
          <div className="border rounded bg-white p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">So sánh hiệu suất ngày</div>
              <div className="text-xs text-gray-600">
                Mốc cuối: <b>{data.latestMark}</b>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border px-2 py-1 text-left">Chuyền</th>
                    <th className="border px-2 py-1 text-right">HS đạt</th>
                    <th className="border px-2 py-1 text-right">HS định mức</th>
                    <th className="border px-2 py-1 text-center">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.map((l) => {
                    const ach = l.dayAch == null ? null : l.dayAch * 100;
                    const tar = (l.dayTarget ?? 0) * 100;

                    const status = l.dayStatus;
                    const statusClass =
                      status === "ĐẠT"
                        ? "text-green-700 font-semibold"
                        : status === "KHÔNG ĐẠT"
                        ? "text-red-700 font-semibold"
                        : "text-gray-600";

                    return (
                      <tr
                        key={`${l.line}-${tar}`}
                        className={`hover:bg-gray-50 cursor-pointer ${
                          selectedLine === l.line ? "bg-gray-50" : ""
                        }`}
                        onClick={() => setSelectedLine(l.line)}
                      >
                        <td className="border px-2 py-1 font-medium">{l.line}</td>
                        <td className="border px-2 py-1 text-right">
                          {ach == null ? "—" : `${ach.toFixed(2)}%`}
                        </td>
                        <td className="border px-2 py-1 text-right">
                          {`${tar.toFixed(2)}%`}
                        </td>
                        <td className={`border px-2 py-1 text-center ${statusClass}`}>
                          {status}
                        </td>
                      </tr>
                    );
                  })}

                  {!filteredLines.length && (
                    <tr>
                      <td className="border px-2 py-2 text-gray-600" colSpan={4}>
                        Không có chuyền phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT: Hour cumulative compare */}
          <div className="border rounded bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="font-semibold">
                So sánh lũy tiến theo giờ (chuyền: <b>{selectedLine || "—"}</b>)
              </div>
              <input
                className="border rounded px-2 py-1 text-sm"
                placeholder="Tìm chuyền..."
                value={searchLine}
                onChange={(e) => setSearchLine(e.target.value)}
              />
            </div>

            {/* chips */}
            <div className="flex flex-wrap gap-2 mb-3">
              {filteredLines.slice(0, 20).map((l) => (
                <button
                  key={l.line}
                  type="button"
                  onClick={() => setSelectedLine(l.line)}
                  className={`border rounded px-2 py-1 text-sm ${
                    selectedLine === l.line ? "bg-black text-white" : "bg-white"
                  }`}
                >
                  {l.line}
                </button>
              ))}
            </div>

            {currentLine ? (
              <>
                <div className="text-sm text-gray-700 mb-2">
                  DM/H: <b>{currentLine.dmH ? currentLine.dmH.toFixed(2) : 0}</b>{" "}
                  • DM/NGÀY: <b>{currentLine.dmDay ? currentLine.dmDay.toFixed(2) : 0}</b>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="border px-2 py-1 text-left">Mốc</th>
                        <th className="border px-2 py-1 text-right">Lũy tiến</th>
                        <th className="border px-2 py-1 text-right">DM lũy tiến</th>
                        <th className="border px-2 py-1 text-right">Chênh</th>
                        <th className="border px-2 py-1 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentLine.marks.map((m) => {
                        const stClass =
                          m.status === "VƯỢT"
                            ? "text-green-700 font-semibold"
                            : m.status === "ĐỦ"
                            ? "text-blue-700 font-semibold"
                            : m.status === "THIẾU"
                            ? "text-red-700 font-semibold"
                            : "text-gray-600";

                        return (
                          <tr key={m.mark} className="hover:bg-gray-50">
                            <td className="border px-2 py-1">{m.mark}</td>
                            <td className="border px-2 py-1 text-right">
                              {m.actual == null ? "—" : m.actual}
                            </td>
                            <td className="border px-2 py-1 text-right">
                              {m.expected ? m.expected.toFixed(0) : 0}
                            </td>
                            <td className="border px-2 py-1 text-right">
                              {m.delta == null ? "—" : m.delta.toFixed(0)}
                            </td>
                            <td className={`border px-2 py-1 text-center ${stClass}`}>
                              {m.status}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="text-gray-600">Chưa chọn chuyền.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
