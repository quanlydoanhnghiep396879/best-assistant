"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import s from "./kpi.module.css";

function fmtPercent(frac) {
  if (frac === null || frac === undefined) return "—";
  const v = Number(frac);
  if (!Number.isFinite(v)) return "—";
  return (v * 100).toFixed(2) + "%";
}
function pillClass(status){
  if (status === "ĐẠT") return `${s.pill} ${s.ok}`;
  if (status === "THIẾU" || status === "KHÔNG ĐẠT") return `${s.pill} ${s.bad}`;
  return `${s.pill} ${s.na}`;
}

export default function KpiDashboardClient(){
  const [dates,setDates]=useState([]);
  const [date,setDate]=useState("");
  const [auto,setAuto]=useState(true);
  const [loading,setLoading]=useState(false);
  const [daily,setDaily]=useState(null);
  const [detail,setDetail]=useState(null);
  const [selectedChuyen,setSelectedChuyen]=useState("");
  const [q,setQ]=useState("");
  const [err,setErr]=useState("");

  const timerRef = useRef(null);

  async function loadDates(){
    setErr("");
    const res = await fetch("/api/kpi-config?list=1",{cache:"no-store"});
    const js = await res.json();
    if(!js.ok){
      setErr(js.error || "Không load được danh sách ngày");
      setDates([]);
      return;
    }
    setDates(js.dates||[]);
    if(!date && js.dates?.length) setDate(js.dates[js.dates.length-1]);
  }

  async function loadDaily(d){
    if(!d) return;
    setLoading(true); setErr("");
    try{
      const res = await fetch("/api/kpi-config?date="+encodeURIComponent(d),{cache:"no-store"});
      const js = await res.json();
      if(!js.ok){
        setErr(js.error || "Không load được dữ liệu KPI");
        setDaily(null); setDetail(null);
        return;
      }
      setDaily(js);

      const first = js.rows?.[0]?.chuyen || "";
      setSelectedChuyen(first);
      setDetail(null);
      if(first) await loadDetail(d, first);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(d, ch){
    if(!d || !ch) return;
    setErr("");
    const res = await fetch("/api/check-kpi?date="+encodeURIComponent(d)+"&chuyen="+encodeURIComponent(ch),{cache:"no-store"});
    const js = await res.json();
    if(!js.ok){
      setErr(js.error || "Không load được chi tiết lũy tiến");
      setDetail(null);
      return;
    }
    setDetail(js);
  }

  useEffect(()=>{ loadDates(); },[]);
  useEffect(()=>{
    if(timerRef.current) clearInterval(timerRef.current);
    if(!auto) return;
    timerRef.current = setInterval(()=>{ if(date) loadDaily(date); }, 60_000);
    return ()=> timerRef.current && clearInterval(timerRef.current);
  },[auto,date]);

  const filteredRows = useMemo(()=>{
    const rows = daily?.rows || [];
    const query = q.trim().toLowerCase();
    if(!query) return rows;
    return rows.filter(r =>
      String(r.chuyen||"").toLowerCase().includes(query) ||
      String(r.maHang||"").toLowerCase().includes(query)
    );
  },[daily,q]);

  const selectedMaHang = useMemo(()=>{
    const rows = daily?.rows || [];
    const f = rows.find(r => String(r.chuyen).toUpperCase() === String(selectedChuyen).toUpperCase());
    return f?.maHang || "—";
  },[daily,selectedChuyen]);

  return (
    <div className={s.bg}>
      <div className={s.wrap}>
        <div className={s.title}>KPI Dashboard</div>
        <div className={s.sub}>Chọn ngày để xem so sánh lũy tiến theo giờ và hiệu suất ngày.</div>

        <div className={s.toolbar}>
          <select className={s.select} value={date} onChange={e=>setDate(e.target.value)}>
            <option value="">Chọn ngày...</option>
            {dates.map(d=><option key={d} value={d}>{d}</option>)}
          </select>

          <button className={s.btn} disabled={!date || loading} onClick={()=>loadDaily(date)}>
            {loading ? "Đang tải..." : "Xem dữ liệu"}
          </button>

          <label style={{color:"#a7b4cc",display:"flex",gap:10,alignItems:"center"}}>
            <input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} />
            Tự cập nhật (1 phút)
          </label>
        </div>

        {err ? <div className={s.err}>⚠️ {err}</div> : null}

        <div className={s.grid}>
          {/* LEFT: hiệu suất ngày */}
          <section className={s.card}>
            <div className={s.hd}>
              <div>
                <div className={s.h1}>So sánh hiệu suất ngày</div>
                <div className={s.h2}>Mốc cuối: {daily?.timeMarks?.slice(-1)?.[0] || "—"}</div>
              </div>
              <input className={s.search} placeholder="Tìm chuyền hoặc mã hàng..." value={q} onChange={e=>setQ(e.target.value)} />
            </div>

            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th className={s.th}>Chuyền</th>
                    <th className={s.th}>Mã hàng</th>
                    <th className={s.th}>HS đạt</th>
                    <th className={s.th}>HS định mức</th>
                    <th className={s.th}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length===0 ? (
                    <tr><td className={s.empty} colSpan={5}>Chưa có dữ liệu (bấm “Xem dữ liệu”)</td></tr>
                  ) : filteredRows.map(r=>{
                    const active = String(r.chuyen).toUpperCase()===String(selectedChuyen).toUpperCase();
                    return (
                      <tr key={r.chuyen} className={`${s.tr} ${active? s.active:""}`}
                          onClick={async()=>{ setSelectedChuyen(r.chuyen); await loadDetail(date,r.chuyen); }}>
                        <td className={s.td}><span className={s.mono}>{r.chuyen}</span></td>
                        <td className={s.td}><span className={s.mono}>{r.maHang}</span></td>
                        <td className={s.td}>{fmtPercent(r.hsDat)}</td>
                        <td className={s.td}>{fmtPercent(r.hsDinhMuc)}</td>
                        <td className={s.td}><span className={pillClass(r.status)}>{r.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* RIGHT: lũy tiến theo giờ */}
          <section className={s.card}>
            <div className={s.hd}>
              <div>
                <div className={s.h1}>
                  So sánh lũy tiến theo giờ (chuyền: <span className={s.mono}>{selectedChuyen||"—"}</span>)
                </div>
                <div className={s.h2}>Mã hàng: <b className={s.mono}>{selectedMaHang}</b></div>
              </div>

              <div className={s.chips}>
                {(daily?.rows||[]).map(r=>(
                  <button key={r.chuyen}
                    className={`${s.chip} ${String(r.chuyen).toUpperCase()===String(selectedChuyen).toUpperCase()? s.chipOn:""}`}
                    onClick={async()=>{ setSelectedChuyen(r.chuyen); await loadDetail(date,r.chuyen); }}>
                    {r.chuyen}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.miniRow}>
              <div className={s.mini}>
                <div className={s.miniLb}>DM/H</div>
                <div className={s.miniVal}>{detail?.dmH ?? "—"}</div>
              </div>
              <div className={s.mini}>
                <div className={s.miniLb}>DM/NGÀY</div>
                <div className={s.miniVal}>{detail?.dmNgay ?? "—"}</div>
              </div>
            </div>

            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th className={s.th}>Mốc</th>
                    <th className={s.th}>Lũy tiến</th>
                    <th className={s.th}>DM lũy tiến</th>
                    <th className={s.th}>Chênh</th>
                    <th className={s.th}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {!detail?.steps?.length ? (
                    <tr><td className={s.empty} colSpan={5}>Chưa chọn chuyền / không có dữ liệu</td></tr>
                  ) : detail.steps.map(st=>(
                    <tr key={st.moc} className={s.tr}>
                      <td className={s.td}><span className={s.mono}>{st.moc}</span></td>
                      <td className={s.td}>{st.luyTien ?? "—"}</td>
                      <td className={s.td}>{st.dmLuyTien ?? "—"}</td>
                      <td className={s.td}>{st.chenh ?? "—"}</td>
                      <td className={s.td}>
                        <span className={pillClass(st.status==="THIẾU"?"KHÔNG ĐẠT":st.status)}>{st.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </section>
        </div>
      </div>
    </div>
  );
}
