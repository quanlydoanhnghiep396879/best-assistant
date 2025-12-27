'use client';

import { useEffect, useMemo, useState } from 'react';

const MILESTONES = [
  { key: '->9h', label: '->9h', hours: 1 },
  { key: '->10h', label: '->10h', hours: 2 },
  { key: '->11h', label: '->11h', hours: 3 },
  { key: '->12h30', label: '->12h30', hours: 4 },
  { key: '->13h30', label: '->13h30', hours: 5 },
  { key: '->14h30', label: '->14h30', hours: 6 },
  { key: '->15h30', label: '->15h30', hours: 7 },
  { key: '->16h30', label: '->16h30', hours: 8 },
];

const OTHER_LINES = new Set(['CẮT', 'CAT', 'KCS', 'HOÀN TẤT', 'HOAN TAT', 'NM']);

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPercent(v) {
  const n = toNumber(v);
  if (n === null) return null;
  // UNFORMATTED_VALUE của % thường trả 0.9587 => 95.87
  if (n <= 1.5) return n * 100;
  return n;
}

function normalizeLineName(x) {
  const s = String(x ?? '').trim();
  return s;
}

function isValidLineName(name) {
  const s = name.toUpperCase();
  if (/^C\d+$/i.test(s)) return true;
  if (OTHER_LINES.has(s)) return true;
  return false;
}

/**
 * Parse raw table từ KPI!A3:AJ18 (hoặc A4:AJ18)
 * Cố định cột theo layout:
 *  A: line
 *  H: DM/NGÀY
 *  I: DM/H
 *  J..Q: 8 mốc lũy tiến
 *  S: HS đạt
 *  T: HS định mức
 */
function parseKpiRaw(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { lines: [], meta: {} };

  // Nếu range bắt đầu ở A3 thì row[0] là header; nếu A4 thì row[0] là data luôn.
  const firstA = normalizeLineName(raw?.[0]?.[0] ?? '');
  const hasHeader = !isValidLineName(firstA); // nếu A không phải "C1/C2..." thì coi là header

  const dataRows = hasHeader ? raw.slice(1) : raw;

  // index theo range bắt đầu từ cột A
  const IDX_LINE = 0;        // A
  const IDX_DM_DAY = 7;      // H
  const IDX_DM_HOUR = 8;     // I
  const IDX_LT_START = 9;    // J
  const IDX_LT_END = 17;     // Q (slice end)
  const IDX_HS_ACT = 18;     // S
  const IDX_HS_TARGET = 19;  // T

  const map = new Map(); // dedupe theo line (nếu có NM 2 dòng thì lấy dòng sau)

  for (const r of dataRows) {
    const line = normalizeLineName(r?.[IDX_LINE] ?? '');
    if (!line) continue;

    // bỏ các dòng tổng / tiêu đề
    if (String(line).toUpperCase().includes('TOTAL')) continue;
    if (!isValidLineName(line)) continue;

    const dmDay = toNumber(r?.[IDX_DM_DAY]);
    const dmHourRaw = toNumber(r?.[IDX_DM_HOUR]);
    const dmHour = dmHourRaw ?? (dmDay !== null ? dmDay / 8 : null);

    const lt = (r || []).slice(IDX_LT_START, IDX_LT_END).map(toNumber); // 8 mốc
    const hsAct = toPercent(r?.[IDX_HS_ACT]);
    const hsTarget = toPercent(r?.[IDX_HS_TARGET]) ?? 90; // default 90% nếu thiếu

    map.set(line, {
      line,
      dmDay: dmDay ?? 0,
      dmHour: dmHour ?? 0,
      lt,        // [m1..m8]
      hsAct,     // %
      hsTarget,  // %
    });
  }

  const lines = Array.from(map.values()).sort((a, b) => {
    // sort C1..C10 trước, rồi các nhóm khác
    const ax = a.line.toUpperCase();
    const bx = b.line.toUpperCase();
    const am = ax.match(/^C(\d+)$/);
    const bm = bx.match(/^C(\d+)$/);
    if (am && bm) return Number(am[1]) - Number(bm[1]);
    if (am) return -1;
    if (bm) return 1;
    return ax.localeCompare(bx);
  });

  return { lines, meta: { hasHeader } };
}

function statusHour(actual, target) {
  if (actual === null) return 'CHƯA CÓ';
  if (target === null) return 'N/A';
  return actual >= target ? 'ĐỦ/VƯỢT' : 'THIẾU';
}

function statusDay(hsAct, hsTarget) {
  if (hsAct === null) return 'CHƯA CÓ';
  return hsAct >= hsTarget ? 'ĐẠT' : 'KHÔNG ĐẠT';
}

