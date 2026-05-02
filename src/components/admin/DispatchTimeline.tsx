import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Clock, User, Loader2 } from 'lucide-react';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface DispatchEntry {
  id: string;
  driver: string;
  vehicle: string;
  bookingId: string;
  tourName: string;
  startTime: number;
  endTime: number;
  status: 'driving' | 'standby' | 'break' | 'off';
  customer: string;
  pax: number;
}

interface DriverDoc {
  chatId: string;
  name: string;
  vehicle: string;
  active?: boolean;
}

interface BookingDoc {
  productType?: string;
  payerName?: string;
  paxCount?: number;
  tourDate?: string;
  driver?: string;
  vehicleType?: string;
  status?: string;
  adminStatus?: string;
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00 ~ 22:00

const STATUS_STYLE: Record<string, { bg: string; label: string }> = {
  driving: { bg: 'bg-emerald-500', label: '운행 중' },
  standby: { bg: 'bg-yellow-500', label: '대기' },
  break: { bg: 'bg-gray-500', label: '휴식' },
  off: { bg: 'bg-red-500/40', label: '휴무' },
};

// productType으로 운행 시간대 추정 (예약 schema에 startHour 없는 경우)
function inferTimeRange(productType: string): { start: number; end: number } {
  if (!productType) return { start: 9, end: 18 };
  if (productType.startsWith('airport')) return { start: 9, end: 11 };
  if (productType.startsWith('kpop')) return { start: 18, end: 22 };
  if (productType.startsWith('ai_planner')) return { start: 9, end: 21 };
  if (productType === 'charter_ski') return { start: 7, end: 19 };
  if (productType.startsWith('charter')) return { start: 9, end: 18 };
  if (productType.startsWith('combo')) return { start: 8, end: 18 };
  return { start: 9, end: 18 };
}

function detectConflicts(entries: DispatchEntry[]) {
  const conflicts: Set<string> = new Set();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.vehicle === b.vehicle && a.vehicle !== '-' && a.startTime < b.endTime && b.startTime < a.endTime) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  }
  return conflicts;
}

function isCancelled(b: BookingDoc): boolean {
  const s = (b.adminStatus || b.status || '').toLowerCase();
  return s === 'canceled' || s === 'cancelled';
}

