"use client";

import { useEffect, useMemo, useState } from "react";

function fmtPercent(v) {
  if (v === null || v === undefined || v === "") return "—";
  return `${Number(v).toFixed(2)}%`;
}

export default function DashboardClient() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);

  const [rows, setRows] = useState([]); // lines data
  const [selectedLine, setSelectedLine] = useState("");
  const [q, setQ] = useState("");

  async function loadDates() {
    const r = await fetch("/api/kpi-config?list=1", { cache: "no-store" });
    const j = await r.json();
    if (j.ok) {
      setDates(j.dates || []);
      if (!date && j.dates?.length) setDate(j.dates[j.dates.length - 1]); // lấy ngày mới nhất
    }
  }

  async function loadData(d) {
    if (!d) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (j.ok) {
        setRows(j.lines || []);
        if (!selectedLine && j.lines?.length) setSelectedLine(j.lines[0].line);
      } else {
        setRows([]);
        console.error(j.error);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!date) return;
    loadData(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    if (!auto || !date) return;
    const t = setInterval(() => loadData(date), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (x) =>
        x.line.toLowerCase().includes(s) ||
        (x.mh || "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  const current = useMemo(() => {
    return rows.find((x) => x.line === selectedLine) || null;
  }, [rows, selectedLine]);

  return (
    <div className="kpiWrap">
      <div className="kpiHeader">
        <div>
          <div className="kpiTitle">KPI Dashboard</div>
          <div className="kpiSub">
            Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.
          </div>
        </div>

        <div className="kpiControls">
          <label className="ctl">
            <span>Ngày:</span>
            <select
              className="select"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <button className="btn" onClick={() => loadData(date)}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="ctl chk">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            <span>Tự cập nhật (1 phút)</span>
          </label>
        </div>
      </div>

      <div className="grid">
        {/* LEFT: Daily */}
        <div className="card">
          <div className="cardTitle">So sánh hiệu suất ngày</div>
          <div className="hint">Mốc cuối: -&gt;16h30</div>

          <div className="tableWrap">
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
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Chưa có dữ liệu (bấm “Xem dữ liệu”)
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const ok = r.statusDay === "ĐẠT";
                    const bad = r.statusDay === "KHÔNG ĐẠT";
                    return (
                      <tr
                        key={r.line}
                        className={r.line === selectedLine ? "rowActive" : ""}
                        onClick={() => setSelectedLine(r.line)}
                      >
                        <td className="mono">{r.line}</td>
                        <td className="mono">{r.mh || "—"}</td>
                        <td>{fmtPercent(r.hs)}</td>
                        <td>{fmtPercent(r.hsTarget)}</td>
                        <td>
                          <span
                            className={
                              ok
                                ? "pill ok"
                                : bad
                                ? "pill bad"
                                : "pill na"
                            }
                          >
                            {r.statusDay}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Hourly */}
        <div className="card">
          <div className="cardTop">
            <div>
              <div className="cardTitle">
                So sánh lũy tiến theo giờ (chuyền:{" "}
                <span className="accent">{selectedLine || "—"}</span>)
              </div>
              <div className="hint">
                Mã hàng: <span className="mono">{current?.mh || "—"}</span>
              </div>
            </div>

            <input
              className="search"
              placeholder="Tìm chuyền hoặc mã hàng..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="lineBar">
            {rows.map((x) => (
              <button
                key={x.line}
                className={
                  "chip " + (x.line === selectedLine ? "chipActive" : "")
                }
                onClick={() => setSelectedLine(x.line)}
              >
                {x.line}
              </button>
            ))}
          </div>

          <div className="kpiStats">
            <div className="stat">
              <div className="statLabel">ĐM/H</div>
              <div className="statValue">{current?.dmH ?? "—"}</div>
            </div>
            <div className="stat">
              <div className="statLabel">ĐM/NGÀY</div>
              <div className="statValue">{current?.dmNgay ?? "—"}</div>
            </div>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mốc</th>
                  <th>Lũy tiến</th>
                  <th>ĐM lũy tiến</th>
                  <th>Chênh</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {!current ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Chưa chọn chuyền
                    </td>
                  </tr>
                ) : (
                  current.perHour.map((p) => (
                    <tr key={p.moc}>
                      <td className="mono">{p.moc}</td>
                      <td>{p.luy ?? "—"}</td>
                      <td>{p.dmLuy ?? "—"}</td>
                      <td>{p.chenh ?? "—"}</td>
                      <td>
                        <span
                          className={
                            p.status === "ĐẠT"
                              ? "pill ok"
                              : p.status === "CHƯA ĐẠT"
                              ? "pill bad"
                              : "pill na"
                          }
                        >
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="footNote">
            {current?.statusDay === "ĐẠT"
              ? "✅ Đủ / đạt hiển thị xanh"
              : "❌ Thiếu / không đạt hiển thị đỏ"}
          </div>
        </div>
      </div>
    </div>
  );
}