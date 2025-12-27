'use client';

import { useMemo, useState, useEffect } from 'react';

const MILESTONES = [
  { label: '->9h', hours: 1 },
  { label: '->10h', hours: 2 },
  { label: '->11h', hours: 3 },
  { label: '->12h30', hours: 4 },
  { label: '->13h30', hours: 5 },
  { label: '->14h30', hours: 6 },
  { label: '->15h30', hours: 7 },
  { label: '->16h30', hours: 8 },
];

const OTHER_LINES = new Set(['CẮT', 'CAT', 'KCS', 'HOÀN TẤT', 'HOAN TAT', 'NM']);

function cleanNumString(s) {
  // bỏ mọi ký tự lạ, giữ số, dấu . , -
  // rồi xử lý dấu phẩy ngăn cách nghìn
  let t = String(s ?? '').trim();

  // đổi NBSP về space thường
  t = t.replace(/\u00A0/g, ' ');

  // nếu có %, bỏ %
  t = t.replace('%', '');

  // bỏ dấu phẩy ngăn cách nghìn: 2,755 -> 2755
  // (nếu bạn dùng dấu phẩy làm thập phân thì báo mình để chỉnh)
  t = t.replace(/,/g, '');

  // cuối cùng bỏ ký tự không liên quan
  t = t.replace(/[^\d.\-]/g, '');

  return t;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  const s = cleanNumString(v);
  if (!s) return null;

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toPercent(v) {
  const n = toNumber(v);
  if (n === null) return null;

  // nếu dạng 0.9587 -> 95.87
  if (n <= 1.5) return n * 100;
  return n;
}

function isValidLineName(name) {
  const s = String(name || '').trim().toUpperCase();
  if (/^C\d+$/.test(s)) return true;
  if (OTHER_LINES.has(s)) return true;
  return false;
}

function findHeaderRowIndex(raw) {
  for (let i = 0; i < Math.min(raw.length, 6); i++) {
    const row = raw[i] || [];
    if (row.some((c) => String(c || '').includes('->9h'))) return i;
    if (row.some((c) => String(c || '').includes('9h'))) return i;
  }
  return 0;
}

function findLtStartIndex(row) {
  let idx = row.findIndex((c) => String(c || '').includes('->9h'));
  if (idx >= 0) return idx;
  idx = row.findIndex((c) => String(c || '').includes('9h'));
  return idx >= 0 ? idx : 9;
}

// QUAN TRỌNG: quét ngược gần ->9h để bắt DM/H và DM/NGÀY
function pickNearestNumber(row, startIdx, maxBack = 6) {
  for (let k = 0; k <= maxBack; k++) {
    const idx = startIdx - k;
    if (idx < 0) break;
    const n = toNumber(row?.[idx]);
    if (n !== null) return { n, idx };
  }
  return { n: null, idx: -1 };
}

function parseKpiRaw(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { lines: [], meta: null };

  const headerRowIdx = findHeaderRowIndex(raw);
  const header = raw[headerRowIdx] || [];
  const ltStart = findLtStartIndex(header);

  const dataRows = raw.slice(headerRowIdx + 1);

  const map = new Map();

  for (const r of dataRows) {
    const line = String(r?.[0] ?? '').trim();
    if (!line) continue;
    if (String(line).toUpperCase().includes('TOTAL')) continue;
    if (!isValidLineName(line)) continue;

    // lũy tiến 8 mốc
    const lt = (r || []).slice(ltStart, ltStart + 8).map(toNumber);

    // DM/H: thường nằm ngay trước ->9h (ltStart-1) nhưng có thể lệch => quét ngược
    const dmHourPick = pickNearestNumber(r, ltStart - 1, 6);
    const dmHour = dmHourPick.n;

    // DM/NGÀY: thường trước DM/H 1 cột => ưu tiên ltStart-2, nếu null thì quét tiếp
    const dmDayPick = pickNearestNumber(r, ltStart - 2, 8);
    const dmDay = dmDayPick.n;

    const dmHourFinal = dmHour ?? (dmDay !== null ? dmDay / 8 : null);

    // HS nằm sau 8 mốc: TG SX, HS đạt, HS định mức (thường)
    const hsAct = toPercent(r?.[ltStart + 9]);      // cột sau TG SX
    const hsTarget = toPercent(r?.[ltStart + 10]) ?? 90;

    map.set(line, {
      line,
      ltStart,
      dmDay: dmDayFinal(dmDay),
      dmHour: dmHourFinalFinal(dmHourFinal),
      lt,
      hsAct,
      hsTarget,
      _dbg: {
        dmHourIdx: dmHourPick.idx,
        dmDayIdx: dmDayPick.idx,
        dmHourCell: r?.[dmHourPick.idx],
        dmDayCell: r?.[dmDayPick.idx],
      }
    });
  }

  function dmDayFinal(x){ return x ?? 0; }
  function dmHourFinalFinal(x){ return x ?? 0; }

  const lines = Array.from(map.values()).sort((a, b) => {
    const ax = a.line.toUpperCase();
    const bx = b.line.toUpperCase();
    const am = ax.match(/^C(\d+)$/);
    const bm = bx.match(/^C(\d+)$/);
    if (am && bm) return Number(am[1]) - Number(bm[1]);
    if (am) return -1;
    if (bm) return 1;
    return ax.localeCompare(bx);
  });

  return {
    lines,
    meta: { headerRowIdx, ltStart, headerSample: header },
  };
}

function statusHour(actual, target) {
  if (actual === null) return 'CHƯA CÓ';
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
        if (ds.length) setSelectedDate(ds[ds.length - 1]);
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

      // Nếu bạn vẫn bị DM=0, mở console để xem _dbg.dmHourCell / dmDayCell
      // console.log(parsed.meta, parsed.lines?.[0]?._dbg);

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
    <div className="p-3">
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
          {/* LEFT: HS ngày */}
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
                  {lines.map((x) => (
                    <tr key={x.line} className="hover:bg-gray-50">
                      <td className="border px-2 py-1">{x.line}</td>
                      <td className="border px-2 py-1 text-right">
                        {x.hsAct === null ? '—' : `${x.hsAct.toFixed(2)}%`}
                      </td>
                      <td className="border px-2 py-1 text-right">
                        {`${x.hsTarget.toFixed(2)}%`}
                      </td>
                      <td className="border px-2 py-1">{statusDay(x.hsAct, x.hsTarget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT: Lũy tiến vs DM */}
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

      {!lines.length && raw?.length > 0 && (
        <div className="mt-3 text-sm text-red-600">
          Đã đọc sheet nhưng không parse được. Hãy đảm bảo RANGE có chứa dòng tiêu đề có “->9h”.
        </div>
      )}
    </div>
  );
}
