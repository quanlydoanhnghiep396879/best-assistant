"use client";

import { useEffect, useMemo, useState } from "react";

const fmtPercent = (x) => {
  if (x === null || x === undefined) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toFixed(2) + "%";
};

const fmtNum = (x) => {
  if (x === null || x === undefined) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
};

const badgeClass = (status) => {
  const s = String(status || "").toUpperCase();
  if (s.includes("VƯỢT") || s.includes("ĐỦ") || s.includes("ĐẠT")) return "badge good";
  if (s.includes("THIẾU") || s.includes("CHƯA")) return "badge bad";
  if (s.includes("N/A")) return "badge na";
  return "badge na";
};

export default function KpiDashboardClient() {
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [data, setData] = useState(null);
  const [date, setDate] = useState("");
  const [selectedLine, setSelectedLine] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  const fetchData = async (pickedDate) => {
    setLoading(true);
    setErr("");
    try {
      const url = pickedDate ? `/api/check-kpi?date=${encodeURIComponent(pickedDate)}` : `/api/check-kpi`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Fetch failed");

      setData(json);
      setDate(json.date);
      if (!pickedDate) {
        // default selected line = first line
        const first = (json.lines || [])[0]?.line || "";
        setSelectedLine(first);
      } else {
        // keep selected if exists
        const exists = (json.lines || []).some((x) => x.line === selectedLine);
        if (!exists) setSelectedLine((json.lines || [])[0]?.line || "");
      }
    } catch (e) {
      setErr(String(e.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => fetchData(date), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const lines = data?.lines || [];
  const marks = data?.marks || [];
  const availableDates = data?.availableDates || [];

  const filteredLines = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return lines;
    return lines.filter((x) => {
      const a = (x.line || "").toLowerCase();
      const b = (x.maHang || "").toLowerCase();
      return a.includes(kw) || b.includes(kw);
    });
  }, [lines, q]);

  const selected = useMemo(() => {
    return lines.find((x) => x.line === selectedLine) || null;
  }, [lines, selectedLine]);

  const lastUpdated = useMemo(() => {
    if (!data) return "";
    const now = new Date();
    return now.toLocaleString();
  }, [data]);

  return (
    <div className="kpi-root">
      <div className="kpi-hero">
        <div className="kpi-title">KPI Dashboard</div>
        <div className="kpi-sub">
          Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.
        </div>

        <div className="kpi-toolbar">
          <div className="tool">
            <label>Ngày:</label>
            <select
              className="dark-select"
              value={date}
              onChange={(e) => {
                const d = e.target.value;
                setDate(d);
                fetchData(d);
              }}
            >
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn-primary"
            onClick={() => fetchData(date)}
            disabled={loading}
          >
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            Tự cập nhật (1 phút)
          </label>

          <div className="muted">Cập nhật: {lastUpdated}</div>
        </div>

        {err ? <div className="error">Lỗi: {err}</div> : null}
      </div>

      <div className="kpi-grid">
        {/* LEFT: Daily */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">So sánh hiệu suất ngày</div>
              <div className="muted2">Mốc cuối: {marks[marks.length - 1]?.label || "—"}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>Mã hàng</th>
                  <th>HS đạt</th>
                  <th>HS định mức</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">Không có dữ liệu</td>
                  </tr>
                ) : (
                  filteredLines.map((r) => (
                    <tr
                      key={r.line}
                      className={r.line === selectedLine ? "row-active" : ""}
                      onClick={() => setSelectedLine(r.line)}
                    >
                      <td className="strong">{r.line}</td>
                      <td>{r.maHang ?? "—"}</td>
                      <td>{fmtPercent(r.hsDay)}</td>
                      <td>{fmtPercent(r.hsTarget)}</td>
                      <td>
                        <span className={badgeClass(r.hsStatus)}>{r.hsStatus}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Hourly */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">
                So sánh lũy tiến theo giờ (chuyền: {selected?.line ?? "—"})
              </div>
              <div className="muted2">
                Mã hàng: <b>{selected?.maHang ?? "—"}</b>
              </div>
            </div>

            <input
              className="search"
              placeholder="Tìm chuyền hoặc mã hàng..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="chips">
            {filteredLines.slice(0, 20).map((x) => (
              <button
                key={x.line}
                className={`chip ${x.line === selectedLine ? "chip-active" : ""}`}
                onClick={() => setSelectedLine(x.line)}
                title={x.maHang || ""}
              >
                {x.line}
              </button>
            ))}
          </div>

          <div className="kpi-mini">
            <div className="mini-box">
              <div className="mini-label">DM/H</div>
              <div className="mini-val">{selected?.dmHour ?? "—"}</div>
            </div>
            <div className="mini-box">
              <div className="mini-label">DM/NGÀY</div>
              <div className="mini-val">{selected?.dmNgay ?? "—"}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mốc</th>
                  <th>Lũy tiến</th>
                  <th>DM lũy tiến</th>
                  <th>Chênh</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {!selected ? (
                  <tr>
                    <td colSpan={5} className="empty">Chưa chọn chuyền</td>
                  </tr>
                ) : (
                  marks.map((m) => {
                    const a = selected.hourly?.[m.key] ?? null;
                    const e = selected.expected?.[m.key] ?? null;
                    const d = selected.diff?.[m.key] ?? null;
                    const st = selected.hourlyStatus?.[m.key] ?? "N/A";
                    return (
                      <tr key={m.key}>
                        <td className="strong">{m.label}</td>
                        <td>{fmtNum(a)}</td>
                        <td>{fmtNum(e)}</td>
                        <td>{d === null ? "—" : (d > 0 ? `+${fmtNum(d)}` : fmtNum(d))}</td>
                        <td>
                          <span className={badgeClass(st)}>{st}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {data?.debug ? (
            <div className="debug">
              Debug: headerRow={data.debug.headerRow}, dataStart={data.debug.dataStart},
              dmNgayCol={data.debug.dmNgayCol}, dmHCol={data.debug.dmHCol}, maHangCol={data.debug.maHangCol},
              marks={data.debug.marksCount}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
