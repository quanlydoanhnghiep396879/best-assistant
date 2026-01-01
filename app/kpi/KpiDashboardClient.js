// app/kpi/kpiDashboardClient.js
"use client";

import { useEffect, useMemo, useState } from "react";
import "./kpi.css";

function Badge({ text, type }) {
  return <span className={`badge ${type}`}>{text}</span>;
}

function statusType(s) {
  if (s === "ĐỦ" || s === "VƯỢT") return "ok";
  if (s === "THIẾU") return "bad";
  return "muted";
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [chosenDate, setChosenDate] = useState("");
  const [lines, setLines] = useState([]);
  const [chosenLine, setChosenLine] = useState("TỔNG HỢP");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  async function load(nextDate, nextLine) {
    setErr("");
    const qs = new URLSearchParams();
    if (nextDate) qs.set("date", nextDate);
    if (nextLine) qs.set("line", nextLine);

    const res = await fetch(`/api/check-kpi?${qs.toString()}`, { cache: "no-store" });
    const j = await res.json();
    if (!j.ok) {
      setErr(j.error || "Lỗi không rõ");
      setData(null);
      return;
    }

    setDates(j.dates || []);
    setLines(j.lines || []);
    setChosenDate(j.chosenDate || "");
    setChosenLine(j.selectedLine || "TỔNG HỢP");
    setData(j);
  }

  useEffect(() => {
    load("", "TỔNG HỢP");
  }, []);

  const hourlyRows = useMemo(() => data?.hourly?.hours || [], [data]);

  return (
    <div className="kpi-wrap">
      <div className="kpi-top">
        <div>
          <div className="title">KPI Dashboard</div>
          <div className="sub">Chọn ngày và chuyền để xem dữ liệu</div>
        </div>

        <div className="controls">
          <div className="control">
            <label>Chọn ngày</label>
            <select
              value={chosenDate}
              onChange={(e) => {
                const v = e.target.value;
                setChosenDate(v);
                load(v, chosenLine);
              }}
            >
              {dates.length === 0 ? <option value="">(Chưa có ngày)</option> : null}
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="control">
            <label>Chọn chuyền</label>
            <select
              value={chosenLine}
              onChange={(e) => {
                const v = e.target.value;
                setChosenLine(v);
                load(chosenDate, v);
              }}
            >
              {(lines.length ? lines : ["TỔNG HỢP"]).map((ln) => (
                <option key={ln} value={ln}>
                  {ln}
                </option>
              ))}
            </select>
          </div>

          <button className="btn" onClick={() => load(chosenDate, chosenLine)}>
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div className="error">
          <div className="error-title">Lỗi</div>
          <div className="error-msg">{err}</div>
        </div>
      ) : null}

      <div className="grid-2">
        {/* Bảng trái: để khung sẵn, bạn muốn lấy HS ở vùng nào trong sheet thì mình map tiếp */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Hiệu suất trong ngày (so với định mức)</div>
            <div className="pill">Đang dùng khung UI</div>
          </div>

          <div className="table">
            <div className="thead">
              <div>Chuyền/BP</div>
              <div>Mã hàng</div>
              <div>HS đạt</div>
              <div>HS ĐM</div>
              <div>Trạng thái</div>
            </div>

            <div className="tbody">
              <div className="row">
                <div>{chosenLine}</div>
                <div>-</div>
                <div>—</div>
                <div>—</div>
                <div>
                  <Badge text="(chưa map HS)" type="muted" />
                </div>
              </div>
            </div>

            <div className="hint">
              * Nếu bạn chỉ mình “HS đạt/HS ĐM” đang nằm cột nào/khối nào trong KPI sheet, mình map phát là ra đủ xanh/đỏ.
            </div>
          </div>
        </div>

        {/* Bảng phải: lũy tiến theo giờ */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Kiểm lũy tiến theo giờ (so với ĐM/H)</div>
            <div className="pill">
              DM/H: <b>{data?.hourly?.dmH ?? 0}</b>
            </div>
          </div>

          <div className="table">
            <div className="thead">
              <div>Giờ</div>
              <div>Tổng kiểm đạt</div>
              <div>ĐM lũy tiến</div>
              <div>Chênh</div>
              <div>Trạng thái</div>
            </div>

            <div className="tbody">
              {hourlyRows.length === 0 ? (
                <div className="empty">Không có dữ liệu</div>
              ) : (
                hourlyRows.map((h) => (
                  <div className="row" key={h.label}>
                    <div>{h.label}</div>
                    <div>{h.actual}</div>
                    <div>{h.target}</div>
                    <div className={h.diff < 0 ? "neg" : "pos"}>{h.diff}</div>
                    <div>
                      <Badge text={h.status} type={statusType(h.status)} />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="hint">
              * Logic: = ĐỦ (xanh), &gt; VƯỢT (xanh), &lt; THIẾU (đỏ). Lấy trực tiếp từ bảng “THỐNG KÊ HIỆU SUẤT THEO GIỜ, NGÀY”.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
