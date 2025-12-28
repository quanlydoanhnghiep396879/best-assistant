"use client";

import React, { useEffect, useMemo, useState } from "react";

const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];

function fmtPercent(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)}%`;
}
function fmtNum(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  // hiển thị đẹp kiểu số nguyên nếu gần nguyên
  const isInt = Math.abs(x - Math.round(x)) < 1e-9;
  return isInt ? String(Math.round(x)) : x.toFixed(2);
}

function badgeToneForHs(hsStatus) {
  if (hsStatus === "ĐẠT") return "good";
  if (hsStatus === "CHƯA ĐẠT") return "bad";
  return "neutral";
}
function badgeToneForStep(stepStatus) {
  if (stepStatus === "VƯỢT" || stepStatus === "ĐỦ" || stepStatus === "ĐẠT") return "good";
  if (stepStatus === "THIẾU" || stepStatus === "CHƯA ĐẠT") return "bad";
  return "neutral";
}

function Badge({ tone = "neutral", children }) {
  return <span className={`kpi-badge kpi-badge--${tone}`}>{children}</span>;
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  const [lineSearch, setLineSearch] = useState("");
  const [selectedLine, setSelectedLine] = useState("");

  async function loadDates() {
    try {
      setErr("");
      const res = await fetch("/api/kpi-config", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const list = Array.isArray(json) ? json : json?.dates || json?.items || [];
      setDates(list);
      if (!date && list.length) setDate(list[0]);
    } catch (e) {
      // không có endpoint thì thôi, user vẫn có thể nhập date (nhưng bạn đang có dropdown nên thường OK)
      console.error(e);
    }
  }

  async function loadData(d) {
    if (!d) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Load failed");
      setData(json);

      // set line mặc định
      const firstLine = json?.lines?.[0]?.line || "";
      setSelectedLine((prev) => prev || firstLine);
    } catch (e) {
      setErr(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDates();
  }, []);

  useEffect(() => {
    loadData(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    if (!auto || !date) return;
    const t = setInterval(() => loadData(date), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const lines = data?.lines || [];

  const filteredLines = useMemo(() => {
    const q = lineSearch.trim().toUpperCase();
    if (!q) return lines;
    return lines.filter((x) => (x.line || "").toUpperCase().includes(q) || (x.maHang || "").toUpperCase().includes(q));
  }, [lines, lineSearch]);

  const selected = useMemo(() => {
    return lines.find((x) => x.line === selectedLine) || filteredLines[0] || null;
  }, [lines, selectedLine, filteredLines]);

  const updateAt = useMemo(() => {
    const now = new Date();
    return now.toLocaleString();
  }, [data]);

  return (
    <div className="kpi-page">
      <div className="kpi-top">
        <div>
          <div className="kpi-title">KPI Dashboard</div>
          <div className="kpi-sub">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>
        </div>

        <div className="kpi-controls">
          <label className="kpi-label">Ngày:</label>
          <select className="kpi-select" value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <button className="kpi-btn" onClick={() => loadData(date)} disabled={loading || !date}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="kpi-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Tự cập nhật (1 phút)</span>
          </label>

          <div className="kpi-muted">Cập nhật: {updateAt}</div>
        </div>

        {err ? <div className="kpi-error">Lỗi: {err}</div> : null}
      </div>

      <div className="kpi-grid">
        {/* LEFT: Hiệu suất ngày */}
        <section className="kpi-card">
          <div className="kpi-card-h">
            <div>
              <div className="kpi-card-title">So sánh hiệu suất ngày</div>
              <div className="kpi-card-sub">Mốc cuối: {MARKS[MARKS.length - 1]}</div>
            </div>
          </div>

          <div className="kpi-table-wrap">
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
                {lines.map((x) => (
                  <tr
                    key={x.line}
                    className={x.line === selectedLine ? "is-active" : ""}
                    onClick={() => setSelectedLine(x.line)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="kpi-strong">{x.line}</td>
                    <td className="kpi-code">{x.maHang || "—"}</td>
                    <td>{fmtPercent(x.hsDay)}</td>
                    <td>{fmtPercent(x.hsTarget)}</td>
                    <td>
                      <Badge tone={badgeToneForHs(x.hsStatus)}>{x.hsStatus}</Badge>
                    </td>
                  </tr>
                ))}
                {!lines.length ? (
                  <tr>
                    <td colSpan={5} className="kpi-empty">
                      Không có dữ liệu
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT: Lũy tiến theo giờ */}
        <section className="kpi-card">
          <div className="kpi-card-h kpi-card-h--split">
            <div>
              <div className="kpi-card-title">
                So sánh lũy tiến theo giờ (chuyền: <span className="kpi-accent">{selected?.line || "—"}</span>)
              </div>
              <div className="kpi-card-sub">
                Mã hàng: <span className="kpi-code">{selected?.maHang || "—"}</span>
                {selected?.chungLoai ? (
                  <>
                    {" "}
                    • Chủng loại: <span className="kpi-code">{selected?.chungLoai}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="kpi-right-tools">
              <input
                className="kpi-search"
                placeholder="Tìm chuyền hoặc mã hàng..."
                value={lineSearch}
                onChange={(e) => setLineSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="kpi-chips">
            {filteredLines.map((x) => (
              <button
                key={x.line}
                className={`kpi-chip ${x.line === selected?.line ? "is-active" : ""}`}
                onClick={() => setSelectedLine(x.line)}
                title={x.maHang || ""}
              >
                {x.line}
              </button>
            ))}
          </div>

          <div className="kpi-kpis">
            <div className="kpi-kpi">
              <div className="kpi-kpi-label">ĐM/H</div>
              <div className="kpi-kpi-val">{fmtNum(selected?.dmHour)}</div>
            </div>
            <div className="kpi-kpi">
              <div className="kpi-kpi-label">ĐM/NGÀY</div>
              <div className="kpi-kpi-val">{fmtNum(selected?.dmDay)}</div>
            </div>
          </div>

          <div className="kpi-table-wrap">
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
                {MARKS.map((m) => {
                  const v = selected?.hourly?.[m] ?? null;
                  const dm = selected?.dmCum?.[m] ?? null;
                  const df = selected?.diff?.[m] ?? null;
                  const st = selected?.status?.[m] ?? "N/A";
                  return (
                    <tr key={m}>
                      <td className="kpi-strong">{m}</td>
                      <td>{fmtNum(v)}</td>
                      <td>{fmtNum(dm)}</td>
                      <td>{typeof df === "number" ? (df >= 0 ? `+${fmtNum(df)}` : fmtNum(df)) : "—"}</td>
                      <td>
                        <Badge tone={badgeToneForStep(st)}>{st}</Badge>
                      </td>
                    </tr>
                  );
                })}
                {!selected ? (
                  <tr>
                    <td colSpan={5} className="kpi-empty">
                      Chưa chọn chuyền
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
