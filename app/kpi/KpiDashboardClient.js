"use client";

import { useEffect, useMemo, useState } from "react";
import "./kpi.css";

const MARKS = ["->9h", "->10h", "->11h", "->12h30", "->13h30", "->14h30", "->15h30", "->16h30"];
const HOURS_BY_MARK = {
  "->9h": 1,
  "->10h": 2,
  "->11h": 3,
  "->12h30": 4,
  "->13h30": 5,
  "->14h30": 6,
  "->15h30": 7,
  "->16h30": 8,
};

const fmtPct = (v) => (typeof v === "number" && isFinite(v) ? `${(v * 100).toFixed(2)}%` : "—");
const fmtNum = (v) => (typeof v === "number" && isFinite(v) ? `${v}` : "—");

function badgeTone(status) {
  const s = (status || "").toUpperCase();
  if (["VƯỢT", "ĐỦ", "ĐẠT"].includes(s)) return "good";
  if (["THIẾU", "CHƯA ĐẠT"].includes(s)) return "bad";
  if (["CHƯA CÓ", "N/A"].includes(s)) return "neutral";
  return "neutral";
}

function calcHsStatus(hsDay, hsTarget) {
  if (!(typeof hsDay === "number" && isFinite(hsDay))) return "CHƯA CÓ";
  const target = typeof hsTarget === "number" && isFinite(hsTarget) ? hsTarget : 0.9;
  return hsDay >= target ? "ĐẠT" : "CHƯA ĐẠT";
}

