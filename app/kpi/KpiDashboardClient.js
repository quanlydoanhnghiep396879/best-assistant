"use client";

import { useEffect, useMemo, useState } from "react";

function pct(v) {
  if (v == null) return "—";
  return (v * 100).toFixed(2) + "%";
}
function fmtNum(v) {
  if (v == null) return "—";
  if (Number.isInteger(v)) return String(v);
  return Number(v).toFixed(2);
}

function badgeClass(status) {
  const s = (status || "").toUpperCase();

  // xanh
  if (s === "VƯỢT" || s === "ĐỦ" || s === "ĐẠT") {
    return "border border-green-200 bg-green-100 text-green-800";
  }
  // đỏ
  if (s === "THIẾU" || s === "CHƯA ĐẠT" || s === "CHƯA CÓ") {
    return "border border-red-200 bg-red-100 text-red-800";
  }
  // xám
  return "border border-gray-200 bg-gray-100 text-gray-700";
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [data, setData] = useState(null);
  const [lineSearch, setLineSearch] = useState("");
  const [selectedLine, setSelectedLine] = useState("");

  const lastUpdated = data?.fetchedAt;

  async function loadConfig() {
    const res = await fetch("/api/kpi-config", { cache: "no-store" });
    const j = await res.json();
    if (j.status !== "ok") throw new Error(j.message || "Config error");
    setDates(j.dates || []);
    if (!selectedDate && j.dates?.length) setSelectedDate(j.dates[0]);
  }

  async function loadData(date) {
    if (!date) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const j = await res.json();
      if (j.status !== "ok") throw new Error(j.message || "Load KPI error");

      j.fetchedAt = new Date().toLocaleString("vi-VN");
      setData(j);

      // chọn line mặc định
      const firstLine = j.lines?.[0]?.line || "";
      if (!selectedLine) setSelectedLine(firstLine);
    } catch (e) {
      setErr(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig().catch((e) => setErr(e?.message || String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedDate) loadData(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    if (!auto || !selectedDate) return;
    const id = setInterval(() => loadData(selectedDate), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, selectedDate]);

  const lines = data?.lines || [];

  const filteredLines = useMemo(() => {
    const q = lineSearch.trim().toUpperCase();
    if (!q) return lines;
    return lines.filter((x) => String(x.line).toUpperCase().includes(q));
  }, [lines, lineSearch]);

  const currentLine = useMemo(() => {
    return lines.find((x) => x.line === selectedLine) || null;
  }, [lines, selectedLine]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-3">KPI Dashboard</h1>
      <p className="text-gray-600 mb-4">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="font-semibold">Ngày:</label>
        <select
          className="border rounded-lg px-3 py-2"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        >
          <option value="">--</option>
          {dates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <button
          className="border rounded-lg px-4 py-2 bg-black text-white disabled:opacity-50"
          onClick={() => loadData(selectedDate)}
          disabled={!selectedDate || loading}
        >
          {loading ? "Đang tải..." : "Xem dữ liệu"}
        </button>

        <label className="flex items-center gap-2 ml-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Tự cập nhật (1 phút)</span>
        </label>

        {lastUpdated && (
          <div className="text-gray-500">Cập nhật: <b>{lastUpdated}</b></div>
        )}
      </div>

      {err && <div className="text-red-600 font-semibold mb-4">Lỗi: {err}</div>}

      {/* 2 cột ngang */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: HS ngày */}
        <div className="rounded-2xl border p-4 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-bold">So sánh hiệu suất ngày</h2>
            <div className="text-gray-500">Mốc cuối: -&gt;16h30</div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left border-b">
                <tr>
                  <th className="py-2">Chuyền</th>
                  <th>HS đạt</th>
                  <th>HS định mức</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((x) => (
                  <tr key={x.line} className="border-b">
                    <td className="py-2 font-semibold">{x.line}</td>
                    <td>{pct(x.hs)}</td>
                    <td>{pct(x.hsTarget)}</td>
                    <td>
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${badgeClass(x.hsStatus)}`}>
                        {x.hsStatus}
                      </span>
                    </td>
                  </tr>
                ))}
                {!filteredLines.length && (
                  <tr><td className="py-3 text-gray-500" colSpan={4}>Không có dữ liệu chuyền.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Lũy tiến theo giờ */}
        <div className="rounded-2xl border p-4 bg-white">
          <h2 className="text-xl font-bold mb-3">
            So sánh lũy tiến theo giờ (chuyền: <span className="text-black">{selectedLine || "—"}</span>)
          </h2>

          <input
            className="border rounded-lg px-3 py-2 w-full mb-3"
            placeholder="Tìm chuyền..."
            value={lineSearch}
            onChange={(e) => setLineSearch(e.target.value)}
          />

          <div className="flex flex-wrap gap-2 mb-3">
            {filteredLines.map((x) => (
              <button
                key={x.line}
                onClick={() => setSelectedLine(x.line)}
                className={`px-3 py-1 rounded-full border text-sm font-semibold ${
                  x.line === selectedLine ? "bg-black text-white" : "bg-white"
                }`}
              >
                {x.line}
              </button>
            ))}
          </div>

          {!currentLine ? (
            <div className="text-gray-500">Chưa chọn chuyền.</div>
          ) : (
            <>
              <div className="font-bold mb-3">
                DM/H: {currentLine.dmHour ?? "—"} &nbsp; • &nbsp; DM/NGÀY: {currentLine.dmDay ?? "—"}
              </div>

              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left border-b">
                    <tr>
                      <th className="py-2">Mốc</th>
                      <th>Lũy tiến</th>
                      <th>ĐM lũy tiến</th>
                      <th>Chênh</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentLine.hourlyCompare.map((r) => (
                      <tr key={r.mark} className="border-b">
                        <td className="py-2">{r.mark}</td>
                        <td>{r.actual ?? "—"}</td>
                        <td>{r.dmCum == null ? "—" : fmtNum(r.dmCum)}</td>
                        <td>{r.diff == null ? "—" : (r.diff >= 0 ? `+${fmtNum(r.diff)}` : fmtNum(r.diff))}</td>
                        <td>
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${badgeClass(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Nếu cần debug nhanh */}
              {/* <pre className="text-xs text-gray-500 mt-3">{JSON.stringify(data?.debug, null, 2)}</pre> */}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
