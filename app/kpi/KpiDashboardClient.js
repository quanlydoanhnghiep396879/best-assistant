"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const CHECKPOINTS_ORDER = [
  "->9h",
  "->10h",
  "->11h",
  "->12h30",
  "->13h30",
  "->14h30",
  "->15h30",
  "->16h30",
];

const CHECKPOINT_HOURS = {
  "->9h": 1,
  "->10h": 2,
  "->11h": 3,
  "->12h30": 4,
  "->13h30": 5,
  "->14h30": 6,
  "->15h30": 7,
  "->16h30": 8,
};

// giảm giật: poll chậm lại
const POLL_MS = 8000; // bạn có thể đổi 6000 / 10000 tùy thích

const HOURLY_TOLERANCE = 0.95; // giống server: đạt >= 95% mục tiêu giờ
const DAILY_TARGET = 0.9;      // cuối ngày đạt >= 90% DM/NGAY

const norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

function toNum(v) {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/,/g, "").replace("%", "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// tìm checkpoint “hiện tại” dựa theo dữ liệu đã được nhập (cột ngoài cùng có số)
function detectCurrentCheckpoint(header, bodyRows) {
  const cpCols = [];
  header.forEach((h, i) => {
    const k = String(h || "").trim();
    if (CHECKPOINT_HOURS[k]) cpCols.push({ k, i });
  });

  // duyệt từ cuối về đầu: cột nào có ít nhất 1 dòng >0 thì chọn làm checkpoint hiện tại
  for (let t = CHECKPOINTS_ORDER.length - 1; t >= 0; t--) {
    const cp = CHECKPOINTS_ORDER[t];
    const col = cpCols.find((x) => x.k === cp)?.i;
    if (col == null) continue;
    const hasAny = bodyRows.some((r) => toNum(r?.[col]) > 0);
    if (hasAny) return cp;
  }

  // nếu chưa có số liệu giờ nào, default ->9h
  return "->9h";
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const firstLoadRef = useRef(true);
  const prevRawRef = useRef(null);
  const lastHashRef = useRef("");

  // 1) Load danh sách ngày
  useEffect(() => {
    async function loadConfig() {
      try {
        setError("");
        const res = await fetch("/api/kpi-config", { cache: "no-store" });
        const data = await res.json();

        if (data.status !== "success") {
          setError(data.message || "Không đọc được CONFIG_KPI");
          return;
        }

        const ds = data.dates || [];
        setDates(ds);
        if (ds.length > 0) setSelectedDate(ds[ds.length - 1]);
      } catch (err) {
        setError(err.message || "Lỗi khi đọc CONFIG_KPI");
      }
    }
    loadConfig();
  }, []);

  // 2) Poll KPI: cập nhật hiển thị + phát hiện thay đổi để gọi POST gửi mail
  useEffect(() => {
    if (!selectedDate) return;

    let stopped = false;

    const tick = async () => {
      try {
        setIsFetching(true);
        setError("");

        const params = new URLSearchParams({ date: selectedDate });
        const res = await fetch(`/api/check-kpi?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();

        if (data.status !== "success") {
          setError(data.message || "Không đọc được KPI");
          return;
        }

        const newRaw = data.raw || [];

        // chỉ setState nếu dữ liệu thật sự đổi (giảm giật)
        const newHash = JSON.stringify(newRaw);
        if (newHash !== lastHashRef.current) {
          lastHashRef.current = newHash;
          setRows(newRaw);
        }

        // lần đầu mở: không gửi mail
        if (firstLoadRef.current) {
          firstLoadRef.current = false;
          prevRawRef.current = newRaw;
          return;
        }

        // detect changes để gọi POST (mail)
        const oldRaw = prevRawRef.current;
        prevRawRef.current = newRaw;

        if (!oldRaw || oldRaw.length < 2 || newRaw.length < 2) return;

        const header = newRaw[0] || [];
        const oldHeader = oldRaw[0] || [];
        if (JSON.stringify(header) !== JSON.stringify(oldHeader)) return;

        // tìm cột tên chuyền
        const headerNorm = header.map((h) => norm(h));
        const lineCol =
          headerNorm.indexOf("chuyen") !== -1
            ? headerNorm.indexOf("chuyen")
            : headerNorm.indexOf("chuyền") !== -1
            ? headerNorm.indexOf("chuyền")
            : headerNorm.indexOf("line") !== -1
            ? headerNorm.indexOf("line")
            : 0;

        // checkpoint cols
        const cpCols = [];
        header.forEach((h, i) => {
          const k = String(h || "").trim();
          if (CHECKPOINT_HOURS[k]) cpCols.push(i);
        });

        const changes = [];
        const n = Math.min(oldRaw.length, newRaw.length);

        for (let r = 1; r < n; r++) {
          const lineName = String(newRaw[r]?.[lineCol] || "").trim();
          if (!lineName) continue;

          for (const c of cpCols) {
            const a = String(oldRaw[r]?.[c] ?? "");
            const b = String(newRaw[r]?.[c] ?? "");
            if (a !== b) {
              changes.push({ checkpoint: String(header[c]).trim(), lineName });
            }
          }
        }

        if (changes.length && !stopped) {
          // gọi POST để server so sánh + gửi mail + log
          await fetch("/api/check-kpi", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: selectedDate, changes }),
          });
        }
      } catch (err) {
        setError(err.message || "Lỗi khi gọi API KPI");
      } finally {
        setIsFetching(false);
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [selectedDate]);

  const handleDateChange = (e) => {
    firstLoadRef.current = true;
    prevRawRef.current = null;
    lastHashRef.current = "";
    setRows([]);
    setSelectedDate(e.target.value);
  };

  // ====== TÍNH “TRẠNG THÁI” ĐỂ HIỂN THỊ GỌN ======
  const view = useMemo(() => {
    if (!rows || rows.length < 2) return null;

    const header = rows[0];
    const body = rows.slice(1);

    const idx = {};
    header.forEach((h, i) => (idx[norm(h)] = i));

    const iLine =
      idx[norm("chuyen")] ?? idx[norm("chuyền")] ?? idx[norm("line")] ?? 0;

    const iDMH = idx[norm("dm/h")] ?? idx[norm("đm/h")];
    const iDMD = idx[norm("dm/ngay")] ?? idx[norm("đm/ngày")];

    const currentCheckpoint = detectCurrentCheckpoint(header, body);
    const cpCol = header.findIndex((h) => String(h || "").trim() === currentCheckpoint);
    const hours = CHECKPOINT_HOURS[currentCheckpoint] || 1;

    const lines = body
      .map((r) => {
        const lineName = String(r?.[iLine] || "").trim();
        if (!lineName) return null;

        const dmH = iDMH != null ? toNum(r[iDMH]) : 0;
        const dmD = iDMD != null ? toNum(r[iDMD]) : 0;
        const dmPerHour = dmH > 0 ? dmH : dmD > 0 ? dmD / 8 : 0;

        const actual = cpCol >= 0 ? toNum(r[cpCol]) : 0;
        const target = dmPerHour * hours;

        const ok = target > 0 ? actual >= target * HOURLY_TOLERANCE : true;
        const deficit = Math.round(Math.max(0, target - actual));
        const ratio = target > 0 ? actual / target : 1;

        // daily (nếu có dữ liệu cuối ngày)
        const col1630 = header.findIndex((h) => String(h || "").trim() === "->16h30");
        const actualDay = col1630 >= 0 ? toNum(r[col1630]) : 0;
        const effDay = dmD > 0 ? actualDay / dmD : null;
        const okDay = effDay == null ? null : effDay >= DAILY_TARGET;

        return {
          lineName,
          actual,
          target: Math.round(target),
          deficit,
          ok,
          ratio,
          dmPerHour: Math.round(dmPerHour),
          dmDay: Math.round(dmD),
          actualDay,
          effDay,
          okDay,
        };
      })
      .filter(Boolean);

    const fail = lines.filter((x) => !x.ok).sort((a, b) => b.deficit - a.deficit);
    const okCount = lines.length - fail.length;

    return {
      header,
      currentCheckpoint,
      lines,
      fail,
      okCount,
      failCount: fail.length,
      total: lines.length,
    };
  }, [rows]);

  const nowStr = useMemo(() => {
    const d = new Date();
    return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  }, [isFetching]); // đổi nhẹ theo fetch

  return (
    <section className="mt-6">
      {/* chọn ngày + trạng thái fetch */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="kpi-date" className="font-medium">Ngày:</label>
          <select
            id="kpi-date"
            className="border px-2 py-1 rounded min-w-[160px]"
            value={selectedDate}
            onChange={handleDateChange}
            disabled={!dates.length}
          >
            {!dates.length && <option>Đang tải ngày...</option>}
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="text-sm text-gray-600">
          {view?.currentCheckpoint ? (
            <>
              Mốc đang theo dõi: <b>{view.currentCheckpoint}</b>{" "}
              <span className="mx-2">•</span>
              {isFetching ? "Đang cập nhật..." : "Đã cập nhật"}
              <span className="mx-2">•</span>
              {nowStr}
            </>
          ) : (
            isFetching ? "Đang tải..." : ""
          )}
        </div>

        <button
          className="ml-auto border rounded px-3 py-1 text-sm hover:bg-gray-50"
          onClick={() => setShowAll((v) => !v)}
          disabled={!view}
        >
          {showAll ? "Chỉ hiện chuyền KHÔNG ĐẠT" : "Hiện tất cả chuyền"}
        </button>
      </div>

      {error && <p className="text-red-600">Lỗi: {error}</p>}

      {!error && !view && (
        <p className="text-gray-600">Chưa có dữ liệu cho ngày này.</p>
      )}

      {!error && view && (
        <>
          {/* summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className="border rounded p-3 bg-white">
              <div className="text-sm text-gray-600">Tổng số chuyền</div>
              <div className="text-2xl font-bold">{view.total}</div>
            </div>
            <div className="border rounded p-3 bg-white">
              <div className="text-sm text-gray-600">ĐẠT (mốc {view.currentCheckpoint})</div>
              <div className="text-2xl font-bold text-green-700">{view.okCount}</div>
            </div>
            <div className="border rounded p-3 bg-white">
              <div className="text-sm text-gray-600">KHÔNG ĐẠT (mốc {view.currentCheckpoint})</div>
              <div className="text-2xl font-bold text-red-700">{view.failCount}</div>
            </div>
          </div>

          {/* bảng gọn */}
          <div className="overflow-x-auto border rounded bg-white">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-2 py-2 text-left">Chuyền</th>
                  <th className="border px-2 py-2 text-right">DM/H</th>
                  <th className="border px-2 py-2 text-right">Thực tế</th>
                  <th className="border px-2 py-2 text-right">Mục tiêu</th>
                  <th className="border px-2 py-2 text-right">Thiếu</th>
                  <th className="border px-2 py-2 text-left">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? view.lines : view.fail).map((x) => (
                  <tr key={x.lineName} className="hover:bg-gray-50">
                    <td className="border px-2 py-2 whitespace-nowrap font-medium">
                      {x.lineName}
                    </td>
                    <td className="border px-2 py-2 text-right">{x.dmPerHour}</td>
                    <td className="border px-2 py-2 text-right">{x.actual}</td>
                    <td className="border px-2 py-2 text-right">{x.target}</td>
                    <td className="border px-2 py-2 text-right">
                      {x.deficit > 0 ? <span className="text-red-700 font-semibold">{x.deficit}</span> : 0}
                    </td>
                    <td className="border px-2 py-2">
                      {x.ok ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-600" />
                          <b className="text-green-700">ĐẠT</b>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-600" />
                          <b className="text-red-700">KHÔNG ĐẠT</b>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!showAll && view.fail.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-green-700 font-semibold" colSpan={6}>
                      Tất cả chuyền đều ĐẠT ở mốc {view.currentCheckpoint}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ghi chú nhỏ */}
          <p className="mt-3 text-xs text-gray-600">
            * Mốc theo dõi tự nhận biết dựa vào cột giờ ngoài cùng đã có số liệu. “ĐẠT” khi Thực tế ≥ {Math.round(HOURLY_TOLERANCE * 100)}% mục tiêu mốc giờ.
          </p>
        </>
      )}
    </section>
  );
}
