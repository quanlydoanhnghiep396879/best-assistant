"use client";

import { useEffect, useMemo, useState } from "react";

function pct(x) {
  if (x == null) return "—";
  return (x * 100).toFixed(2) + "%";
}

function statusClass(s) {
  const up = String(s || "").toUpperCase();

  const green = ["VƯỢT", "ĐỦ", "ĐẠT"];
  const red = ["THIẾU", "CHƯA ĐẠT", "KHÔNG ĐẠT", "CHƯA CÓ"];

  if (green.some((k) => up.includes(k))) {
    return "bg-green-100 text-green-700 border-green-300";
  }
  if (red.some((k) => up.includes(k))) {
    return "bg-red-100 text-red-700 border-red-300";
  }
  return "bg-gray-100 text-gray-700 border-gray-300";
}

function StatusPill({ value }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-semibold ${statusClass(value)}`}>
      {value || "—"}
    </span>
  );
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [auto, setAuto] = useState(true);

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [selectedLine, setSelectedLine] = useState("");

  async function loadConfig() {
    const r = await fetch("/api/kpi-config", { cache: "no-store" });
    const j = await r.json();
    if (j.status !== "success") throw new Error(j.message || "Config error");
    setDates(j.dates || []);
    if (!selectedDate) setSelectedDate(j.dates?.[j.dates.length - 1] || "");
  }

  async function loadData(d) {
    if (!d) return;
    setErr("");
    const r = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, { cache: "no-store" });
    const j = await r.json();
    if (j.status !== "success") throw new Error(j.message || "Load data error");
    setData(j);

    // auto select line
    const firstLine = j.lines?.[0]?.line || "";
    setSelectedLine((prev) => prev || firstLine);
  }

  useEffect(() => {
    loadConfig().catch((e) => setErr(String(e.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auto) return;
    if (!selectedDate) return;

    const t = setInterval(() => {
      loadData(selectedDate).catch((e) => setErr(String(e.message || e)));
    }, 60_000);

    return () => clearInterval(t);
  }, [auto, selectedDate]);

  const lines = data?.lines || [];
  const filteredLines = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return lines;
    return lines.filter((x) => String(x.line).toUpperCase().includes(s));
  }, [lines, q]);

  const current = useMemo(() => {
    return (lines || []).find((x) => x.line === selectedLine) || null;
  }, [lines, selectedLine]);

  const marks = data?.marks || [];

  const hourlyRows = useMemo(() => {
    if (!current) return [];
    const dmHour = Number.isFinite(current.dmHour) ? current.dmHour : null;

    return marks.map((m, idx) => {
      const actual = current.hourly?.[m];
      const dmCum = Number.isFinite(dmHour) ? dmHour * (idx + 1) : null;

      let status = "N/A";
      let diff = null;

      if (Number.isFinite(dmCum) && dmCum > 0 && Number.isFinite(actual)) {
        diff = actual - dmCum;
        if (diff === 0) status = "ĐỦ";
        else if (diff > 0) status = "VƯỢT";
        else status = "THIẾU";
      }

      return { mark: m, actual, dmCum, diff, status };
    });
  }, [current, marks]);

  return (
    <div className="p-6">
      <h1 className="text-4xl font-extrabold mb-2">KPI Dashboard</h1>
      <div className="text-gray-700 mb-4">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>

      <div className="flex items-center gap-3 mb-4">
        <div className="font-semibold">Ngày:</div>
        <select
          className="border rounded px-2 py-1"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        >
          <option value="">—</option>
          {dates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <button
          className="border rounded px-3 py-1 font-semibold"
          onClick={() => loadData(selectedDate).catch((e) => setErr(String(e.message || e)))}
          disabled={!selectedDate}
        >
          Xem dữ liệu
        </button>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Tự cập nhật (1 phút)</span>
        </label>

        {data?.updatedAt && (
          <div className="text-gray-600">
            Cập nhật: {new Date(data.updatedAt).toLocaleTimeString("vi-VN")} {new Date(data.updatedAt).toLocaleDateString("vi-VN")}
          </div>
        )}
      </div>

      {err && <div className="text-red-600 font-semibold mb-4">Lỗi: {err}</div>}

      <div className="grid grid-cols-2 gap-6">
        {/* LEFT: DAILY */}
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xl font-bold">So sánh hiệu suất ngày</div>
            <div className="text-gray-600">Mốc cuối: -&gt;16h30</div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Chuyền</th>
                  <th className="text-left py-2">HS đạt</th>
                  <th className="text-left py-2">HS định mức</th>
                  <th className="text-left py-2">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((x) => (
                  <tr
                    key={x.line}
                    className={`border-b hover:bg-gray-50 cursor-pointer ${x.line === selectedLine ? "bg-gray-50" : ""}`}
                    onClick={() => setSelectedLine(x.line)}
                  >
                    <td className="py-2 font-semibold">{x.line}</td>
                    <td className="py-2">{pct(x.hsDay)}</td>
                    <td className="py-2">{pct(x.hsTarget)}</td>
                    <td className="py-2"><StatusPill value={x.hsStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: HOURLY */}
        <div className="border rounded-lg p-4">
          <div className="text-xl font-bold mb-3">So sánh lũy tiến theo giờ (chuyền: {selectedLine || "—"})</div>

          <input
            className="border rounded px-2 py-1 w-56 mb-3"
            placeholder="Tìm chuyền..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="flex flex-wrap gap-2 mb-3">
            {filteredLines.map((x) => (
              <button
                key={x.line}
                className={`border rounded-full px-3 py-1 text-sm ${x.line === selectedLine ? "bg-black text-white" : ""}`}
                onClick={() => setSelectedLine(x.line)}
              >
                {x.line}
              </button>
            ))}
          </div>

          <div className="text-sm font-semibold mb-3">
            DM/H: {Number.isFinite(current?.dmHour) ? current.dmHour.toFixed(2) : "—"} &nbsp;&nbsp;•&nbsp;&nbsp;
            DM/NGÀY: {Number.isFinite(current?.dmDay) ? current.dmDay : "—"}
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Mốc</th>
                  <th className="text-left py-2">Lũy tiến</th>
                  <th className="text-left py-2">DM lũy tiến</th>
                  <th className="text-left py-2">Chênh</th>
                  <th className="text-left py-2">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {hourlyRows.map((r) => (
                  <tr key={r.mark} className="border-b">
                    <td className="py-2">{r.mark}</td>
                    <td className="py-2">{Number.isFinite(r.actual) ? r.actual : "—"}</td>
                    <td className="py-2">{Number.isFinite(r.dmCum) ? Math.round(r.dmCum) : "—"}</td>
                    <td className="py-2">{Number.isFinite(r.diff) ? (r.diff > 0 ? `+${Math.round(r.diff)}` : `${Math.round(r.diff)}`) : "—"}</td>
                    <td className="py-2"><StatusPill value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data?.parsed && (
            <div className="text-xs text-gray-500 mt-3">
              Debug parse: DM/NGÀY col={data.parsed.colDmDay}, ĐM/H col={data.parsed.colDmHour}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
