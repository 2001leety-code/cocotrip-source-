// /admin/availability — 운영자가 투어별 가용성을 일자 단위로 관리.
// 토글 흐름: available (default, 빈 셀) → fully_booked → blackout → available
import { useEffect, useMemo, useState } from 'react';
import { TOURS } from '@/data/tours';
import {
  fetchMonthAvailability,
  setAvailability,
  type AvailabilityEntry,
  type AvailabilityStatus,
} from '@/lib/tour-availability-store';
import { Header } from '@/sections/Header';
import { useLanguage } from '@/hooks/useLanguage';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

const STATUS_CYCLE: AvailabilityStatus[] = ['available', 'fully_booked', 'blackout'];
const STATUS_COLOR: Record<AvailabilityStatus, { bg: string; color: string; border: string }> = {
  available:    { bg: 'rgba(16,185,129,0.10)',  color: '#6EE7B7',  border: 'rgba(16,185,129,0.30)' },
  fully_booked: { bg: 'rgba(248,113,113,0.10)', color: '#FCA5A5',  border: 'rgba(248,113,113,0.35)' },
  blackout:     { bg: 'rgba(255,200,80,0.10)',  color: '#FFD250',  border: 'rgba(255,200,80,0.30)' },
};

const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  available: '가능',
  fully_booked: '만석',
  blackout: '휴업',
};

function pad(n: number) { return String(n).padStart(2, '0'); }
function isoDay(year: number, month: number, day: number) { return `${year}-${pad(month + 1)}-${pad(day)}`; }
function daysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate(); }

export default function AdminTourAvailability() {
  const { language, t, changeLanguage } = useLanguage();
  const today = new Date();
  const [tourId, setTourId] = useState<string>(TOURS[0]?.id || '');
  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<number>(today.getMonth());
  const [data, setData] = useState<Map<string, AvailabilityEntry>>(new Map());
  const [busy, setBusy] = useState<string>('');

  const yearMonth = `${year}-${pad(month + 1)}`;
  const total = daysInMonth(year, month);

  const reload = useMemo(() => async () => {
    if (!tourId) return;
    const map = await fetchMonthAvailability(tourId, yearMonth);
    setData(map);
  }, [tourId, yearMonth]);

  useEffect(() => { reload(); }, [reload]);

  async function cycleStatus(date: string) {
    const current = data.get(date)?.status || 'available';
    const idx = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setBusy(date);
    try {
      await setAvailability(tourId, date, next);
      await reload();
    } finally {
      setBusy('');
    }
  }

  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}
    >
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-24">
        <h1 className="text-[22px] font-black text-white mb-1">투어 가용성 관리</h1>
        <p className="text-[12px] text-white/40 mb-5">
          운영자 전용 — 일자 클릭으로 가능/만석/휴업 순환. 빈 셀 = 가능 (default).
        </p>

        {/* 컨트롤 */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <select
            value={tourId}
            onChange={(e) => setTourId(e.target.value)}
            className="text-[12px] font-semibold px-3 py-2 rounded-xl focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}
          >
            {TOURS.map(t => (
              <option key={t.id} value={t.id}>
                {t.title.ko} ({t.id})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              const m = month - 1;
              if (m < 0) { setMonth(11); setYear(year - 1); } else { setMonth(m); }
            }}
            className="px-3 py-2 rounded-xl text-[12px]"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}
          >
            ←
          </button>
          <span className="text-[14px] font-bold text-white tabular-nums">
            {year}년 {month + 1}월
          </span>
          <button
            type="button"
            onClick={() => {
              const m = month + 1;
              if (m > 11) { setMonth(0); setYear(year + 1); } else { setMonth(m); }
            }}
            className="px-3 py-2 rounded-xl text-[12px]"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}
          >
            →
          </button>

          {/* 범례 */}
          <div className="ml-auto flex gap-2 text-[10px]">
            {STATUS_CYCLE.map(s => {
              const c = STATUS_COLOR[s];
              return (
                <span key={s} className="px-2 py-1 rounded-full font-semibold" style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                  {STATUS_LABEL[s]}
                </span>
              );
            })}
          </div>
        </div>

        {/* 캘린더 그리드 7열 */}
        <div className="grid grid-cols-7 gap-1.5">
          {['일', '월', '화', '수', '목', '금', '토'].map(d => (
            <div key={d} className="text-[10px] font-bold text-white/30 text-center py-1">{d}</div>
          ))}
          {/* 첫째 날의 요일만큼 빈 셀 */}
          {Array.from({ length: new Date(year, month, 1).getDay() }, (_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: total }, (_, i) => {
            const day = i + 1;
            const date = isoDay(year, month, day);
            const entry = data.get(date);
            const status = entry?.status || 'available';
            const c = STATUS_COLOR[status];
            const isBusy = busy === date;
            return (
              <button
                key={date}
                type="button"
                onClick={() => cycleStatus(date)}
                disabled={isBusy}
                className="rounded-lg p-2 text-left transition-opacity"
                style={{
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                  opacity: isBusy ? 0.4 : 1,
                  minHeight: 60,
                }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-black text-white">{day}</span>
                  {status === 'available' && <CheckCircle className="w-3 h-3" style={{ color: c.color }} />}
                  {status === 'fully_booked' && <XCircle className="w-3 h-3" style={{ color: c.color }} />}
                  {status === 'blackout' && <AlertTriangle className="w-3 h-3" style={{ color: c.color }} />}
                </div>
                <div className="text-[9px] mt-1 truncate" style={{ color: c.color }}>
                  {STATUS_LABEL[status]}
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-[10px] text-white/25 mt-4">
          저장 위치: Firestore <code>tour_availability/&lt;tourId&gt;/dates/&lt;YYYY-MM-DD&gt;</code>.
          빈 셀(default available)은 doc 미생성으로 표현.
        </p>
      </div>
    </div>
  );
}