export default function DispatchTimeline() {
  const [dateOffset, setDateOffset] = useState(0);
  const [drivers, setDrivers] = useState<DriverDoc[]>([]);
  const [bookings, setBookings] = useState<Array<BookingDoc & { id: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  today.setDate(today.getDate() + dateOffset);
  const dateStr = today.toISOString().split('T')[0];

  // 기사 목록은 거의 안 바뀌므로 1회 fetch
  useEffect(() => {
    getDocs(collection(db, 'drivers'))
      .then((snap) => {
        const list: DriverDoc[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<DriverDoc, 'chatId'>;
          list.push({ chatId: d.id, ...data });
        });
        setDrivers(list.filter((d) => d.active !== false));
      })
      .catch((err) => {
        console.error('[DispatchTimeline] drivers load error:', err);
        setError(err.message);
      });
  }, []);

  // 선택 날짜의 예약 실시간 구독
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'bookings'), where('tourDate', '==', dateStr));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Array<BookingDoc & { id: string }> = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as BookingDoc) }));
        setBookings(list.filter((b) => !isCancelled(b)));
        setLoading(false);
      },
      (err) => {
        console.error('[DispatchTimeline] bookings listen error:', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [dateStr]);

  const grouped = useMemo(() => {
    return drivers.map((d) => {
      const driverBookings = bookings.filter((b) => b.driver === d.name);
      const entries: DispatchEntry[] = driverBookings.map((b) => {
        const range = inferTimeRange(b.productType || '');
        return {
          id: b.id,
          driver: d.name,
          vehicle: b.vehicleType || d.vehicle || '-',
          bookingId: b.id,
          tourName: b.productType || '예약',
          startTime: range.start,
          endTime: range.end,
          status: 'driving',
          customer: b.payerName || '-',
          pax: b.paxCount || 0,
        };
      });
      // 배정된 예약이 없으면 standby 행 1개 표시
      if (entries.length === 0) {
        entries.push({
          id: `${d.chatId}-empty`,
          driver: d.name,
          vehicle: d.vehicle || '-',
          bookingId: '-',
          tourName: '대기',
          startTime: 6,
          endTime: 22,
          status: 'standby',
          customer: '-',
          pax: 0,
        });
      }
      return { driver: d.name, vehicle: d.vehicle, entries };
    });
  }, [drivers, bookings]);

  const allEntries = useMemo(
    () => grouped.flatMap((g) => g.entries.filter((e) => e.bookingId !== '-')),
    [grouped],
  );
  const conflicts = useMemo(() => detectConflicts(allEntries), [allEntries]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 bg-[#12131C] border border-gray-800 rounded-xl p-2">
          <button onClick={() => setDateOffset((d) => d - 1)} className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold min-w-[100px] text-center flex items-center gap-1.5 justify-center">
            {dateStr}
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
          </span>
          <button onClick={() => setDateOffset((d) => d + 1)} className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
        {conflicts.size > 0 && (
          <div className="flex items-center gap-2 text-red-400 text-sm font-medium bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg">
            <AlertTriangle className="w-4 h-4" /> 차량 충돌 {conflicts.size / 2}건 감지
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2 rounded-lg">
          ⚠ {error}
        </div>
      )}

      {drivers.length === 0 && !loading && (
        <div className="bg-[#12131C] border border-gray-800 rounded-xl p-8 text-center text-gray-400 text-sm">
          등록된 기사가 없습니다.<br />
          텔레그램 관리자봇에서 <code className="bg-gray-800 px-1.5 py-0.5 rounded">/drivers</code> 입력해 등록 가이드를 확인하세요.
        </div>
      )}

      <div className="flex gap-4 text-xs text-gray-400">
        {Object.entries(STATUS_STYLE).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${v.bg}`} /> {v.label}
          </div>
        ))}
      </div>

      <div className="bg-[#12131C] border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="flex border-b border-gray-800">
          <div className="w-[140px] shrink-0 p-3 bg-[#1a1b26] text-xs text-gray-400 font-medium border-r border-gray-800">기사 / 차량</div>
          <div className="flex-1 flex">
            {HOURS.map((h) => (
              <div key={h} className="flex-1 text-center text-[10px] text-gray-500 py-2 border-r border-gray-800/50 bg-[#1a1b26]">
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {grouped.map(({ driver, vehicle, entries }) => (
          <div key={driver} className="flex border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
            <div className="w-[140px] shrink-0 p-3 border-r border-gray-800 flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-sm font-medium text-gray-200">{driver}</span>
              </div>
              {vehicle && vehicle !== '-' && (
                <span className="text-[10px] text-gray-500 mt-0.5 ml-5">{vehicle}</span>
              )}
            </div>
            <div className="flex-1 relative h-[52px]">
              <div className="absolute inset-0 flex">
                {HOURS.map((h) => (
                  <div key={h} className="flex-1 border-r border-gray-800/30" />
                ))}
              </div>
              {entries.map((entry) => {
                const left = ((entry.startTime - 6) / 17) * 100;
                const width = ((entry.endTime - entry.startTime) / 17) * 100;
                const hasConflict = conflicts.has(entry.id);
                return (
                  <div
                    key={entry.id}
                    className={`absolute top-2 h-8 rounded-md flex items-center px-2 text-[10px] font-medium text-white overflow-hidden cursor-default group ${STATUS_STYLE[entry.status].bg} ${hasConflict ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-[#12131C]' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%`, minWidth: '40px' }}
                    title={`${entry.tourName} (${entry.customer}, ${entry.pax}명)`}
                  >
                    <span className="truncate">{entry.tourName}</span>
                    {hasConflict && <AlertTriangle className="w-3 h-3 ml-1 shrink-0 text-red-200" />}
                    <div className="absolute bottom-full left-0 mb-1 bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-30 shadow-xl">
                      <div className="font-bold text-white mb-1">{entry.tourName}</div>
                      <div>{entry.customer} ({entry.pax}명)</div>
                      <div className="flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" />{entry.startTime}:00 ~ {entry.endTime}:00</div>
                      <div className="text-gray-400">{entry.vehicle} | {entry.bookingId}</div>
                      {hasConflict && <div className="text-red-400 mt-1 font-bold">차량 충돌 발생</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
