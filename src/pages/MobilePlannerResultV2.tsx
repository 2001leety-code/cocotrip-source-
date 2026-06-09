import {
  Sparkles, Calendar, MapPin, Wallet, Download, Share2,
  Landmark, Utensils, Camera, Mountain, Waves, ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';

/**
 * 모바일 v2 - AI 플래너 결과 화면 ("Your plan is ready").
 * MobileHomeV2 와 동일 디자인 언어: 다크 #0a0b14 + 퍼플->핑크 그라데이션 절제 +
 * 단색 라인 아이콘 + rounded-2xl 카드 + active:scale-95 프레스.
 *
 * 자급자족 미리보기: 샘플 plan 하드코딩(auth/Firestore 불필요). 라이브 무영향.
 */

type Stop = {
  time: string;
  name: string;
  icon: LucideIcon;
};

type PlanDay = {
  day: number;
  city: string;
  stops: Stop[];
};

const PLAN_DAYS: PlanDay[] = [
  {
    day: 1,
    city: 'Seoul',
    stops: [
      { time: '09:00', name: 'Gyeongbokgung Palace', icon: Landmark },
      { time: '11:30', name: 'Bukchon Hanok Village', icon: Camera },
      { time: '13:00', name: 'Tosokchon Samgyetang', icon: Utensils },
      { time: '15:30', name: 'Myeongdong Shopping', icon: ShoppingBag },
    ],
  },
  {
    day: 2,
    city: 'Seoul',
    stops: [
      { time: '10:00', name: 'N Seoul Tower', icon: Camera },
      { time: '12:30', name: 'Gwangjang Market', icon: Utensils },
      { time: '15:00', name: 'Hangang River Park', icon: Waves },
    ],
  },
  {
    day: 3,
    city: 'Busan',
    stops: [
      { time: '09:30', name: 'Haeundae Beach', icon: Waves },
      { time: '11:30', name: 'Gamcheon Culture Village', icon: Camera },
      { time: '13:30', name: 'Jagalchi Fish Market', icon: Utensils },
      { time: '16:00', name: 'Haedong Yonggungsa', icon: Mountain },
    ],
  },
];

const SUMMARY_CHIPS: { icon: LucideIcon; label: string }[] = [
  { icon: Calendar, label: '5 days' },
  { icon: MapPin, label: '2 cities' },
  { icon: Wallet, label: '~$1,240' },
];

export default function MobilePlannerResultV2() {
  usePageMeta({
    title: 'Your Korea plan is ready',
    description: 'Your personalized 5-day Korea itinerary across Seoul & Busan - CocoTrip AI planner.',
  });

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pb-8 max-w-md mx-auto">
      {/* -- 축하 헤더 (퍼플->핑크 그라데이션 영역) -- */}
      <header className="relative overflow-hidden bg-gradient-to-br from-purple-500 to-pink-500 px-6 pt-10 pb-8">
        <div className="pointer-events-none absolute -top-10 -right-10 h-44 w-44 rounded-full bg-white/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-8 h-40 w-40 rounded-full bg-purple-300/20 blur-3xl" />
        <div className="relative">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <Sparkles size={26} className="text-white" />
          </span>
          <h1 className="mt-4 text-2xl font-bold leading-tight tracking-tight">
            Your plan is ready!
          </h1>
          <p className="mt-1.5 text-sm font-medium text-white/85">
            5 Days in Seoul &amp; Busan - Jun 2026
          </p>
        </div>
      </header>

      {/* -- 요약 칩 줄 -- */}
      <section className="flex flex-wrap gap-2 px-5 pt-5">
        {SUMMARY_CHIPS.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 py-1.5 text-[13px] font-medium text-white/80"
          >
            <chip.icon size={15} className="text-purple-300" />
            {chip.label}
          </span>
        ))}
      </section>

      {/* -- 데이 타임라인 -- */}
      <section className="space-y-4 px-5 pt-5">
        {PLAN_DAYS.map((day) => (
          <div key={day.day} className="rounded-2xl bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-xs font-bold">
                {day.day}
              </span>
              <h2 className="text-base font-semibold">
                Day {day.day}
                <span className="text-white/45"> - {day.city}</span>
              </h2>
            </div>

            {/* 세로 타임라인: 왼쪽 점-선(CSS absolute 그라데이션) */}
            <ol className="relative ml-1 space-y-4 border-l border-white/10 pl-5">
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-1 bottom-1 w-px -translate-x-1/2 bg-gradient-to-b from-purple-500/70 via-pink-500/40 to-transparent"
              />
              {day.stops.map((stop, i) => (
                <li key={i} className="relative">
                  {/* 타임라인 점 */}
                  <span
                    aria-hidden
                    className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 ring-4 ring-[#0a0b14]"
                  />
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 w-11 shrink-0 text-[13px] font-semibold tabular-nums text-purple-300">
                      {stop.time}
                    </span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07]">
                      <stop.icon size={16} className="text-pink-300" />
                    </span>
                    <span className="mt-1 text-sm font-medium leading-snug text-white/90">
                      {stop.name}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      {/* -- 하단 액션 -- */}
      <section className="px-5 pt-6">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-3.5 text-sm font-semibold shadow-lg shadow-purple-500/30 active:scale-95 transition-transform"
        >
          <Download size={18} /> Download PDF
        </button>
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-sm font-medium text-white/60 active:opacity-70"
        >
          <Share2 size={16} /> Share
        </button>
      </section>
    </div>
  );
}
