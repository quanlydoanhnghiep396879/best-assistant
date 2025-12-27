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

// chống giật
const POLL_MS = 8000;

// nếu thiếu target HS ngày trong sheet thì fallback theo chuẩn này
const DEFAULT_DAILY_TARGET_PCT = 90;

const norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s+/g, " ");

function toNum(v) {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/,/g, "").replace("%", "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// "0.9587" => 95.87, "95.87%" => 95.87, "95.87" => 95.87
function toPercentSmart(v) {
  if (v == null || v === "") return null;
  const n = toNum(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return n * 100;
  return n;
}

function findCol(header, patterns) {
  const hnorm = header.map((h) => norm(h));
  for (const p of patterns) {
    const pn = norm(p);
    const idx = hnorm.findIndex((x) => x.includes(pn));
    if (idx >= 0) return idx;
  }
  return null;
}

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

function statusHour(actual, target) {
  if (target <= 0) return { label: "N/A", type: "na", diff: 0 };
  const diff = Math.round(actual - target);

  // VƯỢT/ĐỦ/THIẾU (theo đúng yêu cầu 3 trạng thái)
  if (actual > target) return { label: "VƯỢT", type: "over", diff };
  if (actual === target) return { label: "ĐỦ", type: "ok", diff };

  // thiếu
  return { label: "THIẾU", type: "under", diff };
}

function badgeClass(type) {
  switch (type) {
    case "over":
      return "bg-green-100 text-green-800 border-green-200";
    case "ok":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "under":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loadedDate, setLoadedDate] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [isFetching, setIsFetching] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedLine, setSelectedLine] = useState("");

  // mail detect (giữ logic của bạn)
  const firstLoadRef = useRef(true);
  const prevRawRef = useRef(null);
  const lastHashRef = useRef("");

  // load config ngày
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

  // poll dữ liệu KPI cho loadedDate
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

        const newRaw = data.raw || data.values || [];

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

        // detect changes để POST (server gửi mail + log)
        const oldRaw = prevRawRef.current;
        prevRawRef.current = newRaw;

        if (!oldRaw || oldRaw.length < 2 || newRaw.length < 2) return;

        const header = newRaw[0] || [];
        const oldHeader = oldRaw[0] || [];
        if (JSON.stringify(header) !== JSON.stringify(oldHeader)) return;

        // tìm cột chuyền
        const lineCol =
          findCol(header, ["chuyền", "chuyen", "line"]) ?? 0;

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
            if (a !== b) changes.push({ checkpoint: String(header[c]).trim(), lineName });
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

  const handleLoad = () => {
    setRows([]);
    setSelectedLine("");
    setLoadedDate(selectedDate);

    firstLoadRef.current = true;
    prevRawRef.current = null;
    lastHashRef.current = "";
  };

  const parsed = useMemo(() => {
    if (!rows || rows.length < 2) return null;

    const header = rows[0] || [];
    const body = rows.slice(1);

    const iLine = findCol(header, ["chuyền", "chuyen", "line"]) ?? 0;
    const iDMH = findCol(header, ["dm/h", "đm/h"]);
    const iDMD = findCol(header, ["dm/ngày", "dm/ngay", "đm/ngày", "đm/ngay"]);

    // hiệu suất đạt được trong ngày (sheet): “SUẤT ĐẠT TRONG …”
    const iEffActual = findCol(header, [
      "suất đạt trong",
      "suat dat trong",
      "hiệu suất trong ngày",
      "hieu suat trong ngay",
      "hieu suat",
      "hiệu suất",
    ]);

    // hiệu suất định mức trong ngày (sheet): “ĐỊNH MỨC TRONG …”
    const iEffTarget = findCol(header, [
      "định mức trong",
      "dinh muc trong",
      "định mức",
      "dinh muc",
      "hs định mức",
      "hs dinh muc",
      "target hs",
    ]);

    // checkpoint columns
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

        // bảng theo giờ (lũy tiến)
        const hoursTable = CHECKPOINTS_ORDER.map((cp) => {
          const col = cpCols[cp];
          const actual = col != null ? toNum(r[col]) : 0;
          const hours = CHECKPOINT_HOURS[cp];
          const target = dmPerHour * hours;

          const st = statusHour(actual, target);
          return {
            checkpoint: cp,
            hours,
            actual,
            target: Math.round(target),
            diff: st.diff,
            status: st.label,
            statusType: st.type,
          };
        });

        const cur = hoursTable.find((x) => x.checkpoint === currentCheckpoint);

        // bảng hiệu suất ngày
        const effActualPct =
          iEffActual != null ? toPercentSmart(r[iEffActual]) : null;

        const effTargetPct =
          iEffTarget != null ? toPercentSmart(r[iEffTarget]) : DEFAULT_DAILY_TARGET_PCT;

        const effOk =
          effActualPct == null ? null : effActualPct >= effTargetPct;

        return {
          lineName,
          dmPerHour: Math.round(dmPerHour),
          dmDay: Math.round(dmD),

          currentCheckpoint,
          currentHourStatus: cur?.status ?? "N/A",
          currentHourType: cur?.statusType ?? "na",
          currentActual: cur?.actual ?? 0,
          currentTarget: cur?.target ?? 0,
          currentDiff: cur?.diff ?? 0,

          hoursTable,

          effActualPct,
          effTargetPct,
          effOk,
        };
      })
      .filter(Boolean);

    return { header, lines, currentCheckpoint };
  }, [rows]);

  const dailyTable = useMemo(() => {
    if (!parsed) return [];
    // sort: KHÔNG ĐẠT lên trước, rồi hiệu suất thấp trước
    return [...parsed.lines].sort((a, b) => {
      const aBad = a.effOk === false ? 1 : 0;
      const bBad = b.effOk === false ? 1 : 0;
      if (aBad !== bBad) return bBad - aBad;

      const ae = a.effActualPct ?? 9999;
      const be = b.effActualPct ?? 9999;
      return ae - be;
    });
  }, [parsed]);

  const filteredLines = useMemo(() => {
    if (!parsed) return [];
    const q = norm(search);
    const arr = q
      ? parsed.lines.filter((x) => norm(x.lineName).includes(q))
      : parsed.lines;

    // sort: THIẾU lên trước
    return [...arr].sort((a, b) => {
      const aBad = a.currentHourType === "under" ? 1 : 0;
      const bBad = b.currentHourType === "under" ? 1 : 0;
      if (aBad !== bBad) return bBad - aBad;
      return Math.abs(b.currentDiff) - Math.abs(a.currentDiff);
    });
  }, [parsed, search]);

  const lineDetail = useMemo(() => {
    if (!parsed || !selectedLine) return null;
    return parsed.lines.find((x) => x.lineName === selectedLine) || null;
  }, [parsed, selectedLine]);

  return (
    <section className="mt-6">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="font-medium">Ngày:</label>
          <select
            className="border px-2 py-1 rounded min-w-[160px]"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            disabled={!dates.length}
          >
            {!dates.length && <option>Đang tải ngày...</option>}
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleLoad}
          className="border rounded px-3 py-1 text-sm bg-white hover:bg-gray-50"
          disabled={!selectedDate}
        >
          Xem dữ liệu
        </button>

        <div className="text-sm text-gray-600">
          {loadedDate ? (
            <>
              Đang xem: <b>{loadedDate}</b>
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
            <span className="text-gray-500">Chọn ngày rồi bấm “Xem dữ liệu”.</span>
          )}
        </div>
      </div>

      {error && <p className="text-red-600">Lỗi: {error}</p>}

      {!error && loadedDate && !parsed && (
        <p className="text-gray-600">Chưa có dữ liệu cho ngày này.</p>
      )}

      {/* 1) BẢNG HIỆU SUẤT NGÀY (tất cả chuyền) */}
      {!error && parsed && (
        <div className="mb-4 border rounded bg-white overflow-x-auto">
          <div className="px-3 py-2 border-b font-semibold">
            Bảng so sánh hiệu suất ngày (Đạt / Không đạt)
          </div>
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="border px-2 py-2 text-left">Chuyền</th>
                <th className="border px-2 py-2 text-right">HS đạt được</th>
                <th className="border px-2 py-2 text-right">HS định mức</th>
                <th className="border px-2 py-2 text-left">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {dailyTable.map((x) => {
                const ok = x.effOk === true;
                const bad = x.effOk === false;
                return (
                  <tr key={x.lineName} className="hover:bg-gray-50">
                    <td className="border px-2 py-2 font-medium whitespace-nowrap">
                      {x.lineName}
                    </td>
                    <td className="border px-2 py-2 text-right">
                      {x.effActualPct == null ? "—" : `${x.effActualPct.toFixed(2)}%`}
                    </td>
                    <td className="border px-2 py-2 text-right">
                      {x.effTargetPct == null ? "—" : `${x.effTargetPct.toFixed(2)}%`}
                    </td>
                    <td className="border px-2 py-2">
                      {x.effOk == null ? (
                        <span className="text-gray-600">Chưa có</span>
                      ) : ok ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-600" />
                          <b className="text-green-700">ĐẠT</b>
                        </span>
                      ) : bad ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-600" />
                          <b className="text-red-700">KHÔNG ĐẠT</b>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {dailyTable.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-600" colSpan={4}>
                    Chưa có dữ liệu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 2) THEO GIỜ + CHI TIẾT CHUYỀN */}
      {!error && parsed && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* LEFT: list lines */}
          <div className="lg:col-span-1 border rounded bg-white">
            <div className="p-3 border-b">
              <input
                className="border rounded px-2 py-1 w-full text-sm"
                placeholder="Tìm chuyền..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="text-xs text-gray-600 mt-2">
                Click chuyền để xem bảng lũy tiến theo giờ.
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
              {filteredLines.map((x) => {
                const isActive = x.lineName === selectedLine;
                return (
                  <button
                    key={x.lineName}
                    onClick={() => setSelectedLine(x.lineName)}
                    className={`w-full text-left px-3 py-2 border-b hover:bg-gray-50 ${
                      isActive ? "bg-gray-50" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium whitespace-nowrap">{x.lineName}</div>
                      <span
                        className={`text-xs border rounded px-2 py-1 ${badgeClass(
                          x.currentHourType
                        )}`}
                      >
                        {x.currentHourStatus}
                      </span>
                    </div>

                    <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        {x.currentCheckpoint}: {x.currentActual}/{x.currentTarget}
                      </span>
                      <span>
                        Chênh:{" "}
                        {x.currentDiff >= 0 ? (
                          <b className="text-green-700">+{x.currentDiff}</b>
                        ) : (
                          <b className="text-red-700">{x.currentDiff}</b>
                        )}
                      </span>

                      <span>
                        HS ngày:{" "}
                        {x.effOk == null ? (
                          <span className="text-gray-500">—</span>
                        ) : x.effOk ? (
                          <b className="text-green-700">ĐẠT</b>
                        ) : (
                          <b className="text-red-700">KHÔNG ĐẠT</b>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT: detail */}
          <div className="lg:col-span-2 border rounded bg-white">
            {!lineDetail ? (
              <div className="p-4 text-gray-600">
                Chọn 1 chuyền bên trái để xem chi tiết theo giờ.
              </div>
            ) : (
              <div className="p-4">
                {/* Daily compare card */}
                <div className="border rounded p-3 mb-3 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-bold">{lineDetail.lineName}</div>
                      <div className="text-sm text-gray-600">
                        DM/H: <b>{lineDetail.dmPerHour}</b>{" "}
                        <span className="mx-2">•</span>
                        DM/NGÀY: <b>{lineDetail.dmDay}</b>
                      </div>
                    </div>

                    <div className="text-sm">
                      <div className="text-gray-600">Hiệu suất ngày</div>
                      {lineDetail.effActualPct == null ? (
                        <b className="text-gray-700">Chưa có</b>
                      ) : (
                        <b
                          className={
                            lineDetail.effOk ? "text-green-700" : "text-red-700"
                          }
                        >
                          {lineDetail.effActualPct.toFixed(2)}%{" "}
                          {lineDetail.effTargetPct != null
                            ? `(mục tiêu ${lineDetail.effTargetPct.toFixed(2)}%)`
                            : ""}
                          {" "}
                          — {lineDetail.effOk ? "ĐẠT" : "KHÔNG ĐẠT"}
                        </b>
                      )}
                    </div>
                  </div>
                </div>

                {/* Hour table */}
                <div className="overflow-x-auto border rounded">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="border px-2 py-2 text-left">Mốc</th>
                        <th className="border px-2 py-2 text-right">Lũy tiến</th>
                        <th className="border px-2 py-2 text-right">ĐM lũy tiến</th>
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
                            className={isCur ? "bg-yellow-50" : "hover:bg-gray-50"}
                          >
                            <td className="border px-2 py-2 whitespace-nowrap font-medium">
                              {h.checkpoint}{" "}
                              {isCur ? (
                                <span className="text-xs text-gray-600">(mới nhất)</span>
                              ) : null}
                            </td>
                            <td className="border px-2 py-2 text-right">{h.actual}</td>
                            <td className="border px-2 py-2 text-right">{h.target}</td>
                            <td className="border px-2 py-2 text-right">
                              {h.diff >= 0 ? (
                                <b className="text-green-700">+{h.diff}</b>
                              ) : (
                                <b className="text-red-700">{h.diff}</b>
                              )}
                            </td>
                            <td className="border px-2 py-2">
                              <span
                                className={`inline-flex items-center border rounded px-2 py-1 text-xs ${badgeClass(
                                  h.statusType
                                )}`}
                              >
                                {h.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-xs text-gray-600">
                  * “Lũy tiến” lấy từ cột <b>SỐ LƯỢNG KIỂM ĐẠT LŨY TIẾN</b> theo từng mốc giờ.
                  “ĐM lũy tiến” = <b>DM/H × số giờ</b> (nếu thiếu DM/H thì dùng <b>DM/NGÀY / 8</b>).
                  Hiệu suất ngày so sánh giữa <b>SUẤT ĐẠT TRONG …</b> và <b>ĐỊNH MỨC TRONG …</b> (nếu không có mục tiêu thì mặc định {DEFAULT_DAILY_TARGET_PCT}%).
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