export default function KpiDashboardClient() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [raw, setRaw] = useState([]);
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState('');

  // load danh sách ngày
  useEffect(() => {
    async function loadConfig() {
      try {
        setLoadingConfig(true);
        setError('');
        const res = await fetch('/api/kpi-config', { cache: 'no-store' });
        const data = await res.json();

        if (data.status !== 'success') {
          setError(data.message || 'Không đọc được CONFIG_KPI');
          return;
        }

        const ds = data.dates || [];
        setDates(ds);
        if (ds.length) setSelectedDate(ds[ds.length - 1]); // default ngày mới nhất
      } catch (e) {
        setError(e?.message || 'Lỗi load CONFIG_KPI');
      } finally {
        setLoadingConfig(false);
      }
    }

    loadConfig();
  }, []);

  async function handleLoad() {
    if (!selectedDate) return;
    try {
      setLoading(true);
      setError('');
      setRaw([]);
      setLines([]);
      setSelectedLine('');

      const params = new URLSearchParams({ date: selectedDate });
      const res = await fetch(`/api/check-kpi?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();

      if (data.status !== 'success') {
        setError(data.message || 'Không đọc được KPI');
        return;
      }

      const raw2d = data.raw || [];
      setRaw(raw2d);

      const parsed = parseKpiRaw(raw2d);
      setLines(parsed.lines);

      if (parsed.lines.length) setSelectedLine(parsed.lines[0].line);
    } catch (e) {
      setError(e?.message || 'Lỗi gọi API KPI');
    } finally {
      setLoading(false);
    }
  }

  const current = useMemo(() => {
    return lines.find((x) => x.line === selectedLine) || null;
  }, [lines, selectedLine]);

  const hourTable = useMemo(() => {
    if (!current) return [];
    const dmHour = current.dmHour || 0;

    return MILESTONES.map((m, idx) => {
      const actual = current.lt?.[idx] ?? null;
      const target = dmHour ? dmHour * m.hours : 0;
      const diff = (actual ?? 0) - target;

      return {
        m: m.label,
        actual,
        target,
        diff,
        st: dmHour ? statusHour(actual, target) : 'N/A',
      };
    });
  }, [current]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-3">KPI Dashboard</h1>

      <div className="flex items-center gap-2 mb-3">
        <label className="font-medium">Ngày</label>
        <select
          className="border px-2 py-1 rounded"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          disabled={loadingConfig || !dates.length}
        >
          {!dates.length && <option>Đang tải ngày...</option>}
          {dates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <button
          className="border px-3 py-1 rounded bg-black text-white"
          onClick={handleLoad}
          disabled={!selectedDate || loading}
        >
          Xem dữ liệu
        </button>

        {loading && <span>Đang tải...</span>}
      </div>

      {error && <p className="text-red-600 mb-3">Lỗi: {error}</p>}

      {!!lines.length && (
        <div className="mb-3 text-sm">
          <b>Đang xem:</b> {selectedDate} • <b>Tổng số chuyền:</b> {lines.length}
        </div>
      )}

      {!!lines.length && (
        <div className="grid grid-cols-12 gap-4">
          {/* LEFT: Bảng HS ngày */}
          <div className="col-span-12 lg:col-span-5 border rounded p-3 bg-white">
            <div className="font-semibold mb-2">So sánh hiệu suất ngày</div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-2 py-1 text-left">Chuyền</th>
                    <th className="border px-2 py-1 text-right">HS đạt</th>
                    <th className="border px-2 py-1 text-right">HS định mức</th>
                    <th className="border px-2 py-1 text-left">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((x) => {
                    const st = statusDay(x.hsAct, x.hsTarget);
                    return (
                      <tr key={x.line} className="hover:bg-gray-50">
                        <td className="border px-2 py-1">{x.line}</td>
                        <td className="border px-2 py-1 text-right">
                          {x.hsAct === null ? '—' : `${x.hsAct.toFixed(2)}%`}
                        </td>
                        <td className="border px-2 py-1 text-right">
                          {`${x.hsTarget.toFixed(2)}%`}
                        </td>
                        <td className="border px-2 py-1">{st}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT: chọn chuyền + bảng lũy tiến */}
          <div className="col-span-12 lg:col-span-7 border rounded p-3 bg-white">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-semibold">So sánh định mức lũy tiến theo giờ</div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm">Chuyền:</span>
                <select
                  className="border px-2 py-1 rounded"
                  value={selectedLine}
                  onChange={(e) => setSelectedLine(e.target.value)}
                >
                  {lines.map((x) => (
                    <option key={x.line} value={x.line}>{x.line}</option>
                  ))}
                </select>
              </div>
            </div>

            {!current ? (
              <p>Chưa chọn chuyền.</p>
            ) : (
              <>
                <div className="text-sm mb-2">
                  <b>DM/NGÀY:</b> {current.dmDay} • <b>DM/H:</b> {current.dmHour}
                </div>

                <div className="overflow-auto">
                  <table className="min-w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border px-2 py-1 text-left">Mốc</th>
                        <th className="border px-2 py-1 text-right">Lũy tiến</th>
                        <th className="border px-2 py-1 text-right">DM lũy tiến</th>
                        <th className="border px-2 py-1 text-right">Chênh</th>
                        <th className="border px-2 py-1 text-left">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourTable.map((r) => (
                        <tr key={r.m} className="hover:bg-gray-50">
                          <td className="border px-2 py-1">{r.m}</td>
                          <td className="border px-2 py-1 text-right">{r.actual ?? '—'}</td>
                          <td className="border px-2 py-1 text-right">{Math.round(r.target)}</td>
                          <td className="border px-2 py-1 text-right">
                            {Number.isFinite(r.diff) ? Math.round(r.diff) : '—'}
                          </td>
                          <td className="border px-2 py-1">{r.st}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* debug nhỏ nếu cần */}
      {!lines.length && raw?.length > 0 && (
        <div className="mt-3 text-sm">
          Đã đọc sheet nhưng không parse được chuyền. Kiểm tra lại RANGE (nên bao gồm cột A..T).
        </div>
      )}
    </div>
  );
}
