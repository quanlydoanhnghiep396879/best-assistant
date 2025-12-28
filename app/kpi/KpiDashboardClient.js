"use client";

import { useEffect, useMemo, useState } from "react";

function fmtPercent(x) {
  if (x === null || x === undefined) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}
function fmtNum(x) {
  if (x === null || x === undefined) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  // hiển thị kiểu VN
  return n.toLocaleString("vi-VN");
}

function badgeClass(text) {
  const t = String(text || "").toUpperCase();
  if (["VƯỢT", "ĐỦ", "ĐẠT"].includes(t)) return "badge badge-green";
  if (["THIẾU", "CHƯA ĐẠT", "CHƯA CÓ"].includes(t)) return "badge badge-red";
  return "badge badge-gray";
}

export default function KpiDashboardClient() {
  const [cfg, setCfg] = useState([]);
  const [dateKey, setDateKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true); // mặc định 1 phút
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  const [searchLine, setSearchLine] = useState("");
  const [selectedLineLabel, setSelectedLineLabel] = useState("");

  // load config
  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const res = await fetch("/api/kpi-config", { cache: "no-store" });
        const j = await res.json();
        if (j.status !== "ok") throw new Error(j.message || "Load config failed");
        setCfg(j.items || []);
        if ((j.items || []).length) setDateKey(j.items[0].dateKey);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
  }, []);

  async function fetchData(nextDateKey = dateKey) {
    if (!nextDateKey) return;
    setLoading(true);
    try {
      setErr("");
      const res = await fetch(`/api/check-kpi?date=${encodeURIComponent(nextDateKey)}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const j = await res.json();
      if (j.status !== "ok") throw new Error(j.message || "Load data failed");
      setData(j);

      // chọn line mặc định
      const first = (j.lines || [])[0];
      if (first) setSelectedLineLabel(first.lineLabel);
    } catch (e) {
      setErr(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // auto refresh 1 phút
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      fetchData(dateKey);
    }, 60_000);
    return () => clearInterval(id);
  }, [auto, dateKey]);

  const lines = data?.lines || [];

  const filteredLineChips = useMemo(() => {
    const q = searchLine.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((x) => String(x.lineLabel).toLowerCase().includes(q));
  }, [lines, searchLine]);

  const selectedLine = useMemo(() => {
    return lines.find((x) => x.lineLabel === selectedLineLabel) || null;
  }, [lines, selectedLineLabel]);

  return (
    <div className="wrap">
      <h1 className="title">KPI Dashboard</h1>
      <div className="sub">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>

      <div className="controls">
        <div className="row">
          <div className="field">
            <div className="label">Ngày:</div>
            <select value={dateKey} onChange={(e) => setDateKey(e.target.value)}>
              {cfg.map((x) => (
                <option key={x.dateKey} value={x.dateKey}>
                  {x.dateLabel}
                </option>
              ))}
            </select>
          </div>

          <button disabled={!dateKey || loading} onClick={() => fetchData(dateKey)}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="chk">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Tự cập nhật (1 phút)
          </label>

          <div className="muted">
            {data?.lastUpdated ? `Cập nhật: ${new Date(data.lastUpdated).toLocaleString("vi-VN")}` : ""}
          </div>
        </div>

        {err ? <div className="error">Lỗi: {err}</div> : null}
      </div>

      {/* 2 bảng trái/phải */}
      <div className="grid2">
        {/* LEFT */}
        <div className="card">
          <div className="cardTitle">
            <div>So sánh hiệu suất ngày</div>
            <div className="mutedSmall">Mốc cuối: -&gt;16h30</div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Chuyền</th>
                <th>HS đạt</th>
                <th>HS định mức</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((x) => (
                <tr key={x.lineLabel}>
                  <td className="bold">{x.lineLabel}</td>
                  <td>{fmtPercent(x.hsDay)}</td>
                  <td>{fmtPercent(x.hsTarget)}</td>
                  <td>
                    <span className={badgeClass(x.hsStatus)}>{x.hsStatus}</span>
                  </td>
                </tr>
              ))}
              {!lines.length ? (
                <tr>
                  <td colSpan={4} className="mutedSmall">
                    Chưa có dữ liệu.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* RIGHT */}
        <div className="card">
          <div className="cardTitle">
            <div>So sánh lũy tiến theo giờ (chuyền: {selectedLine ? selectedLine.lineLabel : "—"})</div>
          </div>

          <div className="linePick">
            <input
              value={searchLine}
              onChange={(e) => setSearchLine(e.target.value)}
              placeholder="Tìm chuyền..."
            />
            <div className="chips">
              {filteredLineChips.map((x) => (
                <button
                  key={x.lineLabel}
                  className={x.lineLabel === selectedLineLabel ? "chip chipActive" : "chip"}
                  onClick={() => setSelectedLineLabel(x.lineLabel)}
                >
                  {x.lineLabel}
                </button>
              ))}
            </div>
          </div>

          {selectedLine ? (
            <>
              <div className="dmRow">
                <div className="dmItem">
                  <span className="dmKey">DM/H:</span> <span className="dmVal">{fmtNum(selectedLine.dmHour)}</span>
                </div>
                <div className="dmItem">
                  <span className="dmKey">DM/NGÀY:</span> <span className="dmVal">{fmtNum(selectedLine.dmDay)}</span>
                </div>
              </div>

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
                  {(data?.marks || []).map((m) => {
                    const c = selectedLine.hourlyCompare?.[m];
                    const diff = c?.diff;
                    const status = c?.status || "N/A";
                    return (
                      <tr key={m}>
                        <td>{m}</td>
                        <td>{fmtNum(c?.actual)}</td>
                        <td>{fmtNum(c?.target)}</td>
                        <td>{diff === null || diff === undefined ? "—" : (diff >= 0 ? `+${fmtNum(diff)}` : fmtNum(diff))}</td>
                        <td>
                          <span className={badgeClass(status)}>{status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <div className="mutedSmall">Chưa chọn chuyền.</div>
          )}
        </div>
      </div>

      <style jsx>{`
        .wrap { padding: 18px; }
        .title { font-size: 40px; margin: 0 0 6px; font-weight: 800; }
        .sub { margin: 0 0 14px; color: #333; }
        .controls { margin-bottom: 14px; }
        .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .field { display: flex; align-items: center; gap: 8px; }
        .label { font-weight: 700; }
        select { padding: 8px 10px; border-radius: 10px; border: 1px solid #ddd; min-width: 170px; }
        button { padding: 9px 14px; border-radius: 10px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .chk { display: flex; align-items: center; gap: 8px; }
        .muted { color: #666; font-size: 14px; }
        .mutedSmall { color: #666; font-size: 13px; margin-top: 6px; }
        .error { margin-top: 8px; color: #c00; font-weight: 700; }

        /* LUÔN chia 2 cột trên desktop */
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
        @media (max-width: 980px) { .grid2 { grid-template-columns: 1fr; } }

        .card { border: 1px solid #e6e6e6; border-radius: 14px; padding: 12px; background: #fff; }
        .cardTitle { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-weight: 800; margin-bottom: 10px; }
        .table { width: 100%; border-collapse: collapse; }
        .table th { text-align: left; border-bottom: 1px solid #eee; padding: 10px 8px; font-size: 14px; }
        .table td { border-bottom: 1px solid #f2f2f2; padding: 10px 8px; font-size: 14px; }
        .bold { font-weight: 800; }

        .badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-weight: 800; font-size: 12px; border: 1px solid transparent; }
        .badge-green { background: #eaffea; color: #0a7a0a; border-color: #95e095; }
        .badge-red { background: #ffecec; color: #b30000; border-color: #ff9f9f; }
        .badge-gray { background: #f1f1f1; color: #444; border-color: #ddd; }

        .linePick input { width: 220px; padding: 8px 10px; border-radius: 10px; border: 1px solid #ddd; }
        .chips { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
        .chip { padding: 6px 10px; border-radius: 999px; border: 1px solid #cfcfcf; background: #fff; cursor: pointer; font-weight: 800; }
        .chipActive { background: #111; color: #fff; border-color: #111; }

        .dmRow { margin: 10px 0 6px; display: flex; gap: 14px; flex-wrap: wrap; }
        .dmItem { font-weight: 800; }
        .dmKey { color: #333; }
        .dmVal { color: #111; }
      `}</style>
    </div>
  );
}
