"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function fmtPercent(frac) {
  if (frac === null || frac === undefined) return "—";
  const v = Number(frac);
  if (!Number.isFinite(v)) return "—";
  return (v * 100).toFixed(2) + "%"; // CHỈ nhân 100 1 lần
}

function clsStatus(status) {
  if (status === "ĐẠT") return "pill pill-ok";
  if (status === "THIẾU" || status === "CHƯA ĐẠT") return "pill pill-bad";
  if (status === "CHƯA CÓ") return "pill pill-na";
  return "pill pill-na";
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);

  const [daily, setDaily] = useState(null); // from kpi-config
  const [selectedChuyen, setSelectedChuyen] = useState("");
  const [q, setQ] = useState("");

  const [detail, setDetail] = useState(null); // from check-kpi

  const timerRef = useRef(null);

  async function loadDates() {
    const res = await fetch("/api/kpi-config?list=1", { cache: "no-store" });
    const js = await res.json();
    if (js.ok) {
      setDates(js.dates || []);
      if (!date && js.dates?.length) setDate(js.dates[js.dates.length - 1]); // default latest
    }
  }

  async function loadDaily(d = date) {
    if (!d) return;
    setLoading(true);
    try {
      const res = await fetch("/api/kpi-config?date=" + encodeURIComponent(d), { cache: "no-store" });
      const js = await res.json();
      setDaily(js.ok ? js : null);

      const first = js?.rows?.[0]?.chuyen || "";
      setSelectedChuyen(first);
      setDetail(null);

      if (first) {
        await loadDetail(d, first);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(d = date, ch = selectedChuyen) {
    if (!d || !ch) return;
    const res = await fetch(
      "/api/check-kpi?date=" + encodeURIComponent(d) + "&chuyen=" + encodeURIComponent(ch),
      { cache: "no-store" }
    );
    const js = await res.json();
    setDetail(js.ok ? js : null);
  }

  useEffect(() => {
    loadDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!auto) return;
    timerRef.current = setInterval(() => {
      if (date) loadDaily(date);
    }, 60_000);
    return () => timerRef.current && clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const filteredRows = useMemo(() => {
    const rows = daily?.rows || [];
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) => {
      return (
        String(r.chuyen || "").toLowerCase().includes(query) ||
        String(r.maHang || "").toLowerCase().includes(query)
      );
    });
  }, [daily, q]);

  const selectedMaHang = useMemo(() => {
    const rows = daily?.rows || [];
    const found = rows.find((r) => String(r.chuyen).toUpperCase() === String(selectedChuyen).toUpperCase());
    return found?.maHang || "—";
  }, [daily, selectedChuyen]);

  return (
    <div className="kpi-wrap">
      <div className="hero">
        <div className="hero-title">KPI Dashboard</div>
        <div className="hero-sub">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>

        <div className="toolbar">
          <label className="field">
            <span>Ngày:</span>
            <select value={date} onChange={(e) => setDate(e.target.value)} className="select">
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <button className="btn" onClick={() => loadDaily(date)} disabled={!date || loading}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="chk">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Tự cập nhật (1 phút)</span>
          </label>

          <div className="muted">
            {daily?.date ? (
              <>
                Range: <b>{daily.rangeA1}</b>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>

      <div className="grid">
        {/* LEFT */}
        <section className="card">
          <div className="card-hd">
            <div>
              <div className="card-title">So sánh hiệu suất ngày</div>
              <div className="card-sub">Mốc cuối: {daily?.timeMarks?.slice(-1)?.[0] || "—"}</div>
            </div>

            <input
              className="search"
              placeholder="Tìm chuyền hoặc mã hàng..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
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
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Không có dữ liệu (bấm “Xem dữ liệu”)
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const active = String(r.chuyen).toUpperCase() === String(selectedChuyen).toUpperCase();
                    return (
                      <tr
                        key={r.chuyen}
                        className={active ? "row-active" : ""}
                        onClick={async () => {
                          setSelectedChuyen(r.chuyen);
                          await loadDetail(date, r.chuyen);
                        }}
                      >
                        <td className="mono">{r.chuyen}</td>
                        <td className="mono">{r.maHang}</td>
                        <td>{fmtPercent(r.hsDat)}</td>
                        <td>{fmtPercent(r.hsDinhMuc)}</td>
                        <td>
                          <span className={clsStatus(r.status)}>{r.status}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT */}
        <section className="card">
          <div className="card-hd">
            <div>
              <div className="card-title">
                So sánh lũy tiến theo giờ (chuyền: <span className="mono">{selectedChuyen || "—"}</span>)
              </div>
              <div className="card-sub">
                Mã hàng: <b className="mono">{selectedMaHang}</b>
              </div>
            </div>

            <div className="chips">
              {(daily?.rows || []).map((r) => (
                <button
                  key={r.chuyen}
                  className={
                    String(r.chuyen).toUpperCase() === String(selectedChuyen).toUpperCase()
                      ? "chip chip-on"
                      : "chip"
                  }
                  onClick={async () => {
                    setSelectedChuyen(r.chuyen);
                    await loadDetail(date, r.chuyen);
                  }}
                >
                  {r.chuyen}
                </button>
              ))}
            </div>
          </div>

          <div className="kpi-mini">
            <div className="mini">
              <div className="mini-lb">DM/H</div>
              <div className="mini-val">{detail?.dmH ?? "—"}</div>
            </div>
            <div className="mini">
              <div className="mini-lb">DM/NGÀY</div>
              <div className="mini-val">{detail?.dmNgay ?? "—"}</div>
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
                {!detail?.steps?.length ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Chưa chọn chuyền / không có dữ liệu
                    </td>
                  </tr>
                ) : (
                  detail.steps.map((s) => (
                    <tr key={s.moc}>
                      <td className="mono">{s.moc}</td>
                      <td>{s.luyTien ?? "—"}</td>
                      <td>{s.dmLuyTien ?? "—"}</td>
                      <td className={typeof s.chenh === "number" ? (s.chenh >= 0 ? "ok" : "bad") : ""}>
                        {s.chenh ?? "—"}
                      </td>
                      <td>
                        <span className={clsStatus(s.status === "THIẾU" ? "CHƯA ĐẠT" : s.status)}>{s.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}