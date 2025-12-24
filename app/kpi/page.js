"use client";

import { useEffect, useState, useMemo } from "react";

export default function KpiDashboardPage() {
  const [hourAlerts, setHourAlerts] = useState([]);
  const [dayAlerts, setDayAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState(null); // debug
  const [selectedChuyen, setSelectedChuyen] = useState("ALL");

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      try {
        if (!isMounted) return;
        setError(null);

        const res = await fetch("/api/check-kpi", { method: "POST" });
        const json = await res.json();
        setRaw(json);

        if (!res.ok || json.status !== "success") {
          throw new Error(json.message || "API error");
        }

        if (!isMounted) return;
        setHourAlerts(json.hourAlerts || []);
        setDayAlerts(json.dayAlerts || []);
        setLoading(false);
      } catch (e) {
        console.error("KPI PAGE ERROR:", e);
        if (!isMounted) return;
        setError(e.message || "Unknown error");
        setLoading(false);
      }
    }

    fetchData();
    const id = setInterval(fetchData, 5000); // refresh 5s

    return () => {
      isMounted = false;
      clearInterval(id);
    };
  }, []);

  // ====== LẤY DANH SÁCH CHUYỀN ======
  const chuyenOptions = useMemo(() => {
    const set = new Set();
    hourAlerts.forEach((a) => a.chuyen && set.add(a.chuyen));
    dayAlerts.forEach((a) => a.chuyen && set.add(a.chuyen));
    return ["ALL", ...Array.from(set)];
  }, [hourAlerts, dayAlerts]);

  // ====== FILTER THEO CHUYỀN (cho chế độ 1 chuyền) ======
  const filteredHourAlerts =
    selectedChuyen === "ALL"
      ? hourAlerts
      : hourAlerts.filter((a) => a.chuyen === selectedChuyen);

  const filteredDayAlerts =
    selectedChuyen === "ALL"
      ? dayAlerts
      : dayAlerts.filter((a) => a.chuyen === selectedChuyen);

  // ====== GROUP THEO CHUYỀN (cho chế độ ALL) ======
  const HOUR_ORDER = ["9h", "10h", "11h", "12h30", "13h30", "14h30", "15h30", "16h30"];

  const groupedHourByChuyen = useMemo(() => {
    const map = new Map();
    hourAlerts.forEach((a) => {
      if (!a.chuyen) return;
      if (!map.has(a.chuyen)) map.set(a.chuyen, []);
      map.get(a.chuyen).push(a);
    });

    // sort theo thứ tự giờ
    for (const [chuyen, list] of map.entries()) {
      list.sort(
        (x, y) => HOUR_ORDER.indexOf(x.hour) - HOUR_ORDER.indexOf(y.hour)
      );
    }

    return map;
  }, [hourAlerts]);

  // ====== BẢNG TỔNG HỢP MỖI CHUYỀN ======
  const summaryRows = useMemo(() => {
    const rows = [];
    for (const [chuyen, list] of groupedHourByChuyen.entries()) {
      const equal = list.filter((x) => x.status === "equal").length;
      const over = list.filter((x) => x.status === "over").length;
      const lack = list.filter((x) => x.status === "lack").length;

      const day = dayAlerts.find((d) => d.chuyen === chuyen) || null;

      rows.push({
        chuyen,
        equal,
        over,
        lack,
        effDay: day ? day.effDay : null,
        targetEffDay: day ? day.targetEffDay : null,
        dayStatus: day ? day.status : null,
      });
    }
    return rows;
  }, [groupedHourByChuyen, dayAlerts]);

  const totalLines = summaryRows.length;
  const totalDayOk = summaryRows.filter((r) => r.dayStatus === "day_ok").length;
  const totalDayFail = summaryRows.filter((r) => r.dayStatus === "day_fail").length;

  return (
    <main style={{ padding: "20px" }}>
      <h1>📊 KPI Dashboard</h1>

      {/* CHỌN CHUYỀN */}
      <div style={{ margin: "10px 0 20px 0" }}>
        <label>
          <strong>Chọn chuyền:&nbsp;</strong>
          <select
            value={selectedChuyen}
            onChange={(e) => setSelectedChuyen(e.target.value)}
          >
            {chuyenOptions.map((name) => (
              <option key={name} value={name}>
                {name === "ALL" ? "Tất cả chuyền" : name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p>Đang tải dữ liệu...</p>}
      {error && <p style={{ color: "red" }}>Lỗi: {error}</p>}

      {/* ====================== TỔNG HỢP NHANH ====================== */}
      {selectedChuyen === "ALL" && (
        <>
          <h2>Tổng hợp nhanh</h2>
          <p style={{ marginBottom: 6 }}>
            Tổng số chuyền: <b>{totalLines}</b> — ✅ Đạt:{" "}
            <b>{totalDayOk}</b> — ❌ Không đạt: <b>{totalDayFail}</b>
          </p>

          <table
            border={1}
            cellPadding={6}
            style={{ borderCollapse: "collapse", marginBottom: 20 }}
          >
            <thead>
              <tr>
                <th>Chuyền</th>
                <th>Giờ đủ</th>
                <th>Giờ vượt</th>
                <th>Giờ thiếu</th>
                <th>Hiệu suất ngày (%)</th>
                <th>Định mức ngày (%)</th>
                <th>Trạng thái ngày</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((r) => (
                <tr key={r.chuyen}>
                  <td>{r.chuyen}</td>
                  <td>{r.equal}</td>
                  <td>{r.over}</td>
                  <td>{r.lack}</td>
                  <td>{r.effDay != null ? r.effDay.toFixed(2) : "-"}</td>
                  <td>{r.targetEffDay != null ? r.targetEffDay.toFixed(2) : "-"}</td>
                  <td>
                    {r.dayStatus === "day_ok"
                      ? "✅ Đạt"
                      : r.dayStatus === "day_fail"
                      ? "❌ Không đạt"
                      : ""}
                  </td>
                </tr>
              ))}
              {summaryRows.length === 0 && !loading && !error && (
                <tr>
                  <td colSpan={7}>Chưa có dữ liệu tổng hợp.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* ====================== BẢNG THEO GIỜ ====================== */}

      <h2>Kiểm soát theo giờ (lũy tiến)</h2>

      {selectedChuyen === "ALL" ? (
        // ==== CHẾ ĐỘ TẤT CẢ CHUYỀN: MỖI CHUYỀN 1 KHUNG GẬP / MỞ ====
        <div>
          {Array.from(groupedHourByChuyen.entries()).map(
            ([chuyen, list]) => {
              const countLack = list.filter((x) => x.status === "lack").length;
              const countOver = list.filter((x) => x.status === "over").length;
              const countEqual = list.filter((x) => x.status === "equal")
                .length;

              return (
                <details
                  key={chuyen}
                  style={{ marginBottom: 12, border: "1px solid #ccc", padding: 6 }}
                >
                  <summary style={{ cursor: "pointer" }}>
                    <strong>{chuyen}</strong>{" "}
                    — ❌ Thiếu: {countLack} | ⚠️ Vượt: {countOver} | ✅ Đủ:{" "}
                    {countEqual}
                  </summary>

                  <table
                    border={1}
                    cellPadding={6}
                    style={{
                      marginTop: 8,
                      borderCollapse: "collapse",
                      width: "100%",
                    }}
                  >
                    <thead>
                      <tr>
                        <th>Giờ</th>
                        <th>Kế hoạch lũy tiến</th>
                        <th>Thực tế</th>
                        <th>Chênh lệch</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((a, idx) => (
                        <tr key={idx}>
                          <td>{a.hour}</td>
                          <td>{a.target}</td>
                          <td>{a.actual}</td>
                          <td>{a.diff}</td>
                          <td>
                            {a.status === "equal" && "✅ Đủ"}
                            {a.status === "over" && "⚠️ Vượt"}
                            {a.status === "lack" && "❌ Thiếu"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              );
            }
          )}
          {groupedHourByChuyen.size === 0 && !loading && !error && (
            <p>Chưa có dữ liệu hourAlerts.</p>
          )}
        </div>
      ) : (
        // ==== CHẾ ĐỘ 1 CHUYỀN: BẢNG THẲNG ====
        <table border={1} cellPadding={6} style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Chuyền</th>
              <th>Giờ</th>
              <th>Kế hoạch lũy tiến</th>
              <th>Thực tế</th>
              <th>Chênh lệch</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {filteredHourAlerts.map((a, idx) => (
              <tr key={idx}>
                <td>{a.chuyen}</td>
                <td>{a.hour}</td>
                <td>{a.target}</td>
                <td>{a.actual}</td>
                <td>{a.diff}</td>
                <td>
                  {a.status === "equal" && "✅ Đủ"}
                  {a.status === "over" && "⚠️ Vượt"}
                  {a.status === "lack" && "❌ Thiếu"}
                </td>
              </tr>
            ))}
            {filteredHourAlerts.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={6}>Không có dữ liệu cho chuyền đã chọn.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      /* ====================== BẢNG HIỆU SUẤT NGÀY ====================== */
      <h2 style={{ marginTop: 30 }}>Hiệu suất trong ngày</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Chuyền</th>
            <th>Hiệu suất ngày (%)</th>
            <th>Định mức ngày (%)</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {filteredDayAlerts.map((a, idx) => (
            <tr key={idx}>
              <td>{a.chuyen}</td>
              <td>{a.effDay.toFixed(2)}</td>
              <td>{a.targetEffDay.toFixed(2)}</td>
              <td>{a.status === "day_ok" ? "✅ Đạt" : "❌ Không đạt"}</td>
            </tr>
          ))}
          {filteredDayAlerts.length === 0 && !loading && !error && (
            <tr>
              <td colSpan={4}>Không có dữ liệu cho chuyền đã chọn.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* DEBUG JSON */}
      {raw && (
        <details style={{ marginTop: 20 }}>
          <summary>Debug JSON từ /api/check-kpi</summary>
          <pre style={{ fontSize: 11 }}>{JSON.stringify(raw, null, 2)}</pre>
        </details>
      )}
    </main>
  );
}