// app/kpi/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./kpi.css";

/* ================= helpers ================= */
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ddmmyyyyFromISO(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function noMark(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();
}

function normLine(x) {
  const t = String(x || "").replace(/\u00A0/g, " ").trim().toUpperCase();
  if (t === "TONG HOP" || t === "TỔNG HỢP") return "TỔNG HỢP";
  const m = t.match(/^C\s*0*([0-9]+)$/);
  if (m) return `C${Number(m[1])}`;
  return t;
}

function sortLines(a, b) {
  const A = normLine(a);
  const B = normLine(b);

  if (A === "TỔNG HỢP" && B !== "TỔNG HỢP") return -1;
  if (B === "TỔNG HỢP" && A !== "TỔNG HỢP") return 1;

  const ma = A.match(/^C(\d+)$/);
  const mb = B.match(/^C(\d+)$/);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  if (ma && !mb) return -1;
  if (!ma && mb) return 1;

  return A.localeCompare(B, "vi");
}

function pillClass(status) {
  const s = noMark(status);
  // ĐẠT / VƯỢT
  if (s === "dat" || s === "vuot" || s === "vươt") return "pill pill-ok";
  // ĐỦ
  if (s === "du") return "pill pill-warn";
  // THIẾU / CHƯA ĐẠT
  return "pill pill-bad";
}

function n2(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

function n0(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x).toLocaleString("vi-VN") : "0";
}

/* ================= page ================= */
export default function KPIPage() {
  const [isoDate, setIsoDate] = useState(todayISO());
  const [line, setLine] = useState("TỔNG HỢP");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastAt, setLastAt] = useState("");

  const ddmmyyyy = useMemo(() => ddmmyyyyFromISO(isoDate), [isoDate]);
  const lineNorm = useMemo(() => normLine(line), [line]);

  // tránh race condition: request cũ về sau ghi đè request mới
  const reqIdRef = useRef(0);

  async function loadKPI({ silent = false } = {}) {
    if (!ddmmyyyy) return;

    const myId = ++reqIdRef.current;
    if (!silent) setLoading(true);
    setErr("");

    try {
      const qs = new URLSearchParams({
        date: ddmmyyyy,
        line: lineNorm,
        _ts: String(Date.now()), // cache-bust
      });

      const res = await fetch(`/api/check-kpi?${qs.toString()}`, {
        cache: "no-store",
      });

      const json = await res.json();
      if (myId !== reqIdRef.current) return; // bỏ response cũ

      if (!json?.ok) throw new Error(json?.error || "API error");
      setData(json);
      setLastAt(new Date().toLocaleTimeString("vi-VN"));
    } catch (e) {
      if (myId !== reqIdRef.current) return;
      setErr(e?.message || "Load failed");
      setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // load ngay khi đổi ngày / đổi chuyền (không cần nút refresh)
  useEffect(() => {
    loadKPI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddmmyyyy, lineNorm]);

  // auto refresh 15s
  useEffect(() => {
    const t = setInterval(() => loadKPI({ silent: true }), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddmmyyyy, lineNorm]);

  // lines cho dropdown (sort C1..C10)
  const lines = useMemo(() => {
    const arr = (data?.lines || []).map(normLine);
    const uniq = Array.from(new Set(arr));
    if (!uniq.includes("TỔNG HỢP")) uniq.unshift("TỔNG HỢP");
    return uniq.sort(sortLines);
  }, [data?.lines]);

  // nếu line hiện tại không có trong lines => reset về tổng hợp
  useEffect(() => {
    if (!lines.length) return;
    if (!lines.includes(lineNorm)) setLine("TỔNG HỢP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.join("|")]);

  const dailyRows = data?.dailyRows || [];
  const hourly = data?.hourly || null;

  return (
    <div className="kpi-wrap">
      <h1 className="kpi-title">KPI Dashboard</h1>
      <p className="kpi-sub">Chọn ngày và chuyền để xem dữ liệu</p>

      <div className="kpi-toolbar">
        <div className="kpi-field">
          <div className="kpi-label">Chọn ngày</div>
          <input
            className="kpi-input"
            type="date"
            value={isoDate}
            onChange={(e) => setIsoDate(e.target.value)}
          />
        </div>

        <div className="kpi-field">
          <div className="kpi-label">Chọn chuyền</div>
          <select
            className="kpi-select"
            value={lineNorm}
            onChange={(e) => setLine(e.target.value)}
          >
            {lines.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="kpi-status">
          {loading
            ? "Đang tải..."
            : err
            ? `Lỗi: ${err}`
            : `OK (auto 15s) • cập nhật: ${lastAt || "--:--:--"}`}
        </div>
      </div>

      <div className="kpi-grid">
        {/* ===== DAILY ===== */}
        <div className="kpi-card">
          <h3>Hiệu suất trong ngày (so với định mức)</h3>

          {!dailyRows.length ? (
            <div className="kpi-note">(Chưa có dữ liệu ngày này)</div>
          ) : (
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền/BP</th>
                  <th className="num">HS đạt (%)</th>
                  <th className="num">HS ĐM (%)</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td className="num">{n2(r.hsDat)}</td>
                    <td className="num">{n2(r.hsDm)}</td>
                    <td>
                      <span className={pillClass(r.status)}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="kpi-note">
            * So sánh: nếu <b>HS đạt ≥ HS ĐM</b> → <b>ĐẠT</b>, ngược lại <b>CHƯA ĐẠT</b>.
          </div>
        </div>

        {/* ===== HOURLY ===== */}
        <div className="kpi-card">
          <h3>Kiểm lũy tiến theo giờ (so với DM/H)</h3>

          {!hourly?.hours?.length ? (
            <div className="kpi-note">(Chưa có dữ liệu theo giờ cho chuyền/ngày này)</div>
          ) : (
            <>
              <div className="kpi-note" style={{ marginTop: 0 }}>
                DM/H: <b className="num">{n2(hourly.dmH)}</b>
              </div>

              <table className="kpi-table" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Giờ</th>
                    <th className="num">Tổng kiểm đạt</th>
                    <th className="num">DM lũy tiến</th>
                    <th className="num">Chênh</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {hourly.hours.map((h) => (
                    <tr key={h.label}>
                      <td>{h.label}</td>
                      <td className="num">{n0(h.total)}</td>

                      {/* ✅ đúng key API */}
                      <td className="num">{n0(h.dmLuyTien)}</td>

                      {/* ✅ đúng key API */}
                      <td className="num">{n0(h.delta)}</td>

                      <td>
                        <span className={pillClass(h.status)}>{h.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="kpi-note">
                * Mỗi giờ: <b>DM lũy tiến = DM/H × số mốc giờ</b> (→9h=1, →10h=2, →12h30=4.5, …).
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}