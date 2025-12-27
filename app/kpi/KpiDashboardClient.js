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

const POLL_MS = 8000;
const DEFAULT_HS_TARGET = 90;

const norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function normCheckpointHeader(h) {
  return String(h || "")
    .trim()
    .replace(/\s+/g, "")
    .replaceAll("→", "->");
}

function toNum(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  const sNoPct = s.endsWith("%") ? s.slice(0, -1) : s;

  const s2 =
    sNoPct.includes(",") && !sNoPct.includes(".")
      ? sNoPct.replace(",", ".")
      : sNoPct.replace(/,/g, "");

  const n = Number(s2);
  return Number.isFinite(n) ? n : 0;
}

function toPercent(v) {
  if (v == null || v === "") return null;
  const n = toNum(v);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0 && n <= 1) return n * 100;
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
  const cpCols = {};
  header.forEach((h, i) => {
    const k = normCheckpointHeader(h);
    if (CHECKPOINT_HOURS[k]) cpCols[k] = i;
  });

  for (let t = CHECKPOINTS_ORDER.length - 1; t >= 0; t--) {
    const cp = CHECKPOINTS_ORDER[t];
    const c = cpCols[cp];
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

function Chip({ type, children }) {
  const cls =
    type === "over"
      ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
      : type === "ok"
      ? "border border-blue-300 bg-blue-50 text-blue-700"
      : type === "under"
      ? "border border-red-300 bg-red-50 text-red-700"
      : "border border-slate-300 bg-slate-50 text-slate-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function isLikelyLineName(s) {
  const x = String(s || "").trim();
  if (!x) return false;
  const u = x.toUpperCase();
  if (
    u.includes("TOTAL") ||
    u.includes("TỔNG") ||
    u.includes("KIỂM ĐẠT") ||
    u.includes("MAY RA")
  )
    return false;
  return true;
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loadedDate, setLoadedDate] = useState("");

  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [isFetching, setIsFetching] = useState(false);

  const [q, setQ] = useState("");
  const [selectedLine, setSelectedLine] = useState(null);

  const firstLoadRef = useRef(true);
  const lastHashRef = useRef("");

  // Load CONFIG_KPI
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

  const handleLoad = () => {
    if (!selectedDate) return;
    setLoadedDate(selectedDate);
    setSelectedLine(null);
    firstLoadRef.current = true;
    lastHashRef.current = "";
  };

  // Poll KPI
  useEffect(() => {
    if (!loadedDate) return;

    let stop = false;

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

        const raw = data.raw || data.values || [];
        const hash = JSON.stringify(raw);

        if (hash !== lastHashRef.current) {
          lastHashRef.current = hash;
          setRows(raw);
        }

        if (firstLoadRef.current) firstLoadRef.current = false;
        if (stop) return;
      } catch (err) {
        setError(err.message || "Lỗi khi gọi API KPI");
      } finally {
        setIsFetching(false);
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [loadedDate]);

  const parsed = useMemo(() => {
    if (!rows || rows.length < 2) return null;

    const header = rows[0] || [];
    const body = rows.slice(1);

    // Layout fixed theo sheet bạn:
    // DM/NGÀY = H (7), DM/H = I (8), HS actual = S (18), HS target = T (19)
    const iLine = 0;
    const iDMD =
      findCol(header, ["dm/ngày", "dm/ngay", "đm/ngày", "đm/ngay"]) ?? 7;
    const iDMH = findCol(header, ["dm/h", "đm/h"]) ?? 8;
    const iHsActual =
      findCol(header, ["suất đạt", "suat dat", "hiệu suất", "hieu suat"]) ?? 18;
    const iHsTarget = findCol(header, ["định mức", "dinh muc"]) ?? 19;

    // checkpoint columns
    const cpCols = {};
    header.forEach((h, i) => {
      const k = normCheckpointHeader(h);
      if (CHECKPOINT_HOURS[k]) cpCols[k] = i;
    });

    const currentCheckpoint = detectCurrentCheckpoint(header, body);

    const lines = body
      .map((r, idx) => {
        const lineName = String(r?.[iLine] || "").trim();
        if (!isLikelyLineName(lineName)) return null;

        const dmH = toNum(r[iDMH]);
        const dmD = toNum(r[iDMD]);
        const dmPerHour = dmH > 0 ? dmH : dmD > 0 ? dmD / 8 : 0;

        const hsAchieved = toPercent(r[iHsActual]);
        const hsTargetRaw = toPercent(r[iHsTarget]);
        const hsTarget =
          hsTargetRaw && hsTargetRaw > 0 ? hsTargetRaw : DEFAULT_HS_TARGET;

        const hsStatus =
          hsAchieved == null
            ? "CHƯA CÓ"
            : hsAchieved >= hsTarget
            ? "ĐẠT"
            : "KHÔNG ĐẠT";

        const hoursTable = CHECKPOINTS_ORDER.map((cp) => {
          const col = cpCols[cp];
          const actual = col != null ? toNum(r[col]) : 0;
          const hours = CHECKPOINT_HOURS[cp];
          const target = dmPerHour * hours;
          const st = statusHour(actual, target);
          return {
            checkpoint: cp,
            actual,
            target: Math.round(target),
            diff: st.diff,
            status: st.label,
            statusType: st.type,
          };
        });

        const cur = hoursTable.find((x) => x.checkpoint === currentCheckpoint);

        return {
          key: `${lineName}__${idx}`,
          lineName,
          dmH,
          dmD,
          dmPerHour,
          hsAchieved,
          hsTarget,
          hsStatus,
          currentCheckpoint,
          currentActual: cur?.actual ?? 0,
          currentTarget: cur?.target ?? 0,
          currentDiff: cur?.diff ?? 0,
          currentHourStatus: cur?.status ?? "N/A",
          currentHourType: cur?.statusType ?? "na",
          hoursTable,
        };
      })
      .filter(Boolean);

    return { lines, currentCheckpoint };
  }, [rows]);

  const filteredLines = useMemo(() => {
    if (!parsed?.lines) return [];
    const t = q.trim().toLowerCase();
    if (!t) return parsed.lines;
    return parsed.lines.filter((x) => x.lineName.toLowerCase().includes(t));
  }, [parsed, q]);

  const detail = useMemo(() => {
    if (!parsed?.lines || !selectedLine) return null;
    return parsed.lines.find((x) => x.key === selectedLine) || null;
  }, [parsed, selectedLine]);

  return (
    <section className="mt-6">
      {/* top bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="font-medium">Ngày:</label>
        <select
          className="border px-2 py-1 rounded min-w-[160px]"
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

        <button
          onClick={handleLoad}
          className="border px-3 py-1.5 rounded bg-white hover:bg-gray-50"
          disabled={!selectedDate}
        >
          Xem dữ liệu
        </button>

        {loadedDate && (
          <span className="text-sm text-gray-600">
            {isFetching ? "Đang cập nhật..." : "Đã cập nhật"} • <b>{loadedDate}</b>{" "}
            • <span className="ml-1">Mốc: {parsed?.currentCheckpoint || "—"}</span>
          </span>
        )}
      </div>

      {error && <p className="text-red-600">Lỗi: {error}</p>}
      {!error && loadedDate && !parsed && <p>Chưa có dữ liệu cho ngày này.</p>}

      {!error && parsed && (
        <>
          {/* 2 cột: HS ngày (trái) + Lũy tiến (phải) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT: HS ngày */}
            <div className="border rounded bg-white overflow-hidden">
              <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
                <div className="font-semibold">Hiệu suất ngày</div>
                <div className="text-xs text-gray-600">
                  Chuẩn mặc định: {DEFAULT_HS_TARGET}%
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="border px-2 py-2 text-left">Chuyền</th>
                      <th className="border px-2 py-2 text-left">HS đạt</th>
                      <th className="border px-2 py-2 text-left">HS chuẩn</th>
                      <th className="border px-2 py-2 text-left">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.lines.map((x) => (
                      <tr key={`hs_${x.key}`} className="hover:bg-gray-50">
                        <td className="border px-2 py-2 font-semibold">
                          {x.lineName}
                        </td>
                        <td className="border px-2 py-2">
                          {x.hsAchieved == null
                            ? "—"
                            : `${x.hsAchieved.toFixed(2)}%`}
                        </td>
                        <td className="border px-2 py-2">
                          {`${x.hsTarget.toFixed(2)}%`}
                        </td>
                        <td className="border px-2 py-2">
                          <Chip
                            type={
                              x.hsStatus === "ĐẠT"
                                ? "over"
                                : x.hsStatus === "KHÔNG ĐẠT"
                                ? "under"
                                : "na"
                            }
                          >
                            {x.hsStatus}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT: Lũy tiến vs ĐM lũy tiến tại mốc hiện tại */}
            <div className="border rounded bg-white overflow-hidden">
              <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between gap-2">
                <div className="font-semibold">
                  Lũy tiến theo giờ (mốc {parsed.currentCheckpoint})
                </div>
                <input
                  className="border rounded px-2 py-1 text-sm w-[170px]"
                  placeholder="Tìm chuyền..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="border px-2 py-2 text-left">Chuyền</th>
                      <th className="border px-2 py-2 text-right">Lũy tiến</th>
                      <th className="border px-2 py-2 text-right">ĐM LT</th>
                      <th className="border px-2 py-2 text-right">Chênh</th>
                      <th className="border px-2 py-2 text-left">Trạng thái</th>
                      <th className="border px-2 py-2 text-left">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLines.map((x) => (
                      <tr key={`lt_${x.key}`} className="hover:bg-gray-50">
                        <td className="border px-2 py-2 font-semibold">
                          {x.lineName}
                        </td>
                        <td className="border px-2 py-2 text-right">
                          {x.currentActual}
                        </td>
                        <td className="border px-2 py-2 text-right">
                          {x.currentTarget}
                        </td>
                        <td className="border px-2 py-2 text-right">
                          {x.currentDiff >= 0
                            ? `+${x.currentDiff}`
                            : x.currentDiff}
                        </td>
                        <td className="border px-2 py-2">
                          <Chip type={x.currentHourType}>
                            {x.currentHourStatus}
                          </Chip>
                        </td>
                        <td className="border px-2 py-2">
                          <button
                            className="border rounded px-2 py-1 text-xs hover:bg-gray-50"
                            onClick={() => setSelectedLine(x.key)}
                          >
                            Xem
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!filteredLines.length && (
                      <tr>
                        <td
                          className="border px-2 py-3 text-center text-gray-500"
                          colSpan={6}
                        >
                          Không tìm thấy chuyền phù hợp
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Bảng chi tiết 8 mốc: chỉ hiện khi bấm Xem */}
          {detail && (
            <div className="mt-4 border rounded bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="text-lg font-bold">{detail.lineName}</div>
                <button
                  className="border rounded px-3 py-1 text-sm hover:bg-gray-50"
                  onClick={() => setSelectedLine(null)}
                >
                  Đóng
                </button>
              </div>

              <div className="text-sm mb-2">
                <b>DM/H:</b> {detail.dmH || 0} • <b>DM/NGÀY:</b>{" "}
                {detail.dmD || 0} • <b>HS ngày:</b>{" "}
                {detail.hsAchieved == null
                  ? "—"
                  : `${detail.hsAchieved.toFixed(2)}%`}{" "}
                vs {detail.hsTarget.toFixed(2)}% → <b>{detail.hsStatus}</b>
              </div>

              <div className="overflow-x-auto">
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
                    {detail.hoursTable.map((h) => (
                      <tr
                        key={`${detail.key}_${h.checkpoint}`}
                        className="hover:bg-gray-50"
                      >
                        <td className="border px-2 py-2">
                          {h.checkpoint}{" "}
                          {h.checkpoint === parsed.currentCheckpoint && (
                            <span className="text-emerald-700 font-semibold">
                              (mới nhất)
                            </span>
                          )}
                        </td>
                        <td className="border px-2 py-2 text-right">{h.actual}</td>
                        <td className="border px-2 py-2 text-right">{h.target}</td>
                        <td className="border px-2 py-2 text-right">
                          {h.diff >= 0 ? `+${h.diff}` : h.diff}
                        </td>
                        <td className="border px-2 py-2">
                          <Chip type={h.statusType}>{h.status}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
