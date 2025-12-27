"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** ====== BRAND COLORS (đổi đúng màu công ty ở đây) ====== */
const BRAND_PRIMARY = "#0B1F3A"; // navy
const BRAND_ACCENT = "#14B8A6";  // teal
/** ====================================================== */

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

const POLL_MS = 8000;
const DEFAULT_DAILY_TARGET_PCT = 90;

const norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function toNum(v) {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/,/g, "").replace("%", "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

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
  if (actual > target) return { label: "VƯỢT", type: "over", diff };
  if (actual === target) return { label: "ĐỦ", type: "ok", diff };
  return { label: "THIẾU", type: "under", diff };
}

function badgeClass(type) {
  switch (type) {
    case "over":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "ok":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "under":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

function rowTintByStatus(type) {
  switch (type) {
    case "over":
      return "bg-emerald-50/40";
    case "ok":
      return "bg-blue-50/40";
    case "under":
      return "bg-red-50/40";
    default:
      return "";
  }
}

function Chip({ type, children }) {
  return (
    <span className={`inline-flex items-center border rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass(type)}`}>
      {children}
    </span>
  );
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

  const firstLoadRef = useRef(true);
  const prevRawRef = useRef(null);
  const lastHashRef = useRef("");

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

        if (firstLoadRef.current) {
          firstLoadRef.current = false;
          prevRawRef.current = newRaw;
          return;
        }

        const oldRaw = prevRawRef.current;
        prevRawRef.current = newRaw;

        if (!oldRaw || oldRaw.length < 2 || newRaw.length < 2) return;

        const header = newRaw[0] || [];
        const oldHeader = oldRaw[0] || [];
        if (JSON.stringify(header) !== JSON.stringify(oldHeader)) return;

        const lineCol = findCol(header, ["chuyền", "chuyen", "line"]) ?? 0;

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

    const iEffActual = findCol(header, [
      "suất đạt trong",
      "suat dat trong",
      "hiệu suất trong ngày",
      "hieu suat trong ngay",
      "hiệu suất",
      "hieu suat",
    ]);

    const iEffTarget = findCol(header, [
      "định mức trong",
      "dinh muc trong",
      "định mức",
      "dinh muc",
      "hs định mức",
      "hs dinh muc",
    ]);

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

        const effActualPct = iEffActual != null ? toPercentSmart(r[iEffActual]) : null;
        const effTargetPct = iEffTarget != null ? toPercentSmart(r[iEffTarget]) : DEFAULT_DAILY_TARGET_PCT;
        const effOk = effActualPct == null ? null : effActualPct >= effTargetPct;

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
    const arr = q ? parsed.lines.filter((x) => norm(x.lineName).includes(q)) : parsed.lines;

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

  const topCard = (title, value, sub) => (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
      <div className="text-xs font-semibold text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-sm text-slate-600">{sub}</div> : null}
    </div>
  );

  return (
    <section>
      {/* Controls Card */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">Ngày</label>
            <select
              className="border border-slate-200 px-3 py-2 rounded-xl text-sm bg-white focus:outline-none focus:ring-2"
              style={{ boxShadow: "0 0 0 0 transparent" }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
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
            disabled={!selectedDate}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
            style={{
              background: `linear-gradient(90deg, ${BRAND_PRIMARY}, ${BRAND_ACCENT})`,
            }}
          >
            Xem dữ liệu
          </button>

          <div className="text-sm text-slate-600">
            {loadedDate ? (
              <>
                Đang xem: <b className="text-slate-900">{loadedDate}</b>
                {parsed?.currentCheckpoint ? (
                  <>
                    <span className="mx-2 text-slate-300">•</span>
                    Mốc mới nhất: <b className="text-slate-900">{parsed.currentCheckpoint}</b>
                  </>
                ) : null}
                <span className="mx-2 text-slate-300">•</span>
                {isFetching ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: BRAND_ACCENT }} />
                    Đang cập nhật...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: BRAND_ACCENT }} />
                    Đã cập nhật
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500">Chọn ngày rồi bấm “Xem dữ liệu”.</span>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <b>Lỗi:</b> {error}
          </div>
        )}

        {/* Quick KPIs */}
        {parsed && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {topCard("Tổng số chuyền", parsed.lines.length, "Danh sách theo KPI sheet")}
            {topCard(
              "Mốc đang theo dõi",
              parsed.currentCheckpoint || "—",
              `Lũy tiến theo giờ (${CHECKPOINTS_ORDER.length} mốc)`
            )}
            {topCard("Chuẩn HS ngày mặc định", `${DEFAULT_DAILY_TARGET_PCT}%`, "Dùng khi thiếu “ĐỊNH MỨC …”")}
          </div>
        )}
      </div>

      {!error && loadedDate && !parsed && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm p-4 text-slate-600">
          Chưa có dữ liệu cho ngày này.
        </div>
      )}

      {/* Daily table */}
      {!error && parsed && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">Hiệu suất ngày</div>
              <div className="text-xs text-slate-500">
                So sánh <b>HS đạt được</b> vs <b>HS định mức</b> → Đạt/Không đạt
              </div>
            </div>
            <span
              className="text-xs font-semibold border rounded-full px-3 py-1"
              style={{ borderColor: `${BRAND_ACCENT}55`, color: BRAND_PRIMARY, background: `${BRAND_ACCENT}12` }}
            >
              Tổng: {dailyTable.length} chuyền
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b px-3 py-3 text-left font-semibold text-slate-600">Chuyền</th>
                  <th className="border-b px-3 py-3 text-right font-semibold text-slate-600">HS đạt được</th>
                  <th className="border-b px-3 py-3 text-right font-semibold text-slate-600">HS định mức</th>
                  <th className="border-b px-3 py-3 text-left font-semibold text-slate-600">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {dailyTable.map((x) => {
                  const ok = x.effOk === true;
                  const bad = x.effOk === false;
                  return (
                    <tr
                      key={x.lineName}
                      className={`hover:bg-slate-50 cursor-pointer ${
                        bad ? "bg-red-50/30" : ok ? "bg-emerald-50/25" : ""
                      }`}
                      onClick={() => setSelectedLine(x.lineName)}
                    >
                      <td className="border-b px-3 py-3 font-semibold text-slate-900 whitespace-nowrap">
                        {x.lineName}
                      </td>
                      <td className="border-b px-3 py-3 text-right">
                        {x.effActualPct == null ? "—" : `${x.effActualPct.toFixed(2)}%`}
                      </td>
                      <td className="border-b px-3 py-3 text-right">
                        {x.effTargetPct == null ? "—" : `${x.effTargetPct.toFixed(2)}%`}
                      </td>
                      <td className="border-b px-3 py-3">
                        {x.effOk == null ? (
                          <Chip type="na">CHƯA CÓ</Chip>
                        ) : ok ? (
                          <Chip type="over">ĐẠT</Chip>
                        ) : bad ? (
                          <Chip type="under">KHÔNG ĐẠT</Chip>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}

                {dailyTable.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-slate-600" colSpan={4}>
                      Chưa có dữ liệu.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Split: lines list + details */}
      {!error && parsed && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left list */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b">
              <div className="text-sm font-bold text-slate-900">Danh sách chuyền</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{ outlineColor: BRAND_ACCENT }}
                  placeholder="Tìm chuyền..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Click để xem chi tiết lũy tiến theo giờ.
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
              {filteredLines.map((x) => (
                <button
                  key={x.lineName}
                  onClick={() => setSelectedLine(x.lineName)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-slate-50 ${
                    x.lineName === selectedLine ? "bg-slate-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900 whitespace-nowrap">
                      {x.lineName}
                    </div>
                    <Chip type={x.currentHourType}>{x.currentHourStatus}</Chip>
                  </div>

                  <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      {x.currentCheckpoint}: <b className="text-slate-900">{x.currentActual}</b>/
                      {x.currentTarget}
                    </span>
                    <span>
                      Chênh:{" "}
                      {x.currentDiff >= 0 ? (
                        <b className="text-emerald-700">+{x.currentDiff}</b>
                      ) : (
                        <b className="text-red-700">{x.currentDiff}</b>
                      )}
                    </span>
                    <span>
                      HS ngày:{" "}
                      {x.effOk == null ? (
                        <span className="text-slate-400">—</span>
                      ) : x.effOk ? (
                        <b className="text-emerald-700">ĐẠT</b>
                      ) : (
                        <b className="text-red-700">KHÔNG ĐẠT</b>
                      )}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right detail */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {!lineDetail ? (
              <div className="p-6 text-slate-600">
                Chọn 1 chuyền để xem chi tiết lũy tiến theo giờ.
              </div>
            ) : (
              <div className="p-5">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-extrabold" style={{ color: BRAND_PRIMARY }}>
                      {lineDetail.lineName}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      DM/H: <b className="text-slate-900">{lineDetail.dmPerHour}</b>{" "}
                      <span className="mx-2 text-slate-300">•</span>
                      DM/NGÀY: <b className="text-slate-900">{lineDetail.dmDay}</b>
                    </div>
                  </div>

                  {/* Daily status */}
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-500">Hiệu suất ngày</div>
                    {lineDetail.effActualPct == null ? (
                      <div className="mt-1">
                        <Chip type="na">CHƯA CÓ</Chip>
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center justify-end gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {lineDetail.effActualPct.toFixed(2)}%
                        </span>
                        <span className="text-xs text-slate-500">
                          / {lineDetail.effTargetPct?.toFixed(2)}%
                        </span>
                        <Chip type={lineDetail.effOk ? "over" : "under"}>
                          {lineDetail.effOk ? "ĐẠT" : "KHÔNG ĐẠT"}
                        </Chip>
                      </div>
                    )}
                  </div>
                </div>

                {/* Hour table */}
                <div className="mt-4 overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="border-b px-3 py-3 text-left font-semibold text-slate-600">Mốc</th>
                        <th className="border-b px-3 py-3 text-right font-semibold text-slate-600">Lũy tiến</th>
                        <th className="border-b px-3 py-3 text-right font-semibold text-slate-600">ĐM lũy tiến</th>
                        <th className="border-b px-3 py-3 text-right font-semibold text-slate-600">Chênh</th>
                        <th className="border-b px-3 py-3 text-left font-semibold text-slate-600">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineDetail.hoursTable.map((h) => {
                        const isCur = h.checkpoint === parsed.currentCheckpoint;
                        return (
                          <tr
                            key={h.checkpoint}
                            className={`${rowTintByStatus(h.statusType)} hover:bg-slate-50 ${
                              isCur ? "outline outline-2 outline-offset-[-2px]" : ""
                            }`}
                            style={isCur ? { outlineColor: `${BRAND_ACCENT}66` } : undefined}
                          >
                            <td className="border-b px-3 py-3 whitespace-nowrap font-semibold text-slate-900">
                              {h.checkpoint}{" "}
                              {isCur ? (
                                <span className="ml-2 text-xs font-semibold" style={{ color: BRAND_ACCENT }}>
                                  (mới nhất)
                                </span>
                              ) : null}
                            </td>
                            <td className="border-b px-3 py-3 text-right">{h.actual}</td>
                            <td className="border-b px-3 py-3 text-right">{h.target}</td>
                            <td className="border-b px-3 py-3 text-right">
                              {h.diff >= 0 ? (
                                <b className="text-emerald-700">+{h.diff}</b>
                              ) : (
                                <b className="text-red-700">{h.diff}</b>
                              )}
                            </td>
                            <td className="border-b px-3 py-3">
                              <Chip type={h.statusType}>{h.status}</Chip>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 text-xs text-slate-500 leading-relaxed">
                  * “Lũy tiến” lấy từ cột <b>SỐ LƯỢNG KIỂM ĐẠT LŨY TIẾN</b> theo từng mốc giờ.
                  “ĐM lũy tiến” = <b>DM/H × số giờ</b> (nếu thiếu DM/H thì dùng <b>DM/NGÀY / 8</b>).
                  Hiệu suất ngày so sánh giữa <b>SUẤT ĐẠT TRONG …</b> và <b>ĐỊNH MỨC TRONG …</b>.
                  Chữ <strong>{"->16h30"}</strong> chỉ là mốc cuối ngày.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
