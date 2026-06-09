import { Link } from 'react-router-dom';
import {
  Sparkles, Bus, CarFront, PlaneLanding, Ticket,
  MapPin, ChevronRight, Globe,
} from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';

/**
 * 모바일 v2 홈 — talabat 스타일(깔끔 카드) + 한국적 아기자기(포메 마스코트) 방향.
 * (project_cocotrip_mobile_redesign 메모리: 다크 #0a0b14 + 퍼플 절제 + 단색 라인 아이콘 +
 *  마스코트 = 설렘 주역. "AI 티 안 나게".)
 *
 * 🔒 안전: 라이브 모바일 홈(src/sections/MobileHome.tsx)은 그대로. 본 화면은 별도 라우트
 * `/preview/mobile-home` 에서만 렌더 = 증분1 미리보기(운영자 검토용). 라이브 무영향.
 */

const CATEGORIES = [
  { icon: Sparkles, label: 'AI Planner', to: '/planner', accent: true },
  { icon: Bus, label: 'Tours', to: '/tours' },
  { icon: CarFront, label: 'Charter', to: '/charter' },
  { icon: PlaneLanding, label: 'Airport', to: '/charter' },
  { icon: Ticket, label: 'K-pop', to: '/tours' },
];

const REGIONS = [
  { id: 'seoul', name: 'Seoul', image: '/region-seoul.jpg' },
  { id: 'busan', name: 'Busan', image: '/region-busan.webp' },
  { id: 'gyeongju', name: 'Gyeongju', image: '/region-gyeongju.jpg' },
  { id: 'jeonju', name: 'Jeonju', image: '/region-jeonju.jpg' },
  { id: 'danyang', name: 'Danyang', image: '/region-danyang.webp' },
  { id: 'incheon', name: 'Incheon', image: '/region-incheon.jpg' },
];

export default function MobileHomeV2() {
  usePageMeta({
    title: 'Plan your perfect Korea trip',
    description: 'AI travel planner, private tours & charter across Korea — CocoTrip mobile.',
  });

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white pt-[max(env(safe-area-inset-top),0.75rem)] pb-24 max-w-md mx-auto">
      {/* ── Header (C+비행기 로고 lockup) ── */}
      <header className="flex items-center justify-between px-5 pt-4 pb-1">
        <img src="/images/logo-cocotrip.png" alt="CocoTrip" className="h-6 w-auto" />
        <button aria-label="Language" className="rounded-full bg-white/[0.07] p-2 active:opacity-70">
          <Globe size={20} className="text-white/70" />
        </button>
      </header>

      {/* ── Hero (텍스트 + CTA, 깔끔) ── */}
      <section className="relative overflow-hidden px-5 pt-3 pb-4">
        <div className="pointer-events-none absolute -top-12 -right-14 h-60 w-60 rounded-full bg-purple-600/25 blur-3xl" />
        <div className="pointer-events-none absolute top-16 -left-12 h-48 w-48 rounded-full bg-pink-500/20 blur-3xl" />
        <div className="relative">
          <p className="mb-1.5 text-sm font-medium text-purple-300">Where to in Korea?</p>
          <h1 className="text-[22px] font-bold leading-[1.15] tracking-tight">
            Let me plan your<br />perfect Korea trip
          </h1>
          <Link
            to="/planner"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-3 text-sm font-semibold shadow-lg shadow-purple-500/30 active:scale-95 transition-transform"
          >
            <Sparkles size={16} /> Start planning
          </Link>
        </div>
      </section>

      {/* ── Categories ── */}
      <section className="px-4 py-1">
        <div className="grid grid-cols-5 gap-1">
          {CATEGORIES.map((c) => (
            <Link key={c.label} to={c.to} className="flex flex-col items-center gap-1.5 py-2 active:opacity-70">
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                  c.accent ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shadow-purple-500/30' : 'bg-white/[0.07]'
                }`}
              >
                <c.icon size={18} className={c.accent ? 'text-white' : 'text-purple-300'} />
              </span>
              <span className="text-center text-[10px] leading-tight text-white/70">{c.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Regions ── */}
      <section className="px-5 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">Explore Korea</h2>
          <Link to="/tours" className="flex items-center text-sm text-purple-300">
            See all <ChevronRight size={16} />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {REGIONS.map((r) => (
            <Link
              key={r.id}
              to={`/region/${r.id}`}
              className="relative h-24 overflow-hidden rounded-2xl active:scale-[0.98] transition-transform"
            >
              <img src={r.image} alt={r.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
              <div className="absolute bottom-2.5 left-3 flex items-center gap-1">
                <MapPin size={14} className="text-pink-400" />
                <span className="text-sm font-semibold drop-shadow">{r.name}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 하단 네비 = 앱 전역 mobile-bottom-nav 사용 (중복 방지). v2 탭 재설계는 별도 작업. */}
    </div>
  );
}