function calcDmHour(dmHour, dmDay) {
  if (typeof dmHour === "number" && isFinite(dmHour) && dmHour > 0) return dmHour;
  if (typeof dmDay === "number" && isFinite(dmDay) && dmDay > 0) return dmDay / 8;
  return null;
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [data, setData] = useState(null);
  const [selectedLine, setSelectedLine] = useState("");
  const [q, setQ] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  // Load config dates
  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const res = await fetch("/api/kpi-config", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || "Không đọc được config");
        const list = json?.dates || [];
        setDates(list);
        if (!date && list.length) setDate(list[0]);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    if (!date) return;
    try {
      setLoading(true);
      setErr("");
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Lỗi đọc KPI");
      setData(json);

      // chọn line mặc định
      const lines = json?.lines || [];
      if (!selectedLine && lines.length) setSelectedLine(lines[0]?.line || "");
      setLastUpdated(new Date());
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // Auto refresh mỗi 60s
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      fetchData();
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, date]);

  const lines = useMemo(() => {
    return Array.isArray(data?.lines) ? data.lines : [];
  }, [data]);

  const lineNames = useMemo(() => lines.map((x) => x?.line).filter(Boolean), [lines]);

  const filteredLineNames = useMemo(() => {
    const kw = q.trim().toUpperCase();
    if (!kw) return lineNames;
    return lineNames.filter((name) => String(name).toUpperCase().includes(kw));
  }, [lineNames, q]);

  const selected = useMemo(() => {
    return lines.find((x) => x?.line === selectedLine) || null;
  }, [lines, selectedLine]);

  const rightTableRows = useMemo(() => {
    if (!selected) return [];
    const dmDay = selected?.dmDay;
    const dmHourRaw = selected?.dmHour;
    const dmHour = calcDmHour(dmHourRaw, dmDay);

    const hourly = selected?.hourly || {}; // { "->9h": 54, ... } (lũy tiến)
    return MARKS.map((m) => {
      const actual = typeof hourly?.[m] === "number" && isFinite(hourly[m]) ? hourly[m] : null;

      const h = HOURS_BY_MARK[m] ?? null;
      const dmCum = dmHour && h ? Math.round(dmHour * h) : null;

      let diff = null;
      let st = "N/A";

      if (actual != null && dmCum != null) {
        diff = actual - dmCum;
        if (diff === 0) st = "ĐỦ";
        else if (diff > 0) st = "VƯỢT";
        else st = "THIẾU";
      }

      return { mark: m, actual, dmCum, diff, status: st };
    });
  }, [selected]);

  const dmHourShow = selected ? calcDmHour(selected?.dmHour, selected?.dmDay) : null;

  return (
    <div className="kpiPage">
      <div className="kpiHeader">
        <div>
          <div className="kpiTitle">KPI Dashboard</div>
          <div className="kpiSubtitle">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>
        </div>

        <div className="kpiControls">
          <label className="kpiLabel">
            Ngày:
            <select className="kpiSelect" value={date} onChange={(e) => setDate(e.target.value)}>
              <option value="">-- Chọn ngày --</option>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <button className="kpiBtn" onClick={fetchData} disabled={!date || loading}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="kpiToggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Tự cập nhật (1 phút)
          </label>

          <div className="kpiUpdated">
            {lastUpdated ? `Cập nhật: ${lastUpdated.toLocaleTimeString()} ${lastUpdated.toLocaleDateString()}` : ""}
          </div>
        </div>

        {err ? <div className="kpiError">Lỗi: {err}</div> : null}
      </div>

      {/* ===== 2 BẢNG NẰM NGANG: TRÁI (HS) – PHẢI (LŨY TIẾN) ===== */}
      <div className="kpiGrid">
        {/* LEFT: HS */}
        <section className="kpiCard">
          <div className="kpiCardHeader">
            <div className="kpiCardTitle">So sánh hiệu suất ngày</div>
            <div className="kpiHint">Mốc cuối: -&gt;16h30</div>
          </div>

          <div className="kpiTableWrap">
            <table className="kpiTable">
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>HS đạt</th>
                  <th>HS định mức</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((x) => {
                  const hsDay = x?.hsDay ?? null;
                  const hsTarget = x?.hsTarget ?? 0.9;
                  const hsStatus = x?.hsStatus || calcHsStatus(hsDay, hsTarget);

                  return (
                    <tr key={x?.line || Math.random()}>
                      <td className="kpiStrong">{x?.line || "—"}</td>
                      <td>{fmtPct(hsDay)}</td>
                      <td>{fmtPct(hsTarget)}</td>
                      <td>
                        <span className={`badge badge--${badgeTone(hsStatus)}`}>{hsStatus}</span>
                      </td>
                    </tr>
                  );
                })}
                {!lines.length ? (
                  <tr>
                    <td colSpan={4} className="kpiEmpty">
                      Chưa có dữ liệu. Hãy chọn ngày rồi bấm “Xem dữ liệu”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT: Lũy tiến */}
        <section className="kpiCard">
          <div className="kpiCardHeader">
            <div className="kpiCardTitle">So sánh lũy tiến theo giờ (chuyền: {selectedLine || "—"})</div>
          </div>

          <div className="kpiRightTop">
            <input
              className="kpiSearch"
              placeholder="Tìm chuyền..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <div className="kpiChips">
              {filteredLineNames.map((name) => {
                const active = name === selectedLine;
                return (
                  <button
                    key={name}
                    className={`chip ${active ? "chip--active" : ""}`}
                    onClick={() => setSelectedLine(name)}
                    type="button"
                  >
                    {name}
                  </button>
                );
              })}
            </div>

            <div className="kpiMeta">
              <span>
                <b>DM/H:</b> {dmHourShow != null ? dmHourShow.toFixed(2) : "—"}
              </span>
              <span className="kpiDot">•</span>
              <span>
                <b>DM/NGÀY:</b> {fmtNum(selected?.dmDay)}
              </span>
            </div>
          </div>

          <div className="kpiTableWrap">
            <table className="kpiTable">
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
                {rightTableRows.map((r) => (
                  <tr key={r.mark}>
                    <td className="kpiStrong">{r.mark}</td>
                    <td>{fmtNum(r.actual)}</td>
                    <td>{fmtNum(r.dmCum)}</td>
                    <td className={typeof r.diff === "number" ? (r.diff >= 0 ? "kpiPos" : "kpiNeg") : ""}>
                      {typeof r.diff === "number" ? `${r.diff >= 0 ? "+" : ""}${r.diff}` : "—"}
                    </td>
                    <td>
                      <span className={`badge badge--${badgeTone(r.status)}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
                {!selected ? (
                  <tr>
                    <td colSpan={5} className="kpiEmpty">
                      Chưa chọn chuyền.
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
