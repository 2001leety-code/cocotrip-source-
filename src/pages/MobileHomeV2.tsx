import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, MapPin, ChevronRight, BookOpen } from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useLanguage } from '@/hooks/useLanguage';
import { signalAppReady } from '@/lib/appReady';
import { TOURS, getTourPriceKRW } from '@/data/tours';
import { formatPrice } from '@/lib/exchange-rate';
import type { Language } from '@/i18n';

/**
 * 모바일 v2 홈 - talabat 스타일(깔끔 카드) + 커스텀 보라 3D 아이콘.
 * 라이브 전환: App.tsx HomePage 가 VITE_FEATURE_MOBILE_V2(또는 ?v2)일 때 본 컴포넌트 렌더.
 * OFF 기본 = 기존 MobileHome 그대로. /preview/mobile-home 프리뷰 라우트는 항상 본 컴포넌트.
 *
 * 실데이터: TOURS(가격 SSOT getTourPriceKRW) + t.regions(기존 번역 재사용) + mobileHomeV2 i18n 4-lang.
 * 카테고리 아이콘: public/images/icons/sm/ (128px 경량판).
 */

type CategoryKey = 'catPlanner' | 'catTours' | 'catCharter' | 'catAirport' | 'catKpop';
const CATEGORIES: { icon: string; key: CategoryKey; to: string; accent?: boolean }[] = [
  { icon: '/images/icons/sm/ai-planner.png', key: 'catPlanner', to: '/planner', accent: true },
  { icon: '/images/icons/sm/tours.png', key: 'catTours', to: '/tours' },
  { icon: '/images/icons/sm/charter.png', key: 'catCharter', to: '/charter' },
  { icon: '/images/icons/sm/airport.png', key: 'catAirport', to: '/charter' },
  { icon: '/images/icons/sm/kpop.png', key: 'catKpop', to: '/tours' },
];

const REGIONS = [
  { id: 'seoul', image: '/region-seoul.jpg' },
  { id: 'busan', image: '/region-busan.webp' },
  { id: 'gyeongju', image: '/region-gyeongju.jpg' },
  { id: 'jeonju', image: '/region-jeonju.jpg' },
  { id: 'danyang', image: '/region-danyang.webp' },
  { id: 'incheon', image: '/region-incheon.jpg' },
] as const;

// 언어 전환 사이클 (전역 Header 없이 렌더되므로 v2 자체에서 언어 전환 제공)
const LANG_CYCLE: Language[] = ['en', 'ko', 'ja', 'zh'];
const LANG_LABEL: Record<Language, string> = { en: 'EN', ko: '한', ja: '日', zh: '中' };

