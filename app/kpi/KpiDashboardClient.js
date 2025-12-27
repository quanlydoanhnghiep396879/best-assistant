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

// UI/logic (khớp server)
const HOURLY_TOLERANCE = 0.95; // đạt >= 95% target
const DAILY_TARGET = 0.9; // đạt >= 90% DM/NGÀY

// chống giật: poll chậm hơn + chỉ setState khi data đổi
const POLL_MS = 8000;

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

// nhận biết checkpoint “mới nhất đã có số” để show trạng thái nhanh ngoài danh sách
function detectCurrentCheckpoint(header, bodyRows) {
  const colIndex = {};
  header.forEach((h, i) => {
    const k = String(h || "").trim();
    if (CHECKPOINT_HOURS[k]) colIndex[k] = i;
  });

  for (let t = CHECKPOINTS_ORDER.length - 1; t >= 0; t--) {
    const cp = CHECKPOINTS_ORDER[t];
    const c = colIndex[cp];
    if (c == null) continue;
    const hasAny = bodyRows.some((r) => toNum(r?.[c]) > 0);
    if (hasAny) return cp;
  }
  return "->9h";
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(""); // dropdown chọn
  const [loadedDate, setLoadedDate] = useState(""); // bấm nút mới load
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [isFetching, setIsFetching] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedLine, setSelectedLine] = useState("");

  // mail/changes detection (giữ như cơ chế cũ)
  const firstLoadRef = useRef(true);
  const prevRawRef = useRef(null);
  const lastHashRef = useRef("");

  // 1) load config ngày
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

  // 2) Poll KPI theo loadedDate
  useEffect(() => {
    if (!loadedDate) return;

    let stopped = false;

    const tick = async () => {
      try {
        setIsFetching(true);
        setError("");

        const params = new URLSearchParams({ date: loadedDate });
        const res = await fetch(`/api/check-kpi?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();

        if (data.status !== "success") {
          setError(data.message || "Không đọc được KPI");
          return;
        }

        const newRaw = data.raw || [];

        // chống giật: chỉ setRows khi data đổi
        const newHash = JSON.stringify(newRaw);
        if (newHash !== lastHashRef.current) {
          lastHashRef.current = newHash;
          setRows(newRaw);
        }

        // lần đầu load: không gửi mail
        if (firstLoadRef.current) {
          firstLoadRef.current = false;
          prevRawRef.current = newRaw;
          return;
        }

        // detect changes để gọi POST (server sẽ so + gửi mail + log)
        const oldRaw = prevRawRef.current;
        prevRawRef.current = newRaw;

        if (!oldRaw || oldRaw.length < 2 || newRaw.length < 2) return;

        const header = newRaw[0] || [];
        const oldHeader = oldRaw[0] || [];
        if (JSON.stringify(header) !== JSON.stringify(oldHeader)) return;

        // tìm cột chuyền
        const headerNorm = header.map((h) => norm(h));
        const lineCol =
          headerNorm.indexOf("chuyen") !== -1
            ? headerNorm.indexOf("chuyen")
            : headerNorm.indexOf("chuyền") !== -1
            ? headerNorm.indexOf("chuyền")
            : headerNorm.indexOf("line") !== -1
            ? headerNorm.indexOf("line")
            : 0;

        // cột checkpoint
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
            if (a !== b)
              changes.push({ checkpoint: String(header[c]).trim(), lineName });
          }
        }

        if (changes.length && !stopped) {
          await fetch("/api/check-kpi", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: loadedDate, changes }),
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
  }, [loadedDate]);

  // bấm nút “Xem dữ liệu”
  const handleLoad = () => {
    setRows([]);
    setSelectedLine("");
    setLoadedDate(selectedDate);

    // reset logic mail
    firstLoadRef.current = true;
    prevRawRef.current = null;
    lastHashRef.current = "";
  };

  const handleDateChange = (e) => {
    setSelectedDate(e.target.value);
    // không tự load khi đổi ngày (đúng yêu cầu “có nút bấm”)
  };

  // ===== parse dữ liệu KPI => lines + per-hour table =====
  const parsed = useMemo(() => {
    if (!rows || rows.length < 2) return null;

    const header = rows[0] || [];
    const body = rows.slice(1);

    const idx = {};
    header.forEach((h, i) => (idx[norm(h)] = i));

    const iLine =
      idx[norm("chuyen")] ?? idx[norm("chuyền")] ?? idx[norm("line")] ?? 0;

    const iDMH = idx[norm("dm/h")] ?? idx[norm("đm/h")];
    const iDMD = idx[norm("dm/ngay")] ?? idx[norm("đm/ngày")];

    const cpCols = {};
    header.forEach((h, i) => {
      const k = String(h || "").trim();
      if (CHECKPOINT_HOURS[k]) cpCols[k] = i;
    });

    const currentCheckpoint = detectCurrentCheckpoint(header, body);

    const lines = body
      .map((r) => {
        const lineName = String(r?.[iLine] || "").trim();
        if (!lineName) return null;

        const dmH = iDMH != null ? toNum(r[iDMH]) : 0;
        const dmD = iDMD != null ? toNum(r[iDMD]) : 0;
        const dmPerHour = dmH > 0 ? dmH : dmD > 0 ? dmD / 8 : 0;

        // per hour table
        const hoursTable = CHECKPOINTS_ORDER.map((cp) => {
          const col = cpCols[cp];
          const actual = col != null ? toNum(r[col]) : 0;
          const hours = CHECKPOINT_HOURS[cp];
          const target = dmPerHour * hours;
          const diff = Math.round(actual - target); // + là vượt, - là thiếu
          const ok = target > 0 ? actual >= target * HOURLY_TOLERANCE : true;
          return {
            checkpoint: cp,
            hours,
            actual,
            target: Math.round(target),
            diff,
            ok,
            deficit: Math.round(Math.max(0, target - actual)),
          };
        });

        // current status
        const cur = hoursTable.find((x) => x.checkpoint === currentCheckpoint);
        const currentOk = cur ? cur.ok : true;

        // daily
        const dayCol = cpCols["->16h30"];
        const actualDay = dayCol != null ? toNum(r[dayCol]) : 0;
        const effDay = dmD > 0 ? actualDay / dmD : null;
        const okDay = effDay == null ? null : effDay >= DAILY_TARGET;

        return {
          lineName,
          dmPerHour: Math.round(dmPerHour),
          dmDay: Math.round(dmD),
          currentCheckpoint,
          currentOk,
          currentActual: cur?.actual ?? 0,
          currentTarget: cur?.target ?? 0,
          currentDiff: cur?.diff ?? 0,
          hoursTable,
          actualDay,
          effDay,
          okDay,
        };
      })
      .filter(Boolean);

    return { header, lines, currentCheckpoint };
  }, [rows]);

  const filteredLines = useMemo(() => {
    if (!parsed) return [];
    const q = norm(search);
    const arr = q
      ? parsed.lines.filter((x) => norm(x.lineName).includes(q))
      : parsed.lines;

    // sort: FAIL trước, thiếu nhiều trước
    return [...arr].sort((a, b) => {
      const aFail = a.currentOk ? 0 : 1;
      const bFail = b.currentOk ? 0 : 1;
      if (aFail !== bFail) return bFail - aFail;
      return Math.abs(b.currentDiff) - Math.abs(a.currentDiff);
    });
  }, [parsed, search]);

  const lineDetail = useMemo(() => {
    if (!parsed || !selectedLine) return null;
    return parsed.lines.find((x) => x.lineName === selectedLine) || null;
  }, [parsed, selectedLine]);

  return (
    <section className="mt-6">
      {/* Top controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="font-medium">Ngày:</label>
          <select
            className="border px-2 py-1 rounded min-w-[160px]"
            value={selectedDate}
            onChange={handleDateChange}
            disabled={!dates.length}
          >
            {!dates.length && <option>Đang tải ngày...</option>}
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleLoad}
          className="border rounded px-3 py-1 text-sm bg-white hover:bg-gray-50"
          disabled={!selectedDate}
          title="Bấm để tải danh sách chuyền và số liệu theo giờ"
        >
          Xem dữ liệu
        </button>

        <div className="text-sm text-gray-600">
          {loadedDate ? (
            <>
              Đang xem: <b>{loadedDate}</b>{" "}
              {parsed?.currentCheckpoint ? (
                <>
                  <span className="mx-2">•</span>
                  Mốc mới nhất: <b>{parsed.currentCheckpoint}</b>
                </>
              ) : null}
              <span className="mx-2">•</span>
              {isFetching ? "Đang cập nhật..." : "Đã cập nhật"}
            </>
          ) : (
            <span className="text-gray-500">
              Chọn ngày rồi bấm “Xem dữ liệu”.
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-red-600">Lỗi: {error}</p>}

      {!error && loadedDate && !parsed && (
        <p className="text-gray-600">Chưa có dữ liệu cho ngày này.</p>
      )}

      {!error && parsed && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* LEFT: list lines */}
          <div className="lg:col-span-1 border rounded bg-white">
            <div className="p-3 border-b flex items-center gap-2">
              <input
                className="border rounded px-2 py-1 w-full text-sm"
                placeholder="Tìm chuyền..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="max-h-[520px] overflow-auto">
              {filteredLines.map((x) => {
                const isActive = x.lineName === selectedLine;
                const ok = x.currentOk;
                const diff = x.currentDiff;

                return (
                  <button
                    key={x.lineName}
                    onClick={() => setSelectedLine(x.lineName)}
                    className={`w-full text-left px-3 py-2 border-b hover:bg-gray-50 ${
                      isActive ? "bg-gray-50" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium whitespace-nowrap">
                        {x.lineName}
                      </div>
                      <div className="text-xs whitespace-nowrap">
                        {ok ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-600" />
                            <b className="text-green-700">ĐẠT</b>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-600" />
                            <b className="text-red-700">THIẾU</b>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        {x.currentCheckpoint}: {x.currentActual}/{x.currentTarget}
                      </span>
                      <span>
                        Chênh:{" "}
                        {diff >= 0 ? (
                          <b className="text-green-700">+{diff}</b>
                        ) : (
                          <b className="text-red-700">{diff}</b>
                        )}
                      </span>

                      <span>
                        Ngày:{" "}
                        {x.okDay == null ? (
                          <span className="text-gray-500">chưa có</span>
                        ) : x.okDay ? (
                          <b className="text-green-700">ĐẠT</b>
                        ) : (
                          <b className="text-red-700">KHÔNG ĐẠT</b>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}

              {!filteredLines.length && (
                <div className="p-3 text-sm text-gray-600">
                  Không tìm thấy chuyền.
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: detail */}
          <div className="lg:col-span-2 border rounded bg-white">
            {!lineDetail ? (
              <div className="p-4 text-gray-600">
                Chọn 1 chuyền bên trái để xem chi tiết từng giờ.
              </div>
            ) : (
              <div className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-lg font-bold">{lineDetail.lineName}</div>
                    <div className="text-sm text-gray-600">
                      DM/H: <b>{lineDetail.dmPerHour}</b>{" "}
                      <span className="mx-2">•</span>
                      DM/NGÀY: <b>{lineDetail.dmDay}</b>
                    </div>
                  </div>

                  <div className="text-sm">
                    {lineDetail.okDay == null ? (
                      <span className="text-gray-600">
                        Hiệu suất ngày: <b>chưa có</b>
                      </span>
                    ) : (
                      <span>
                        Hiệu suất ngày:{" "}
                        <b
                          className={
                            lineDetail.okDay ? "text-green-700" : "text-red-700"
                          }
                        >
                          {(lineDetail.effDay * 100).toFixed(2)}% (
                          {lineDetail.okDay ? "ĐẠT" : "KHÔNG ĐẠT"})
                        </b>
                      </span>
                    )}
                  </div>
                </div>

                {/* Hour table */}
                <div className="overflow-x-auto border rounded">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="border px-2 py-2 text-left">Mốc</th>
                        <th className="border px-2 py-2 text-right">Thực tế</th>
                        <th className="border px-2 py-2 text-right">Mục tiêu</th>
                        <th className="border px-2 py-2 text-right">Chênh</th>
                        <th className="border px-2 py-2 text-left">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineDetail.hoursTable.map((h) => {
                        const isCur = h.checkpoint === parsed.currentCheckpoint;
                        return (
                          <tr
                            key={h.checkpoint}
                            className={
                              isCur ? "bg-yellow-50" : "hover:bg-gray-50"
                            }
                          >
                            <td className="border px-2 py-2 whitespace-nowrap font-medium">
                              {h.checkpoint}{" "}
                              {isCur ? (
                                <span className="text-xs text-gray-600">
                                  (mới nhất)
                                </span>
                              ) : null}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {h.actual}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {h.target}
                            </td>
                            <td className="border px-2 py-2 text-right">
                              {h.diff >= 0 ? (
                                <b className="text-green-700">+{h.diff}</b>
                              ) : (
                                <b className="text-red-700">{h.diff}</b>
                              )}
                            </td>
                            <td className="border px-2 py-2">
                              {h.ok ? (
                                <span className="inline-flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-green-600" />
                                  <b className="text-green-700">ĐẠT</b>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-red-600" />
                                  <b className="text-red-700">THIẾU</b>
                                  <span className="text-gray-600 text-xs">
                                    (thiếu {h.deficit})
                                  </span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* NOTE: sửa đúng JSX ở đây */}
                <p className="mt-3 text-xs text-gray-600">
                  * Quy tắc: “ĐẠT” khi Thực tế ≥{" "}
                  {Math.round(HOURLY_TOLERANCE * 100)}% mục tiêu mốc giờ. Hiệu
                  suất ngày tính tại mốc <strong>{"->16h30"}</strong> so với{" "}
                  <strong>DM/NGÀY</strong>.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
