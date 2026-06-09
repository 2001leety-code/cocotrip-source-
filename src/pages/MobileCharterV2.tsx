import { useState } from 'react';
import {
  CarFront, Bus, Crown, Users, Check, ChevronRight,
  PlaneLanding, MapPin, Calendar,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';

/**
 * 모바일 v2 프라이빗 차터 - 차량 선택 + 견적 화면.
 * (MobileHomeV2 패턴 계승: 다크 #0a0b14 + 퍼플->핑크 그라데이션 + 단색 라인 아이콘 +
 *  rounded-2xl 카드 + active:scale 프레스.)
 *
 * 안전: 인터랙티브 프리뷰(차량 선택 토글만 동작). 트립 요약/Get Quote는 표시용 = 실제
 * 결제-라우팅 미연결. 라이브 차터 흐름 무영향. 별도 프리뷰 라우트에서만 렌더 가정.
 */

interface Vehicle {
  id: string;
  name: string;
  capacity: string;
  icon: LucideIcon;
  price: string;
}

const VEHICLES: Vehicle[] = [
  { id: 'staria', name: 'Hyundai Staria', capacity: 'Up to 7', icon: CarFront, price: '$138' },
  { id: 'sprinter', name: 'Mercedes Sprinter', capacity: 'Up to 11', icon: Bus, price: '$198' },
  { id: 'premium', name: 'Premium Sprinter', capacity: 'Up to 7 - luxury', icon: Crown, price: '$268' },
];

interface TripRow {
  icon: LucideIcon;
  label: string;
  value: string;
}

const TRIP_ROWS: TripRow[] = [
  { icon: PlaneLanding, label: 'From', value: 'Incheon Airport (ICN)' },
  { icon: MapPin, label: 'To', value: 'Seoul' },
  { icon: Calendar, label: 'Date', value: 'Jun 12' },
  { icon: Users, label: 'Passengers', value: '4' },
];

const INCLUDED = ['English driver', 'Fuel & tolls', 'Free cancellation'];

export default function MobileCharterV2() {
  usePageMeta({
    title: 'Private Charter - your own vehicle & driver',
    description: 'Book a private vehicle with an English-speaking driver across Korea - CocoTrip charter.',
  });

  // 기본 선택 = Mercedes Sprinter (사양서: 선택됨 상태로 표시)
  const [selectedId, setSelectedId] = useState<string>('sprinter');
  const selected = VEHICLES.find((v) => v.id === selectedId) || VEHICLES[0];

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pt-[max(env(safe-area-inset-top),0.75rem)] pb-24 max-w-md mx-auto">
      {/* -- Header (퍼플 글로우 blob + 타이틀) -- */}
      <header className="relative overflow-hidden px-5 pt-4 pb-3">
        <div className="pointer-events-none absolute -top-14 -right-12 h-56 w-56 rounded-full bg-purple-600/25 blur-3xl" />
        <div className="pointer-events-none absolute top-10 -left-12 h-44 w-44 rounded-full bg-pink-500/20 blur-3xl" />
        <div className="relative">
          <h1 className="text-xl font-bold leading-tight tracking-tight">Private Charter</h1>
          <p className="mt-1 text-sm text-white/60">Your own vehicle + driver, all day</p>
        </div>
      </header>

      {/* -- Trip summary (표시용 입력 카드) -- */}
      <section className="px-5">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-2">
          {TRIP_ROWS.map((row, i) => (
            <button
              key={row.label}
              type="button"
              className={`flex w-full items-center gap-3 px-3 py-2 text-left active:opacity-70 ${
                i < TRIP_ROWS.length - 1 ? 'border-b border-white/[0.06]' : ''
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
                <row.icon size={15} className="text-purple-300" />
              </span>
              <span className="flex-1 text-xs text-white/50">{row.label}</span>
              <span className="text-sm font-medium text-white">{row.value}</span>
              <ChevronRight size={16} className="text-white/30" />
            </button>
          ))}
        </div>
      </section>

      {/* -- Vehicle selection -- */}
      <section className="px-5 pt-4">
        <h2 className="mb-2 text-base font-bold">Choose your vehicle</h2>
        <div className="flex flex-col gap-2">
          {VEHICLES.map((v) => {
            const isSelected = v.id === selectedId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                aria-pressed={isSelected}
                className={`flex items-center gap-3 rounded-2xl p-3 text-left transition-all active:scale-[0.98] ${
                  isSelected
                    ? 'bg-gradient-to-r from-purple-500/15 to-pink-500/15 ring-2 ring-purple-500'
                    : 'border border-white/[0.07] bg-white/[0.03] ring-2 ring-transparent'
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    isSelected
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shadow-purple-500/30'
                      : 'bg-white/[0.07]'
                  }`}
                >
                  <v.icon size={19} className={isSelected ? 'text-white' : 'text-purple-300'} />
                </span>

                <div className="flex-1">
                  <p className="text-sm font-semibold leading-tight">{v.name}</p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-white/70">
                    <Users size={12} className="text-purple-300" />
                    {v.capacity}
                  </span>
                </div>

                <span className="text-base font-bold">{v.price}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* -- Included (미니 줄) -- */}
      <section className="px-5 pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {INCLUDED.map((item) => (
            <span key={item} className="inline-flex items-center gap-1.5 text-xs text-white/60">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-500/20">
                <Check size={11} className="text-purple-300" />
              </span>
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* -- Sticky bottom bar (선택 차량 가격 + Get Quote) -- */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-white/[0.08] bg-[#0a0b14]/95 px-5 py-3.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[11px] text-white/50">{selected.name}</p>
            <p className="text-lg font-bold leading-tight">{selected.price}</p>
          </div>
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-7 py-3 text-sm font-semibold shadow-lg shadow-purple-500/30 active:scale-95 transition-transform"
          >
            Get Quote
          </button>
        </div>
      </div>
    </div>
  );
}
