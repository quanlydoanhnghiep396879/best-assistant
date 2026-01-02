// app/kpi/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./kpi.css";

// ===== helpers =====
function isoToDDMMYYYY(iso) {
  // iso: YYYY-MM-DD
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v)
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/%/g, "")
    .replace(/,/g, "")
    .replace(/^'+/, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function upperNoDiacritic(str) {
  // bỏ dấu + normalize để so status
  const s = String(str ?? "")
    .replace(/\u00A0/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return s.toUpperCase();
}

function pillClass(status) {
  const s = upperNoDiacritic(status);
  // xanh
  if (s === "DAT" || s === "VUOT" || s === "DU") return "pill pill-ok";
  // đỏ
  if (s === "THIEU" || s === "CHUA DAT") return "pill pill-bad";
  // mặc định
  return "pill pill-warn";
}

function fmt0(n) {
  const x = toNum(n);
  return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmt2(n) {
  const x = toNum(n);
  return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ->9h, ->12h30 ...
function labelToHourValue(label) {
  const s = String(label || "").replace(/\s+/g, "").toLowerCase();
  // match "->12h30" or "->9h"
  const m = s.match(/(\d{1,2})h(\d{2})?/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh + mm / 60;
}

function calcMultiplierFromLabel(label) {
  // theo quy ước của bạn: ->9h = 1  => base = 8.0
  const t = labelToHourValue(label);
  if (t === null) return 0;
  const mult = t - 8.0;
  return mult > 0 ? mult : 0;
}

function getDailyStatus(row) {
  // ưu tiên status từ API, nếu không có thì tự so
  if (row?.status) return row.status;
  const hsDat = toNum(row?.hsDat);
  const hsDm = toNum(row?.hsDm);
  if (hsDat >= hsDm) return "ĐẠT";
  return "CHƯA ĐẠT";
}

function getHourlyStatus(diff) {
  return toNum(diff) >= 0 ? "VƯỢT" : "THIẾU";
}

export default function KPIPage() {
  const [isoDate, setIsoDate] = useState(todayISO());
  const [line, setLine] = useState("TỔNG HỢP");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastAt, setLastAt] = useState(null);

  const ddmmyyyy = useMemo(() => isoToDDMMYYYY(isoDate), [isoDate]);

  const abortRef = useRef(null);
  const inFlightRef = useRef(false);

  async function loadKPI({ silent = false } = {}) {
    if (!ddmmyyyy) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    if (!silent) setLoading(true);
    setErr("");

    try {
      // hủy request cũ nếu có
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const qs = new URLSearchParams({
        date: ddmmyyyy,       // dd/MM/yyyy
        line: line || "TỔNG HỢP",
        _ts: String(Date.now()) // chống cache
      });

      const res = await fetch(`/api/check-kpi?${qs.toString()}`, {
        cache: "no-store",
        signal: ac.signal,
      });

      const ct = res.headers.get("content-type") || "";
      const json = ct.includes("application/json") ? await res.json() : null;

      if (!res.ok) throw new Error(json?.error || HTTP `${res.status}`);
      if (!json?.ok) throw new Error(json?.error || "API error");

      setData(json);
      setLastAt(new Date());
    } catch (e) {
      if (e?.name !== "AbortError") {
        setErr(e?.message || "Load failed");
        setData(null);
      }
    } finally {
      inFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }

  // load khi đổi ngày / đổi chuyền
  useEffect(() => {
    loadKPI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddmmyyyy, line]);

  // auto refresh mỗi 15s
  useEffect(() => {
    const t = setInterval(() => loadKPI({ silent: true }), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddmmyyyy, line]);

  // lines cho dropdown
  const lines = useMemo(() => {
    const arr = Array.isArray(data?.lines) ? data.lines : [];
    const uniq = Array.from(new Set(arr.map(x => String(x || "").trim()).filter(Boolean)));
    if (!uniq.some(x => upperNoDiacritic(x) === "TONG HOP")) uniq.unshift("TỔNG HỢP");
    return uniq;
  }, [data?.lines]);

  // nếu line đang chọn không tồn tại trong list thì reset
  useEffect(() => {
    if (!lines.length) return;
    const ok = lines.some((x) => upperNoDiacritic(x) === upperNoDiacritic(line));
    if (!ok) setLine("TỔNG HỢP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.join("|")]);

  const dailyRowsRaw = Array.isArray(data?.dailyRows) ? data.dailyRows : [];
  const hourlyRaw = data?.hourly || null;

  // ===== build DAILY rows (fallback status) =====
  const dailyRows = useMemo(() => {
    return dailyRowsRaw
      .map(r => ({
        line: r?.line ?? "",
        hsDat: toNum(r?.hsDat),
        hsDm: toNum(r?.hsDm),
        status: getDailyStatus(r),
      }))
      .filter(r => String(r.line || "").trim() !== "");
  }, [dailyRowsRaw]);

  // ===== build HOURLY rows (fallback dmTarget/diff/status) =====
  const hourly = useMemo(() => {
    if (!hourlyRaw) return null;

    const dmH = toNum(hourlyRaw.dmH);
    const hoursRaw = Array.isArray(hourlyRaw.hours) ? hourlyRaw.hours : [];

    const hours = hoursRaw.map((h) => {
      const label = String(h?.label ?? "");
      const total = toNum(h?.total);

      const mult = calcMultiplierFromLabel(label);
      const dmTarget = toNum(h?.dmTarget) || (dmH * mult);
      const diff = toNum(h?.diff) || (total - dmTarget);

      const status = h?.status || getHourlyStatus(diff);

      return { label, total, dmTarget, diff, status };
    });

    return {
      line: hourlyRaw.line || "TỔNG HỢP",
      dmH,
      hours,
    };
  }, [hourlyRaw]);

  const apiChosenDate = data?.chosenDate || ""; // để bạn check: chọn 23 mà api trả 24 sẽ thấy ở đây

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
            value={line}
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
              : `OK (auto 15s) • UI date=${ddmmyyyy}${apiChosenDate ? ` • API chosenDate=${apiChosenDate}` : ""}${lastAt ? ` • ${lastAt.toLocaleTimeString()}` : ""}`}
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
                    <td className="num">{fmt2(r.hsDat)}</td>
                    <td className="num">{fmt2(r.hsDm)}</td>
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
                DM/H: <b className="num">{fmt2(hourly.dmH)}</b>
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
                      <td className="num">{fmt0(h.total)}</td>
                      <td className="num">{fmt0(h.dmTarget)}</td>
                      <td className="num">{fmt0(h.diff)}</td>
                      <td>
                        <span className={pillClass(h.status)}>{h.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="kpi-note">
                * Tự tính nếu API thiếu: <b>DM lũy tiến = DM/H × (giờ - 8)</b>
                (→9h=1, →10h=2, →12h30=4.5, …). <b>Chênh = Tổng - DM lũy tiến</b>.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}