export default function MobileHomeV2() {
  const { language, t, changeLanguage } = useLanguage();
  const m = t.mobileHomeV2;
  const regionNames = t.regions as unknown as Record<string, string>;

  usePageMeta({
    title: `${m.headline1} ${m.headline2}`,
    description: 'AI travel planner, private tours & charter across Korea - CocoTrip.',
  });

  // PWA 실행 스플래시 페이드아웃 — 홈 첫 화면 준비됨 신호 (코코트립 standalone 진입점).
  useEffect(() => { signalAppReady(); }, []);

  const featuredTours = TOURS.slice(0, 6);
  const priceLabel = (tourId: string, priceFrom: number, unit: 'group' | 'per_person') => {
    const krw = getTourPriceKRW(tourId, priceFrom, unit);
    if (language === 'ko') {
      return krw >= 10000 ? `${Math.round(krw / 10000)}만원~` : `${krw.toLocaleString()}원~`;
    }
    return formatPrice(krw, language, { approximate: true });
  };

  const cycleLanguage = () => {
    const next = LANG_CYCLE[(LANG_CYCLE.indexOf(language) + 1) % LANG_CYCLE.length];
    changeLanguage(next);
  };

  return (
    // cocotrip-mobile-home-surface = 기존 모바일 라이트 앱 셸(index.css)이 다크 클래스
    // (text-white·bg-white/[..]·다크 inline bg)를 흰색·소프트 라벤더 라이트로 변환.
    // bg-[#0a0b14]는 라이트 CSS 미적용 폭(>768px 데스크톱 프리뷰) 폴백.
    <div className="cocotrip-mobile-home-surface min-h-screen bg-[#0a0b14] text-white pb-24 max-w-md mx-auto">
      {/* Header: C+비행기 로고 lockup + 언어 전환.
          로고 주변 여백을 사방 균일하게(운영자: 위=아래=왼쪽 여백 동일). 로고·EN 둘 다 h-9(36px),
          헤더 패딩 = 위·아래·좌·우 모두 12px(px-3 pb-3) → items-center 라 로고 위/아래 여백 12px 동일,
          왼쪽 여백 12px 동일. 상단 노치 안전영역은 헤더 pt 에 흡수(max(safe-area,0.75rem)) — 일반
          화면(노치 없음/브라우저)에선 12px 균일, 노치 폰에선 상태바만큼만 위가 늘어남(시스템 강제, 불가피).
          (로고 PNG 내부 투명여백 상하 2.8/좌 2.4px 이라 보이는 여백도 0.4px 내 균일.) */}
      <header className="flex items-center justify-between px-3 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        {/* 라이트 배경에서 기존 logo-cocotrip.png 의 흰색 "trip" 글자가 안 보임 →
            전역 Header 라이트 모드와 동일한 아이콘+그라데이션 텍스트 lockup 재사용. */}
        <span className="flex h-9 items-center gap-2">
          <img src="/icons/icon-192.png" alt="CocoTrip" className="h-8 w-8 rounded-xl shadow-[0_8px_18px_rgba(124,92,255,0.22)]" />
          <span className="bg-gradient-to-r from-[#6F4DF5] to-[#F052B5] bg-clip-text text-[21px] font-black tracking-[-0.02em] text-transparent">
            CocoTrip
          </span>
        </span>
        <button
          onClick={cycleLanguage}
          aria-label="Language"
          className="flex h-9 min-w-9 items-center justify-center rounded-full bg-white/[0.07] px-2.5 text-xs font-bold text-white/80 active:opacity-70"
        >
          {LANG_LABEL[language]}
        </button>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-5 pt-3 pb-4">
        <div className="pointer-events-none absolute -top-12 -right-14 h-60 w-60 rounded-full bg-purple-600/25 blur-3xl" />
        <div className="pointer-events-none absolute top-16 -left-12 h-48 w-48 rounded-full bg-pink-500/20 blur-3xl" />
        <div className="relative">
          <p className="mb-1.5 text-sm font-medium text-purple-300">{m.tagline}</p>
          <h1 className="text-[22px] font-bold leading-[1.15] tracking-tight">
            {m.headline1}<br />{m.headline2}
          </h1>
          {/* CTA 그라데이션을 inline style 로 — 라이트 셸의 [style*="#7C5CFC"] 규칙이
              글자를 흰색으로 강제해 root 딥네이비 상속을 막음(Tailwind 클래스 그라데이션은 미매칭). */}
          <Link
            to="/planner"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-6 py-3 text-sm font-semibold active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg, #7C5CFC 0%, #EA537E 100%)', boxShadow: '0 10px 28px rgba(124,92,255,0.30)', color: '#fff' }}
          >
            <Sparkles size={16} /> {m.cta}
          </Link>
        </div>
      </section>

      {/* Categories - 커스텀 보라 3D 아이콘 */}
      <section className="px-4 py-1">
        <div className="grid grid-cols-5 gap-1">
          {CATEGORIES.map((c) => (
            <Link key={c.key} to={c.to} className="flex flex-col items-center gap-1 py-2 active:opacity-70">
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                  c.accent ? 'bg-gradient-to-br from-purple-500/40 to-pink-500/40 ring-1 ring-purple-400/50' : 'bg-white/[0.06]'
                }`}
              >
                <img src={c.icon} alt="" className="h-9 w-9 object-contain" loading="lazy" />
              </span>
              <span className="text-center text-[10px] leading-tight text-white/70">{m[c.key]}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Popular Tours - 실데이터 (TOURS + 가격 SSOT) */}
      <section className="pt-4">
        <div className="mb-2 flex items-center justify-between px-5">
          <h2 className="text-base font-bold">{m.toursTitle}</h2>
          <Link to="/tours" className="flex items-center text-sm text-purple-300">
            {m.seeAll} <ChevronRight size={16} />
          </Link>
        </div>
        <div className="flex gap-2.5 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {featuredTours.map((tour) => (
            <Link
              key={tour.slug}
              to={`/tours/${tour.slug}`}
              className="w-36 shrink-0 active:scale-[0.98] transition-transform"
            >
              <div className="relative h-24 overflow-hidden rounded-2xl">
                <img src={tour.images[0]} alt={tour.title[language]} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-tight">{tour.title[language]}</p>
              <p className="mt-0.5 text-xs text-purple-300">
                <span className="text-white/40">{m.from} </span>{priceLabel(tour.id, tour.priceFrom, tour.priceUnit || 'group')}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Regions - 기존 t.regions 번역 재사용 */}
      <section className="px-5 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">{m.exploreTitle}</h2>
          <Link to="/tours" className="flex items-center text-sm text-purple-300">
            {m.seeAll} <ChevronRight size={16} />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {REGIONS.map((r) => (
            <Link
              key={r.id}
              to={`/region/${r.id}`}
              className="mobile-home-tour-card relative h-24 overflow-hidden rounded-2xl active:scale-[0.98] transition-transform"
            >
              <img src={r.image} alt={regionNames[r.id] || r.id} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
              <div className="absolute bottom-2.5 left-3 flex items-center gap-1">
                <MapPin size={14} className="text-pink-400" />
                {/* mobile-home-tour-card 예외 셀렉터가 사진 위 text-white 를 라이트 변환에서 제외 */}
                <span className="text-sm font-semibold text-white drop-shadow">{regionNames[r.id] || r.id}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Korea Travel Blog — 외부 링크. prod 모바일 홈=V2 라 v1(MobileHome)에만 넣으면
          미노출(2026-07-05 prod 실렌더 검증에서 발견). 권위 전달 목적이라 nofollow 금지. */}
      <section className="px-5 pt-4">
        <a
          href="https://cocotripkr.blogspot.com"
          target="_blank"
          rel="noopener"
          className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3.5 active:opacity-70"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/40 to-pink-500/40 ring-1 ring-purple-400/50">
            <BookOpen size={18} className="text-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t.footer.blog || 'Korea Travel Blog'}</span>
            <span className="mt-0.5 block truncate text-[11px] text-white/50">{t.blogTeaser?.subtitle || 'Real routes, prices and local picks'}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-white/30" />
        </a>
      </section>

      {/* 하단 네비 = 앱 전역 mobile-bottom-nav 재사용 (중복 방지) */}
    </div>
  );
}
