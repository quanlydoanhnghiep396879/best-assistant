"use client";

import { useEffect, useMemo, useState } from "react";

const HS_TARGET = 90; // 90%

const SLOT_INDEX = {
  "->9H": 1,
  "->10H": 2,
  "->11H": 3,
  "->12H30": 4,
  "->13H30": 5,
  "->14H30": 6,
  "->15H30": 7,
  "->16H30": 8,
};

function slotIndex(label) {
  const k = String(label || "").replace(/\s+/g, "").toUpperCase();
  return SLOT_INDEX[k] ?? null;
}

function fmtPct(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x.toFixed(2)}%`;
}

function fmtNum(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return String(Math.round(x));
}

function statusClass(s) {
  const t = (s || "").toUpperCase();
  if (["VƯỢT", "VUOT", "ĐỦ", "DU", "ĐẠT", "DAT"].includes(t)) return "pill pill-ok";
  if (["THIẾU", "THIEU", "CHƯA ĐẠT", "CHUA DAT"].includes(t)) return "pill pill-bad";
  if (["CHƯA CÓ", "CHUA CO"].includes(t)) return "pill pill-warn";
  return "pill pill-na";
}

function calcDaily(lineObj, marks) {
  const dmDay = lineObj.dmDay || 0;
  if (!dmDay) return { hs: null, st: "CHƯA CÓ" };

  // ưu tiên ->16h30 nếu có
  const end =
    marks.find((m) => String(m).replace(/\s+/g, "").toUpperCase() === "->16H30") ||
    marks[marks.length - 1];

  const actual = end ? lineObj.hourly?.[end] : null;
  if (!actual || actual <= 0) return { hs: null, st: "CHƯA CÓ" };

  const hs = (actual / dmDay) * 100;
  if (hs >= 100) return { hs, st: "VƯỢT" };
  if (hs >= HS_TARGET) return { hs, st: "ĐẠT" };
  return { hs, st: "CHƯA ĐẠT" };
}

function calcHourlyRow(lineObj, label) {
  const actual = lineObj.hourly?.[label];
  const dmDay = lineObj.dmDay || 0;

  const idx = slotIndex(label);
  let expected = null;

  // expected = DM/NGÀY * (slot/8)
  if (dmDay > 0 && idx) expected = (dmDay * idx) / 8;

  if (expected === null || !Number.isFinite(expected) || expected <= 0) {
    return { actual, expected: null, diff: null, st: "N/A" };
  }

  const diff = Number(actual || 0) - expected;
  let st = "ĐỦ";
  if (diff > 0) st = "VƯỢT";
  else if (diff < 0) st = "THIẾU";

  return { actual, expected, diff, st };
}

export default function KpiDashboardClient() {
  const [cfg, setCfg] = useState([]);
  const [date, setDate] = useState("");
  const [auto, setAuto] = useState(true);
  const [lastUpdate, setLastUpdate] = useState("");
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState(null); // { lines, marks, cols... }
  const [pick, setPick] = useState("");
  const [q, setQ] = useState("");

  async function loadConfig() {
    const r = await fetch("/api/kpi-config", { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Load config failed");

    setCfg(j.items || []);
    if (!date && j.items?.[0]?.date) setDate(j.items[0].date);
  }

  async function loadData(forceDate) {
    const d = forceDate ?? date;
    if (!d) return;

    setLoading(true);
    try {
      const r = await fetch(`/api/check-kpi?date=${encodeURIComponent(d)}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Load data failed");

      setData(j);
      setLastUpdate(new Date().toLocaleString("vi-VN"));
      if (!pick && j.lines?.[0]?.line) setPick(j.lines[0].line);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => loadData().catch(console.error), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  const lines = data?.lines || [];
  const marks = data?.marks || [];

  const filteredLines = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return lines;
    return lines.filter(
      (x) =>
        (x.line || "").toUpperCase().includes(t) ||
        (x.maHang || "").toUpperCase().includes(t)
    );
  }, [q, lines]);

  const picked = useMemo(() => lines.find((x) => x.line === pick) || null, [lines, pick]);
  const pickedMaHang = picked?.maHang || "—";

  return (
    <div className="kpi-page">
      <div className="kpi-hero">
        <div className="kpi-title">KPI Dashboard</div>
        <div className="kpi-sub">Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>

        <div className="kpi-controls">
          <label className="kpi-label">Ngày:</label>

          <select
            className="kpi-select"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPick("");
              setData(null);
            }}
          >
            {cfg.map((x) => (
              <option key={x.date} value={x.date}>
                {x.date}
              </option>
            ))}
          </select>

          <button className="kpi-btn" onClick={() => loadData().catch(console.error)} disabled={loading}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label className="kpi-check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Tự cập nhật (1 phút)
          </label>

          <div className="kpi-update">
            Cập nhật: <span>{lastUpdate || "—"}</span>
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        {/* LEFT */}
        <div className="kpi-card">
          <div className="kpi-card-head">
            <div>
              <div className="kpi-card-title">So sánh hiệu suất ngày</div>
              <div className="kpi-card-note">Mốc cuối: -&gt;16h30</div>
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
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="kpi-empty">
                      Chưa có dữ liệu (bấm “Xem dữ liệu”)
                    </td>
                  </tr>
                ) : (
                  lines.map((x) => {
                    const { hs, st } = calcDaily(x, marks);
                    return (
                      <tr
                        key={x.line}
                        className={x.line === pick ? "row-active" : ""}
                        onClick={() => setPick(x.line)}
                        style={{ cursor: "pointer" }}
                      >
                        <td className="td-strong">{x.line}</td>
                        <td className="td-mh">{x.maHang || "—"}</td>
                        <td>{fmtPct(hs)}</td>
                        <td>{fmtPct(HS_TARGET)}</td>
                        <td>
                          <span className={statusClass(st)}>{st}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT */}
        <div className="kpi-card">
          <div className="kpi-card-head kpi-card-head-split">
            <div>
              <div className="kpi-card-title">
                So sánh lũy tiến theo giờ (chuyền: <span className="accent">{pick || "—"}</span>)
              </div>
              <div className="kpi-card-note">
                Mã hàng: <span className="accent">{pickedMaHang}</span>
              </div>
            </div>

            <input
              className="kpi-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm chuyền hoặc mã hàng..."
            />
          </div>

          <div className="kpi-chips">
            {filteredLines.map((x) => (
              <button
                key={x.line + (x.maHang || "")}
                className={`chip ${x.line === pick ? "chip-active" : ""}`}
                onClick={() => setPick(x.line)}
                title={x.maHang || ""}
              >
                {x.line}
              </button>
            ))}
          </div>

          <div className="kpi-mini">
            <div className="mini-card">
              <div className="mini-label">DM/H</div>
              <div className="mini-val">{picked ? fmtNum(picked.dmHour) : "—"}</div>
            </div>
            <div className="mini-card">
              <div className="mini-label">DM/NGÀY</div>
              <div className="mini-val">{picked ? fmtNum(picked.dmDay) : "—"}</div>
            </div>
          </div>

          <div className="kpi-table-wrap">
            <table className="kpi-table">
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
                {!picked ? (
                  <tr>
                    <td colSpan={5} className="kpi-empty">
                      Chưa chọn chuyền
                    </td>
                  </tr>
                ) : (
                  marks.map((m) => {
                    const r = calcHourlyRow(picked, m);
                    const diffText =
                      r.diff === null
                        ? "—"
                        : r.diff > 0
                        ? `+${fmtNum(r.diff)}`
                        : fmtNum(r.diff);

                    return (
                      <tr key={m}>
                        <td className="td-strong">{m}</td>
                        <td>{r.actual === null || r.actual === undefined ? "—" : fmtNum(r.actual)}</td>
                        <td>{r.expected === null ? "—" : fmtNum(r.expected)}</td>
                        <td>{diffText}</td>
                        <td>
                          <span className={statusClass(r.st)}>{r.st}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {data?.cols && (
            <div className="kpi-debug">
              Debug: headerRow={data.cols.headerRow}, CHUYỀN={data.cols.colLine}, MH={data.cols.colMaHang}, DM/NGÀY={data.cols.colDmDay}, DM/H={data.cols.colDmHour}, marks={marks.length}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
