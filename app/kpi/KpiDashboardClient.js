"use client";

import { useEffect, useMemo, useState } from "react";

function safeDate(d) {
  // nhận DD/MM/YYYY
  if (!d) return "";
  const s = String(d).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return s;
}

export default function KpiDashboardClient({ initialQuery }) {
  const [date, setDate] = useState(safeDate(initialQuery?.date || ""));
  const [status, setStatus] = useState(initialQuery?.status || "all");
  const [q, setQ] = useState(initialQuery?.q || "");
  const [auto, setAuto] = useState(initialQuery?.auto !== "0");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  async function load() {
    try {
      setLoading(true);
      setErr("");

      const qs = new URLSearchParams();
      if (date) qs.set("date", date);

      const res = await fetch(`/api/check-kpi?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();

      if (!json?.ok) {
        setErr(json?.message || "CHECK_KPI_ERROR");
        setData(null);
      } else {
        setData(json);
      }
    } catch (e) {
      setErr(String(e?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // initial

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [auto, date]);

  const filtered = useMemo(() => {
    const lines = data?.lines || [];
    const qq = q.trim().toLowerCase();
    return lines.filter((r) => {
      const okStatus =
        status === "all" ? true :
        status === "ok" ? r.status === "ĐẠT" :
        r.status === "KHÔNG ĐẠT";

      const okQ = !qq
        ? true
        : (String(r.line || "").toLowerCase().includes(qq) ||
           String(r.mh || "").toLowerCase().includes(qq));

      return okStatus && okQ;
    });
  }, [data, status, q]);

  const stats = useMemo(() => {
    const all = filtered.length;
    const ok = filtered.filter((x) => x.status === "ĐẠT").length;
    const bad = all - ok;
    return { all, ok, bad, showing: all };
  }, [filtered]);

  const hasHours = useMemo(() => {
    return (filtered[0]?.hours?.length || 0) > 0;
  }, [filtered]);

  return (
    <div className="kpiWrap">
      <h1 className="kpiTitle">KPI Dashboard</h1>

      {err ? (
        <div style={{
          background:"#fdecec", border:"1px solid #f4a3a3",
          padding:"10px 12px", borderRadius:12, marginBottom:12
        }}>
          <b>Lỗi:</b> {err}
          <div className="smallMuted" style={{ marginTop:6 }}>
            Gợi ý: mở <code>/api/check-kpi?date=...</code> xem JSON ok:true không.
          </div>
        </div>
      ) : null}

      <div className="kpiBar">
        <div>
          <label>Ngày</label>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="DD/MM/YYYY"
          />
        </div>

        <div>
          <label>Lọc trạng thái</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Tất cả</option>
            <option value="ok">ĐẠT</option>
            <option value="bad">KHÔNG ĐẠT</option>
          </select>
        </div>

        <div>
          <label>Tìm (chuyền / MH)</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="VD: C1 / 088AG ..."
          />
        </div>

        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <label style={{ margin:0 }}>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />{" "}
            Tự cập nhật (1 phút)
          </label>

          <button
            onClick={load}
            style={{ height:36, padding:"0 14px", borderRadius:10, border:"1px solid #ddd" }}
            disabled={loading}
          >
            {loading ? "Đang tải..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="kpiCards">
        <div className="card"><div className="t">Tổng dòng</div><div className="v">{stats.all}</div></div>
        <div className="card"><div className="t">ĐẠT</div><div className="v">{stats.ok}</div></div>
        <div className="card"><div className="t">KHÔNG ĐẠT</div><div className="v">{stats.bad}</div></div>
        <div className="card"><div className="t">Đang hiển thị</div><div className="v">{stats.showing}</div></div>
      </div>

      <div className="subTitle">Bảng KPI</div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Chuyền</th>
              <th>MH</th>
              <th>AFTER 16H30</th>
              <th>DM/NGÀY</th>
              <th>%</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className={r.status === "ĐẠT" ? "rowOk" : "rowBad"}>
                <td>{r.line}</td>
                <td>{r.mh}</td>
                <td>{r.hs_dat}</td>
                <td>{r.hs_dm}</td>
                <td>{r.percent}</td>
                <td>
                  <span className={"badge " + (r.status === "ĐẠT" ? "ok" : "bad")}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr><td colSpan={6} style={{ color:"#777", padding:14 }}>Không có dữ liệu để hiển thị.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {hasHours ? (
        <>
          <div className="subTitle">So sánh định mức giờ (lũy tiến)</div>
          <div className="smallMuted" style={{ marginBottom:8 }}>
            Target lũy tiến = DM/NGÀY chia đều theo số mốc giờ (dựa trên các cột “=&gt;9h, =&gt;10h...” trong sheet).
          </div>

          <div className="tableWrap">
            <table style={{ minWidth: 1200 }}>
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>MH</th>
                  {(filtered[0]?.hours || []).map((h, idx) => (
                    <th key={idx}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i}>
                    <td>{r.line}</td>
                    <td>{r.mh}</td>
                    {r.hours.map((h, idx) => (
                      <td
                        key={idx}
                        className={"hourCell " + (h.ok ? "hourOk" : "hourBad")}
                      >
                        <div><b>{h.actual}</b></div>
                        <div className="smallMuted">target: {h.target}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {/* Debug */}
      {data?.meta ? (
        <details style={{ marginTop: 14 }}>
          <summary>Debug (meta)</summary>
          <pre style={{ whiteSpace:"pre-wrap", fontSize:12 }}>
            {JSON.stringify(data.meta, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}