"use client";

import { useEffect, useMemo, useState } from "react";

function fmtPercent(v) {
  if (v === null || v === undefined) return "—";
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function badgeClass(status) {
  const s = String(status || "").toUpperCase();
  if (["ĐẠT", "VƯỢT", "ĐỦ"].includes(s)) return "badge badge-ok";
  if (["CHƯA ĐẠT", "THIẾU"].includes(s)) return "badge badge-bad";
  if (["CHƯA CÓ"].includes(s)) return "badge badge-warn";
  return "badge badge-na";
}

export default function KpiDashboardClient() {
  const [items, setItems] = useState([]); // config dates
  const [date, setDate] = useState("");
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState("");
  const [q, setQ] = useState("");

  async function loadConfig() {
    const r = await fetch("/api/kpi-config", { cache: "no-store" });
    const j = await r.json();
    if (j.ok) {
      setItems(j.items || []);
      if (!date && j.items?.length) setDate(j.items[j.items.length - 1].date);
    } else {
      console.error(j.error);
    }
  }

  async function loadData(d = date) {
    if (!d) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, { cache: "no-store" });
      const j = await r.json();
      setData(j);

      // auto chọn chuyền đầu tiên
      const first = j?.lines?.[0]?.chuyen || "";
      setSelected((prev) => prev || first);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      if (date) loadData(date);
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const lines = data?.lines || [];
  const marks = data?.marks || [];

  const filteredLines = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return lines;
    return lines.filter((x) =>
      String(x.chuyen || "").toLowerCase().includes(qq) ||
      String(x.maHang || "").toLowerCase().includes(qq)
    );
  }, [lines, q]);

  const selectedLine = useMemo(() => {
    return lines.find((x) => x.chuyen === selected) || null;
  }, [lines, selected]);

  return (
    <div className="kpi-page">
      <div className="kpi-hero">
        <div>
          <div className="kpi-title">KPI Dashboard</div>
          <div className="kpi-sub">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>
        </div>

        <div className="kpi-controls">
          <label className="kpi-label">Ngày:</label>
          <select className="kpi-select" value={date} onChange={(e) => setDate(e.target.value)}>
            {items.map((it) => (
              <option key={it.date} value={it.date}>{it.date}</option>
            ))}
          </select>

          <button className="kpi-btn" onClick={() => loadData(date)} disabled={!date || loading}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="kpi-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Tự cập nhật (1 phút)
          </label>

          <div className="kpi-updated">
            {data?.date ? `Đang xem: ${data.date}` : ""}
          </div>
        </div>

        {data?.ok === false && (
          <div className="kpi-error">Lỗi: {data.error}</div>
        )}

        {data?.ok && data?.lines?.length === 0 && (
          <div className="kpi-warn">
            Không có dữ liệu (kiểm tra Share sheet cho Service Account + đúng RANGE trong CONFIG_KPI).
          </div>
        )}
      </div>

      <div className="kpi-grid">
        {/* LEFT */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">So sánh hiệu suất ngày</div>
              <div className="card-sub">Mốc cuối: {marks[marks.length - 1] || "->16h30"}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="kpi-table">
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
                  <tr><td colSpan={5} className="muted">Chưa có dữ liệu (bấm “Xem dữ liệu”)</td></tr>
                ) : (
                  filteredLines.map((x) => (
                    <tr
                      key={x.chuyen}
                      className={x.chuyen === selected ? "row-active" : ""}
                      onClick={() => setSelected(x.chuyen)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="mono">{x.chuyen}</td>
                      <td className="mono">{x.maHang || "—"}</td>
                      <td>{fmtPercent(x.hsDat)}</td>
                      <td>{fmtPercent(x.hsDinhMuc)}</td>
                      <td><span className={badgeClass(x.statusDay)}>{x.statusDay}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT */}
        <div className="card">
          <div className="card-head row-between">
            <div>
              <div className="card-title">
                So sánh lũy tiến theo giờ (chuyền: <span className="mono">{selected || "—"}</span>)
              </div>
              <div className="card-sub">
                Mã hàng: <span className="mono">{selectedLine?.maHang || "—"}</span>
              </div>
            </div>

            <input
              className="kpi-search"
              placeholder="Tìm chuyền hoặc mã hàng..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="chip-row">
            {filteredLines.map((x) => (
              <button
                key={x.chuyen}
                className={`chip ${x.chuyen === selected ? "chip-active" : ""}`}
                onClick={() => setSelected(x.chuyen)}
                title={x.maHang || ""}
              >
                {x.chuyen}
              </button>
            ))}
          </div>

          <div className="mini-cards">
            <div className="mini">
              <div className="mini-title">DM/H</div>
              <div className="mini-val">{selectedLine?.dmHour ? selectedLine.dmHour : "—"}</div>
            </div>
            <div className="mini">
              <div className="mini-title">DM/NGÀY</div>
              <div className="mini-val">{selectedLine?.dmDay ? selectedLine.dmDay : "—"}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="kpi-table">
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
                {!selectedLine ? (
                  <tr><td colSpan={5} className="muted">Chưa chọn chuyền</td></tr>
                ) : (
                  marks.map((m) => {
                    const h = selectedLine.hourly?.[m];
                    const actual = h?.actual ?? null;
                    const expected = h?.expected ?? null;
                    const diff = h?.diff ?? null;
                    const status = h?.status ?? "N/A";
                    return (
                      <tr key={m}>
                        <td className="mono">{m}</td>
                        <td>{actual === null ? "—" : actual}</td>
                        <td>{expected === null ? "—" : Math.round(expected)}</td>
                        <td>{diff === null ? "—" : (diff >= 0 ? `+${Math.round(diff)}` : `${Math.round(diff)}`)}</td>
                        <td><span className={badgeClass(status)}>{status}</span></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* debug nhỏ nếu bạn cần */}
          {data?.debug && (
            <div className="debug">
              Debug: DM/NGÀY col={data.debug.colDmNgay}, DM/H col={data.debug.colDmH}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}