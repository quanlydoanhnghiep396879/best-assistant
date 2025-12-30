"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function vnToISO(vn) {
  // dd/mm/yyyy -> yyyy-mm-dd (cho input type="date")
  const m = String(vn || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function isoToVN(iso) {
  // yyyy-mm-dd -> dd/mm/yyyy
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function cls(...arr) {
  return arr.filter(Boolean).join(" ");
}

export default function KpiDashboardClient({ initialQuery }) {
  const router = useRouter();
  const sp = useSearchParams();

  const [dateVN, setDateVN] = useState(initialQuery?.date || "");
  const [status, setStatus] = useState(initialQuery?.status || "all");
  const [q, setQ] = useState(initialQuery?.q || "");
  const [auto, setAuto] = useState(initialQuery?.auto !== "0");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [perfLines, setPerfLines] = useState([]);
  const [hourLines, setHourLines] = useState([]);
  const [meta, setMeta] = useState(null);

  const timerRef = useRef(null);

  const filteredPerf = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return perfLines.filter((x) => {
      const okStatus =
        status === "all" ? true : status === "ok" ? x.status === "ĐẠT" : x.status === "KHÔNG ĐẠT";

      const okQ =
        !qq ||
        String(x.line || "").toLowerCase().includes(qq) ||
        String(x.mh || "").toLowerCase().includes(qq);

      return okStatus && okQ;
    });
  }, [perfLines, status, q]);

  const counts = useMemo(() => {
    const total = filteredPerf.length;
    const ok = filteredPerf.filter((x) => x.status === "ĐẠT").length;
    const bad = filteredPerf.filter((x) => x.status === "KHÔNG ĐẠT").length;
    return { total, ok, bad, showing: total };
  }, [filteredPerf]);

  function syncUrl(next) {
    const params = new URLSearchParams(sp?.toString() || "");
    if (next.date) params.set("date", next.date);
    if (next.status) params.set("status", next.status);
    if (typeof next.q === "string") params.set("q", next.q);
    params.set("auto", next.auto ? "1" : "0");

    router.replace(`/kpi?${params.toString()}`, { scroll: false });
  }

  async function fetchData(nextDateVN = dateVN) {
    setLoading(true);
    setErr("");
    try {
      const url = `/api/check-kpi?date=${encodeURIComponent(nextDateVN)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();

      if (!json?.ok) {
        setErr(json?.message || json?.error || "CHECK_KPI_ERROR");
        setPerfLines([]);
        setHourLines([]);
        setMeta(json?.meta || null);
        return;
      }

      setPerfLines(json?.perfLines || []);
      setHourLines(json?.hourLines || []);
      setMeta(json?.meta || null);
    } catch (e) {
      setErr(String(e?.message || e));
      setPerfLines([]);
      setHourLines([]);
    } finally {
      setLoading(false);
    }
  }

  // load lần đầu
  useEffect(() => {
    fetchData(dateVN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto refresh 60s
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!auto) return;

    timerRef.current = setInterval(() => {
      fetchData(dateVN);
    }, 60 * 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, dateVN]);

  function badgeStatusDay(s) {
    if (s === "ĐẠT") return <span className="badge badge-ok">ĐẠT</span>;
    if (s === "KHÔNG ĐẠT") return <span className="badge badge-bad">KHÔNG ĐẠT</span>;
    return <span className="badge badge-na">N/A</span>;
  }

  function cellStatusHour(s) {
    if (s === "ĐỦ") return "cell-ok";
    if (s === "VƯỢT") return "cell-over";
    if (s === "THIẾU") return "cell-under";
    return "cell-na";
  }

  // join dữ liệu bảng 2 theo filter q (để khớp bảng 1)
  const filteredHour = useMemo(() => {
    const map = new Map(filteredPerf.map((x) => [x.line, true]));
    const qq = q.trim().toLowerCase();
    return hourLines.filter((x) => {
      const okLine = map.has(x.line);
      if (!okLine) return false;
      if (!qq) return true;
      return (
        String(x.line || "").toLowerCase().includes(qq) ||
        String(x.mh || "").toLowerCase().includes(qq)
      );
    });
  }, [hourLines, filteredPerf, q]);

  const checkpoints = useMemo(() => {
    // lấy từ meta.cpIdx nếu có, fallback theo dữ liệu row[0]
    const first = filteredHour[0];
    if (first?.hourly?.length) return first.hourly.map((h) => ({ key: h.key, label: h.label }));
    return [];
  }, [filteredHour]);

  return (
    <div className="kpi-wrap">
      {err ? (
        <div className="alert alert-err">
          <div className="alert-title">Lỗi: {err}</div>
          <div className="alert-sub">
            Gợi ý: mở thử <code>/api/check-kpi?date=...</code> để xem JSON có <b>ok:true</b> không.
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <div className="field">
          <label>Ngày</label>
          <input
            type="date"
            value={vnToISO(dateVN)}
            onChange={(e) => {
              const vn = isoToVN(e.target.value);
              setDateVN(vn);
              syncUrl({ date: vn, status, q, auto });
              fetchData(vn);
            }}
          />
        </div>

        <div className="field">
          <label>Lọc trạng thái</label>
          <select
            value={status}
            onChange={(e) => {
              const v = e.target.value;
              setStatus(v);
              syncUrl({ date: dateVN, status: v, q, auto });
            }}
          >
            <option value="all">Tất cả</option>
            <option value="ok">Đạt</option>
            <option value="bad">Không đạt</option>
          </select>
        </div>

        <div className="field grow">
          <label>Tìm (chuyền / MH)</label>
          <input
            placeholder="VD: C1 / 088AG / Baby Carrier..."
            value={q}
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              syncUrl({ date: dateVN, status, q: v, auto });
            }}
          />
        </div>

        <div className="field inline">
          <label className="chk">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                const v = e.target.checked;
                setAuto(v);
                syncUrl({ date: dateVN, status, q, auto: v });
              }}
            />
            <span>Tự cập nhật (1 phút)</span>
          </label>
        </div>

        <div className="field inline">
          <button className="btn" onClick={() => fetchData(dateVN)} disabled={loading}>
            {loading ? "Đang tải..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="summary">
        <div className="card">
          <div className="card-label">Tổng dòng</div>
          <div className="card-value">{counts.total}</div>
        </div>
        <div className="card">
          <div className="card-label">ĐẠT</div>
          <div className="card-value ok">{counts.ok}</div>
        </div>
        <div className="card">
          <div className="card-label">KHÔNG ĐẠT</div>
          <div className="card-value bad">{counts.bad}</div>
        </div>
        <div className="card">
          <div className="card-label">Đang hiển thị</div>
          <div className="card-value">{counts.showing}</div>
        </div>
      </div>

      {/* ====== 2 BẢNG NẰM NGANG ====== */}
      <div className="two-cols">
        {/* ===== BẢNG 1: HIỆU SUẤT NGÀY ===== */}
        <div className="panel">
          <div className="panel-title">Hiệu suất ngày (AFTER 16H30 vs ĐM/NGÀY)</div>
          <div className="table-wrap">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>MH</th>
                  <th className="num">AFTER 16H30</th>
                  <th className="num">ĐM/NGÀY</th>
                  <th className="num">%</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filteredPerf.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      Không có dữ liệu để hiển thị.
                    </td>
                  </tr>
                ) : (
                  filteredPerf.map((x) => (
                    <tr key={`p-${x.line}`}>
                      <td className="mono">{x.line}</td>
                      <td className="mono">{x.mh}</td>
                      <td className="num">{x.after1630}</td>
                      <td className="num">{x.dmNgay}</td>
                      <td className={cls("num", x.percent >= 100 ? "txt-ok" : "txt-bad")}>
                        {x.percent}%
                      </td>
                      <td>{badgeStatusDay(x.status)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== BẢNG 2: LŨY TIẾN THEO GIỜ ===== */}
        <div className="panel">
          <div className="panel-title">Lũy tiến theo giờ (Kiểm đạt vs ĐM/GIỜ)</div>
          <div className="table-wrap">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>MH</th>
                  <th className="num">ĐM/H</th>
                  {checkpoints.map((c) => (
                    <th key={c.key} className="num">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredHour.length === 0 ? (
                  <tr>
                    <td colSpan={3 + checkpoints.length} className="empty">
                      Không có dữ liệu để hiển thị.
                    </td>
                  </tr>
                ) : (
                  filteredHour.map((row) => (
                    <tr key={`h-${row.line}`}>
                      <td className="mono">{row.line}</td>
                      <td className="mono">{row.mh}</td>
                      <td className="num">{row.dmH}</td>

                      {row.hourly.map((h) => (
                        <td
                          key={h.key}
                          className={cls("num", "hour-cell", cellStatusHour(h.status))}
                          title={`Actual: ${h.actual} | Target: ${h.target} | Delta: ${h.delta}`}
                        >
                          <div className="cell-main">{h.actual}</div>
                          <div className="cell-sub">/{h.target}</div>
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="legend">
            <span className="lg lg-ok">ĐỦ</span>
            <span className="lg lg-over">VƯỢT</span>
            <span className="lg lg-under">THIẾU</span>
          </div>
        </div>
      </div>

      <details className="debug">
        <summary>Debug (meta)</summary>
        <pre>{JSON.stringify(meta, null, 2)}</pre>
      </details>
    </div>
  );
}