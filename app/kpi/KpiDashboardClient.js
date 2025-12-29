"use client";

import { useEffect, useMemo, useState } from "react";

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [lines, setLines] = useState([]);
  const [meta, setMeta] = useState(null);

  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterStatus, setFilterStatus] = useState("ALL"); // ALL | DAT | KHONGDAT
  const [q, setQ] = useState("");

  const [err, setErr] = useState("");

  // ===== helper fetch JSON =====
  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    return j;
  }

  // ===== 1) Load danh sách ngày =====
  async function loadDates() {
    try {
      setErr("");
      setLoadingConfig(true);
      const j = await fetchJson("/api/kpi-config?list=1");

      if (!j?.ok) throw new Error(j?.message || j?.error || "KPI_CONFIG_ERROR");

      const ds = Array.isArray(j.dates) ? j.dates : [];
      setDates(ds);

      // auto chọn ngày đầu tiên nếu chưa chọn
      if (!date && ds.length) setDate(ds[0]);
    } catch (e) {
      setErr(String(e?.message || e));
      setDates([]);
    } finally {
      setLoadingConfig(false);
    }
  }

  // ===== 2) Load dữ liệu KPI theo ngày =====
  async function loadKpi(selectedDate) {
    if (!selectedDate) return;
    try {
      setErr("");
      setLoadingData(true);

      const j = await fetchJson(`/api/check-kpi?date=${encodeURIComponent(selectedDate)}`);

      if (!j?.ok) throw new Error(j?.message || j?.error || "CHECK_KPI_ERROR");

      setLines(Array.isArray(j.lines) ? j.lines : []);
      setMeta(j.meta || null);
    } catch (e) {
      setErr(String(e?.message || e));
      setLines([]);
      setMeta(null);
    } finally {
      setLoadingData(false);
    }
  }

  // load config 1 lần khi mở trang
  useEffect(() => {
    loadDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // khi đổi ngày -> load KPI
  useEffect(() => {
    if (!date) return;
    loadKpi(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // auto refresh mỗi 60s
  useEffect(() => {
    if (!autoRefresh || !date) return;
    const id = setInterval(() => {
      loadKpi(date);
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, date]);

  // ===== thống kê =====
  const stats = useMemo(() => {
    let dat = 0;
    let khong = 0;
    for (const x of lines) {
      if (x?.status === "ĐẠT") dat++;
      else if (x?.status === "KHÔNG ĐẠT") khong++;
    }
    return { total: lines.length, dat, khong };
  }, [lines]);

  // ===== filter/search =====
  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();

    return lines.filter((x) => {
      if (!x) return false;

      if (filterStatus === "DAT" && x.status !== "ĐẠT") return false;
      if (filterStatus === "KHONGDAT" && x.status !== "KHÔNG ĐẠT") return false;

      if (!keyword) return true;

      const s = `${x.line || ""} ${x.mh || ""} ${x.status || ""}`.toLowerCase();
      return s.includes(keyword);
    });
  }, [lines, filterStatus, q]);

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 12 }}>KPI Dashboard</h2>

      {/* Lỗi */}
      {err && (
        <div style={{ background: "#ffe7e7", border: "1px solid #ffb3b3", padding: 10, borderRadius: 8, marginBottom: 12 }}>
          <b>Lỗi:</b> {err}
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
            Gợi ý: mở thử <code>/api/check-kpi?date=...</code> để xem JSON có <code>ok:true</code> và <code>lines</code> không.
          </div>
        </div>
      )}

      {/* Control bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Ngày</div>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={loadingConfig || dates.length === 0}
            style={{ padding: 8, minWidth: 180 }}
          >
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Lọc trạng thái</div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: 8, minWidth: 160 }}>
            <option value="ALL">Tất cả</option>
            <option value="DAT">ĐẠT</option>
            <option value="KHONGDAT">KHÔNG ĐẠT</option>
          </select>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Tìm (chuyền / MH)</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="VD: C1 / 088AG / Baby Carrier..."
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Tự cập nhật (1 phút)
        </label>

        <button
          onClick={() => loadKpi(date)}
          disabled={!date || loadingData}
          style={{ padding: "8px 12px", cursor: "pointer" }}
        >
          {loadingData ? "Đang tải..." : "Refresh"}
        </button>

        <button
          onClick={() => loadDates()}
          disabled={loadingConfig}
          style={{ padding: "8px 12px", cursor: "pointer" }}
        >
          {loadingConfig ? "Đang tải..." : "Reload ngày"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <StatCard title="Tổng dòng" value={stats.total} />
        <StatCard title="ĐẠT" value={stats.dat} />
        <StatCard title="KHÔNG ĐẠT" value={stats.khong} />
        <StatCard title="Đang hiển thị" value={filtered.length} />
      </div>

      {/* Table */}
      <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: 10, background: "#f7f7f7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b>Bảng KPI</b>
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            {date ? `Ngày: ${date}` : "Chưa chọn ngày"}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Chuyền</Th>
                <Th>MH</Th>
                <Th>AFTER 16H30</Th>
                <Th>DM/NGÀY</Th>
                <Th>%</Th>
                <Th>Trạng thái</Th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((x, i) => (
                <tr key={`${x.line}-${i}`} style={{ borderTop: "1px solid #eee" }}>
                  <Td>{x.line}</Td>
                  <Td>{x.mh}</Td>
                  <Td>{fmtNum(x.hs_dat)}</Td>
                  <Td>{fmtNum(x.hs_dm)}</Td>
                  <Td>{fmtNum(x.percent)}</Td>
                  <Td>
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        fontSize: 12,
                        border: "1px solid #ddd",
                        background: x.status === "ĐẠT" ? "#e8fff0" : "#fff2e8",
                      }}
                    >
                      {x.status}
                    </span>
                  </Td>
                </tr>
              ))}

              {!loadingData && filtered.length === 0 && (
                <tr>
                  <Td colSpan={6} style={{ textAlign: "center", padding: 18, opacity: 0.75 }}>
                    Không có dữ liệu để hiển thị.
                  </Td>
                </tr>
              )}

              {loadingData && (
                <tr>
                  <Td colSpan={6} style={{ textAlign: "center", padding: 18, opacity: 0.75 }}>
                    Đang tải dữ liệu...
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Debug meta (ẩn/hiện nếu bạn muốn) */}
      {meta && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer" }}>Debug (meta)</summary>
          <pre style={{ whiteSpace: "pre-wrap", background: "#111", color: "#0f0", padding: 12, borderRadius: 8 }}>
            {JSON.stringify(meta, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ===== UI helpers =====
function StatCard({ title, value }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, minWidth: 140 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th style={{ textAlign: "left", padding: 10, fontSize: 12, opacity: 0.85, background: "#fafafa" }}>
      {children}
    </th>
  );
}

function Td({ children, ...props }) {
  return (
    <td style={{ padding: 10, fontSize: 14 }} {...props}>
      {children}
    </td>
  );
}

function fmtNum(v) {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("vi-VN");
}