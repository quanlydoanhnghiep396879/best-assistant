"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./kpi.module.css";

function toDDMMYYYY(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return "";
  const m = String(yyyy_mm_dd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return yyyy_mm_dd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizePercent(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0;
  // nếu API trả 0.95 => coi là 95%
  if (n <= 1.5) return n * 100;
  return n;
}

function cls(...arr) {
  return arr.filter(Boolean).join(" ");
}

export default function KpiDashboardClient({ initialQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // ===== state filters =====
  const [date, setDate] = useState(initialQuery?.date || "");
  const [status, setStatus] = useState(initialQuery?.status || "all"); // all | ok | ko
  const [q, setQ] = useState(initialQuery?.q || "");
  const [auto, setAuto] = useState(initialQuery?.auto !== "0"); // boolean

  // bảng lũy tiến: chọn chuyền + chọn mốc giờ
  const [linePick, setLinePick] = useState("all");
  const [hourPick, setHourPick] = useState(""); // key hour trong meta.hourCols (vd "H0900" hoặc "09:00")

  // ===== data =====
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  const timerRef = useRef(null);

  // ===== sync URL (giữ searchParams như bạn muốn) =====
  useEffect(() => {
    const params = new URLSearchParams(sp?.toString() || "");
    if (date) params.set("date", date);
    else params.delete("date");

    params.set("status", status || "all");
    if (q) params.set("q", q);
    else params.delete("q");

    params.set("auto", auto ? "1" : "0");

    const url = `${pathname}?${params.toString()}`;
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, status, q, auto]);

  async function fetchKpi(signal) {
    setLoading(true);
    setErr("");
    try {
      // API của bạn đang dùng: /api/check-kpi?date=dd/mm/yyyy
      // Dashboard dùng input date yyyy-mm-dd => convert qua dd/mm/yyyy
      const d = date ? toDDMMYYYY(date) : "";
      const url = `/api/check-kpi${d ? `?date=${encodeURIComponent(d)}` : ""}`;
      const res = await fetch(url, { signal, cache: "no-store" });
      const js = await res.json().catch(() => ({}));

      if (!res.ok || js?.ok === false) {
        throw new Error(js?.message || js?.error || HTTP `${res.status}`);
      }
      setData(js);
    } catch (e) {
      if (e?.name !== "AbortError") setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // load first + when date changes
  useEffect(() => {
    const ac = new AbortController();
    fetchKpi(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // auto refresh
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!auto) return;

    timerRef.current = setInterval(() => {
      const ac = new AbortController();
      fetchKpi(ac.signal);
      setTimeout(() => ac.abort(), 25000);
    }, 60_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, date]);

  // ===== derived =====
  const meta = data?.meta || {};
  const hourCols = meta?.hourCols || []; // [{key,label,idx,...}] nếu API có
  const linesRaw = Array.isArray(data?.lines) ? data.lines : [];

  // default hourPick = last hour col
  useEffect(() => {
    if (!hourPick && hourCols.length) {
      setHourPick(hourCols[hourCols.length - 1].key || hourCols[hourCols.length - 1].label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourCols?.length]);

  const lineOptions = useMemo(() => {
    const opts = [];
    for (const r of linesRaw) {
      const v = (r?.line || "").toString().trim();
      if (!v) continue;
      opts.push(v);
    }
    return ["all", ...Array.from(new Set(opts))];
  }, [linesRaw]);

  const filteredPerf = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return linesRaw.filter((r) => {
      const st = (r?.status || "").toString().toLowerCase(); // "đạt"/"không đạt"
      const isOk = st.includes("đạt") && !st.includes("không");
      const okFilter =
        status === "all" ? true : status === "ok" ? isOk : status === "ko" ? !isOk : true;

      const text = `${r?.line || ""} ${r?.mh || ""}`.toLowerCase();
      const qFilter = !qq ? true : text.includes(qq);

      return okFilter && qFilter;
    });
  }, [linesRaw, status, q]);

  const perfStats = useMemo(() => {
    let total = filteredPerf.length;
    let ok = 0;
    let ko = 0;
    for (const r of filteredPerf) {
      const st = (r?.status || "").toString().toLowerCase();
      const isOk = st.includes("đạt") && !st.includes("không");
      if (isOk) ok++;
      else ko++;
    }
    return { total, ok, ko, showing: total };
  }, [filteredPerf]);

  const perfRows = useMemo(() => {
    return filteredPerf.map((r) => {
      const after = Number(r?.hs_dat || 0);
      const dmNgay = Number(r?.hs_dm || 0);
      const p = normalizePercent(r?.percent || 0);
      const isDat = p >= 100;

      return {
        line: r?.line || "",
        mh: r?.mh || "",
        after,
        dmNgay,
        percent: p,
        statusText: isDat ? "ĐẠT" : "KHÔNG ĐẠT",
        statusClass: isDat ? styles.badgeOk : styles.badgeKo,
      };
    });
  }, [filteredPerf]);

  // ===== lũy tiến table (theo mốc giờ chọn) =====
  const hourKeyToLabel = useMemo(() => {
    const map = new Map();
    for (const h of hourCols) map.set(h.key, h.label);
    return map;
  }, [hourCols]);

  const cumuRows = useMemo(() => {
    const pick = (linePick || "all").toLowerCase();

    return linesRaw
      .filter((r) => {
        if (pick === "all") return true;
        return String(r?.line || "").toLowerCase() === pick;
      })
      .map((r) => {
        // API bạn đang trả: r.hours = [{label, actual, target, ok, key?}]
        const hours = Array.isArray(r?.hours) ? r.hours : [];

        // tìm theo key trước, không có thì theo label
        const h =
          hours.find((x) => String(x?.key || "") === String(hourPick)) ||
          hours.find((x) => String(x?.label || "") === String(hourPick)) ||
          null;

        const actual = Number(h?.actual || 0);
        const target = Number(h?.target || 0);
        const delta = actual - target;

        let st = "THIẾU";
        let stClass = styles.badgeKo;
        if (target === 0) {
          st = "—";
          stClass = styles.badgeNeutral;
        } else if (delta === 0) {
          st = "ĐỦ";
          stClass = styles.badgeOk;
        } else if (delta > 0) {
          st = "VƯỢT";
          stClass = styles.badgeOk;
        }

        return {
          line: r?.line || "",
          mh: r?.mh || "",
          actual,
          target,
          delta,
          status: st,
          statusClass: stClass,
        };
      });
  }, [linesRaw, linePick, hourPick]);

  const currentDateLabel = useMemo(() => {
    if (!date) return data?.date || "";
    return toDDMMYYYY(date);
  }, [date, data?.date]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>KPI Dashboard</div>
          <div className={styles.subtitle}>Tech theme • Dark • Auto update</div>
        </div>

        <button
          className={styles.btn}
          onClick={() => {
            const ac = new AbortController();
            fetchKpi(ac.signal);
            setTimeout(() => ac.abort(), 25000);
          }}
        >
          Refresh
        </button>
      </div>

      {/* FILTERS */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Bộ lọc</div>

        <div className={styles.filters}>
          <label className={styles.field}>
            <span>Ngày</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={styles.input}
            />
            <small className={styles.muted}>Đang xem: {currentDateLabel || "—"}</small>
          </label>

          <label className={styles.field}>
            <span>Lọc trạng thái</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={styles.input}>
              <option value="all">Tất cả</option>
              <option value="ok">ĐẠT</option>
              <option value="ko">KHÔNG ĐẠT</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Tìm (chuyền / MH)</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="VD: C1 / 088AG / Baby Carrier..."
              className={styles.input}
            />
          </label>

          <label className={styles.checkWrap}>
            <span>Tự cập nhật</span>
            <div className={styles.checkRow}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span className={styles.muted}>1 phút</span>
            </div>
          </label>
        </div>

        {/* stats */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Tổng dòng</div>
            <div className={styles.statValue}>{perfStats.total}</div>
          </div>
          <div className={cls(styles.stat, styles.statOk)}>
            <div className={styles.statLabel}>ĐẠT</div>
            <div className={styles.statValue}>{perfStats.ok}</div>
          </div>
          <div className={cls(styles.stat, styles.statKo)}>
            <div className={styles.statLabel}>KHÔNG ĐẠT</div>
            <div className={styles.statValue}>{perfStats.ko}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Đang hiển thị</div>
            <div className={styles.statValue}>{perfStats.showing}</div>
          </div>
        </div>

        {loading && <div className={styles.notice}>Đang tải dữ liệu…</div>}
        {err && (
          <div className={styles.error}>
            <b>Lỗi:</b> {err}
            <div className={styles.muted}>
              Gợi ý: mở <code>/api/check-kpi?date=dd/mm/yyyy</code> để kiểm tra JSON <code>ok:true</code> và{" "}
              <code>lines</code> có dữ liệu.
            </div>
          </div>
        )}
      </div>

      {/* TWO TABLES SIDE BY SIDE */}
      <div className={styles.grid2}>
        {/* PERFORMANCE TABLE */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>Hiệu suất trong ngày vs Định mức (kèm mã hàng)</div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>MH</th>
                  <th className={styles.right}>AFTER 16H30</th>
                  <th className={styles.right}>DM/NGÀY</th>
                  <th className={styles.right}>%</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>

              <tbody>
                {!perfRows.length ? (
                  <tr>
                    <td colSpan={6} className={styles.empty}>
                      Không có dữ liệu để hiển thị.
                    </td>
                  </tr>
                ) : (
                  perfRows.map((r, idx) => (
                    <tr key={`${r.line}-${idx}`}>
                      <td className={styles.mono}>{r.line}</td>
                      <td>{r.mh}</td>
                      <td className={cls(styles.right, styles.mono)}>{r.after}</td>
                      <td className={cls(styles.right, styles.mono)}>{r.dmNgay}</td>
                      <td className={cls(styles.right, styles.mono)}>{r.percent.toFixed(2)}%</td>
                      <td>
                        <span className={cls(styles.badge, r.statusClass)}>{r.statusText}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.hint}>
            Quy tắc: <b>≥ 100%</b> → <span className={cls(styles.badge, styles.badgeOk)}>ĐẠT</span>,{" "}
            <b>&lt; 100%</b> → <span className={cls(styles.badge, styles.badgeKo)}>KHÔNG ĐẠT</span>.
          </div>
        </div>

        {/* CUMULATIVE TABLE */}
        <div className={styles.card}>
          <div className={styles.cardTitleRow}>
            <div className={styles.cardTitle}>So sánh số lượng kiểm đạt lũy tiến vs định mức giờ</div>

            <div className={styles.inlineControls}>
              <label className={styles.inlineField}>
                <span>Chọn chuyền</span>
                <select
                  value={linePick}
                  onChange={(e) => setLinePick(e.target.value)}
                  className={styles.inputSm}
                >
                  {lineOptions.map((x) => (
                    <option key={x} value={x}>
                      {x === "all" ? "Tất cả" : x}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.inlineField}>
                <span>Mốc giờ</span>
                <select value={hourPick} onChange={(e) => setHourPick(e.target.value)} className={styles.inputSm}>
                  {hourCols.length ? (
                    hourCols.map((h) => (
                      <option key={h.key || h.label} value={h.key || h.label}>
                        {h.label}
                      </option>
                    ))
                  ) : (
                    <option value="">(chưa có hourCols từ API)</option>
                  )}
                </select>
              </label>
            </div>
          </div>

          <div className={styles.legend}>
            <span className={cls(styles.badge, styles.badgeOk)}>ĐỦ</span>
            <span className={cls(styles.badge, styles.badgeOk)}>VƯỢT</span>
            <span className={cls(styles.badge, styles.badgeKo)}>THIẾU</span>
          </div>

          {/* summary table by selected hour */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Chuyền</th>
                  <th>MH</th>
                  <th className={styles.right}>Lũy tiến</th>
                  <th className={styles.right}>ĐM giờ</th>
                  <th className={styles.right}>Chênh</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>

              <tbody>
                {!cumuRows.length ? (
                  <tr>
                    <td colSpan={6} className={styles.empty}>
                      Không có dữ liệu lũy tiến để hiển thị.
                    </td>
                  </tr>
                ) : (
                  cumuRows.map((r, idx) => (
                    <tr key={`${r.line}-${idx}`}>
                      <td className={styles.mono}>{r.line}</td>
                      <td>{r.mh}</td>
                      <td className={cls(styles.right, styles.mono)}>{r.actual}</td>
                      <td className={cls(styles.right, styles.mono)}>{r.target}</td>
                      <td className={cls(styles.right, styles.mono, r.delta < 0 ? styles.neg : r.delta > 0 ? styles.pos : "")}>
                        {r.target === 0 ? "—" : (r.delta > 0 ? +`${r.delta}` : `${r.delta}`)}
                      </td>
                      <td>
                        <span className={cls(styles.badge, r.statusClass)}>{r.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* mini debug */}
          <details className={styles.details}>
            <summary>Debug (meta)</summary>
            <pre className={styles.pre}>
{JSON.stringify(
  {
    date: data?.date,
    range: data?.range,
    hourCols: hourCols.map((h) => ({ key: h.key, label: h.label, idx: h.idx })),
    linePick,
    hourPickLabel: hourKeyToLabel.get(hourPick) || hourPick,
  },
  null,
  2
)}
            </pre>
          </details>
        </div>
      </div>

      <div className={styles.footerNote}>
        Nếu bảng lũy tiến ra toàn <b>0</b> nhưng Google Sheet có số → 99% là API đang trả <code>target</code> sai (đọc nhầm
        cột/nhầm range). Dashboard đã ok, cần sửa lại API để lấy đúng “ĐM giờ”.
      </div>
    </div>
  );
}