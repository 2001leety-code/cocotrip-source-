import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, MapPin, ChevronRight, BookOpen, ArrowRight, CloudSun, User } from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useLanguage } from '@/hooks/useLanguage';
import { signalAppReady } from '@/lib/appReady';
import { TOURS, getTourPriceKRW } from '@/data/tours';
import { COCO_CATEGORY_ICONS } from '@/components/icons/CocoIcons';
import { formatPrice } from '@/lib/exchange-rate';
import type { Language } from '@/i18n';

/**
 * 모바일 v2 홈 — 레퍼런스 디자인 가이드(2026-07 운영자 제공 5장) 기반 라이트 UI.
 * 구성: 인사말 헤더 → 히어로 목적지 카드(실시간 날씨 칩) → 플로팅 AI 일정 제안 카드(시그니처)
 *       → 카테고리 타일 → Smart Picks(실투어·SSOT 가격) → 지역 그리드 → 블로그.
 * 라이브 전환: App.tsx HomePage 가 VITE_FEATURE_MOBILE_V2(또는 ?v2)일 때 본 컴포넌트 렌더.
 * /preview/mobile-home 프리뷰 라우트는 항상 본 컴포넌트.
 *
 * 디자인 토큰(가이드 p.2): #7C5CFF 퍼플 / #FF6DB7 핑크 / #D9D3FF 라벤더 / #0F1230 딥네이비.
 * 정직 원칙: 리뷰 평점·호텔 Book Now 등 실데이터 없는 섹션은 넣지 않음(환각 금지).
 * 날씨=wttr.in 실측(v1 MobileHome 과 동일 패턴), 투어 가격=getTourPriceKRW SSOT.
 */

type CategoryKey = 'catPlanner' | 'catTours' | 'catCharter' | 'catAirport' | 'catKpop';
// 아이콘: 옛 3D PNG → 가이드 p.2 규격 선 아이콘(CocoIcons, 운영자 시안 컨펌 2026-07-12)
const CATEGORIES: { icon: keyof typeof COCO_CATEGORY_ICONS; key: CategoryKey; to: string; accent?: boolean }[] = [
  { icon: 'planner', key: 'catPlanner', to: '/planner', accent: true },
  { icon: 'tours', key: 'catTours', to: '/tours' },
  { icon: 'charter', key: 'catCharter', to: '/charter' },
  { icon: 'airport', key: 'catAirport', to: '/charter' },
  { icon: 'kpop', key: 'catKpop', to: '/tours' },
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

const NAVY = '#0F1230';
const MUTED = '#6E6A8F';
const PURPLE = '#7C5CFF';
const CTA_GRADIENT = 'linear-gradient(100deg, #7C5CFF 0%, #FF5FC8 100%)';
const CARD_BORDER = '1px solid rgba(124, 92, 255, 0.14)';
const CARD_SHADOW = '0 14px 30px rgba(48, 39, 118, 0.10)';

export default function MobileHomeV2() {
  const { language, t, changeLanguage } = useLanguage();
  const m = t.mobileHomeV2;
  const regionNames = t.regions as unknown as Record<string, string>;
  const [weather, setWeather] = useState<{ temp: string; desc: string } | null>(null);

  usePageMeta({
    title: `${m.headline1} ${m.headline2}`,
    description: 'AI travel planner, private tours & charter across Korea - CocoTrip.',
  });

  // PWA 실행 스플래시 페이드아웃 — 홈 첫 화면 준비됨 신호 (코코트립 standalone 진입점).
  useEffect(() => { signalAppReady(); }, []);

  // 히어로 날씨 칩 — v1 MobileHome 과 동일한 실측 소스(wttr.in). 실패 시 칩 미노출(silent).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('https://wttr.in/Seoul?format=j1');
        const data = await res.json();
        const cur = data.current_condition?.[0];
        if (cur) setWeather({ temp: `${cur.temp_C}°C`, desc: cur.weatherDesc?.[0]?.value || '' });
      } catch { /* silent */ }
    })();
  }, []);

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
    <div
      className="min-h-screen pb-28 max-w-md mx-auto"
      style={{
        color: NAVY,
        background:
          'radial-gradient(circle at 88% 6%, rgba(255, 109, 183, 0.14), transparent 30%),' +
          'radial-gradient(circle at 8% 22%, rgba(124, 92, 255, 0.12), transparent 32%),' +
          'linear-gradient(180deg, #fbfaff 0%, #f5f2ff 46%, #ffffff 100%)',
      }}
    >
      {/* ── 인사말 헤더 (가이드 p.3 01 Home: greeting + avatar) ── */}
      <header className="flex items-start justify-between gap-3 px-5 pb-1 pt-[max(env(safe-area-inset-top),1rem)]">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[13px] font-bold" style={{ color: PURPLE }}>
            {m.greeting} <Sparkles size={12} aria-hidden />
          </p>
          <h1 className="mt-0.5 text-[19px] font-extrabold leading-[1.25] tracking-tight">
            {m.greetingSub}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <button
            onClick={cycleLanguage}
            aria-label="Language"
            className="flex h-9 min-w-9 items-center justify-center rounded-full bg-white px-2.5 text-xs font-bold active:opacity-70"
            style={{ color: PURPLE, border: CARD_BORDER, boxShadow: '0 6px 16px rgba(48,39,118,0.08)' }}
          >
            {LANG_LABEL[language]}
          </button>
          <Link
            to="/mypage"
            aria-label="My page"
            className="flex h-9 w-9 items-center justify-center rounded-full active:opacity-70"
            style={{ background: CTA_GRADIENT, boxShadow: '0 8px 18px rgba(124,92,255,0.28)' }}
          >
            <User size={16} className="text-white" />
          </Link>
        </div>
      </header>

      {/* ── 히어로 목적지 카드 + 플로팅 AI 제안 카드 (시그니처) ── */}
      <section className="px-5 pt-3">
        <div className="relative h-52 overflow-hidden rounded-[24px]" style={{ boxShadow: CARD_SHADOW }}>
          {/* 야경 도시 무드(레퍼런스 p.1/p.3 히어로) — region-seoul.jpg(벚꽃)보다 hero-seoul(반포대교+남산타워) */}
          <img src="/hero-seoul.webp" alt={regionNames.seoul || 'Seoul'} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0F1230]/75 via-[#0F1230]/10 to-transparent" />
          {weather && (
            <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-[#0F1230]/35 px-2.5 py-1.5 backdrop-blur-md">
              <CloudSun size={13} className="text-white" />
              <span className="text-[11px] font-bold text-white">{weather.temp}</span>
              <span className="max-w-24 truncate text-[10px] text-white/85">{weather.desc}</span>
            </div>
          )}
          <div className="absolute bottom-9 left-4">
            <p className="text-[26px] font-extrabold leading-none text-white drop-shadow">{regionNames.seoul || 'Seoul'}</p>
            <p className="mt-1 text-[9.5px] font-bold tracking-[0.22em] text-white/80">SOUTH KOREA</p>
          </div>
        </div>

        {/* 히어로 하단에 겹쳐 뜨는 elevated 카드 (가이드 p.1 mock 구조) */}
        <div
          className="relative z-10 -mt-7 rounded-[20px] p-4 backdrop-blur-xl mx-1"
          style={{ background: 'rgba(255,255,255,0.96)', border: CARD_BORDER, boxShadow: '0 20px 44px rgba(48, 39, 118, 0.16)' }}
        >
          <p className="flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: PURPLE }}>
            <Sparkles size={12} /> {m.aiCardTitle}
          </p>
          <p className="mt-0.5 text-[10.5px]" style={{ color: MUTED }}>{m.aiCardSub}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[17px] font-extrabold tracking-tight">{m.aiCardSample}</p>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold"
              style={{ background: 'rgba(124,92,255,0.12)', color: PURPLE }}
            >
              {m.bestMatch}
            </span>
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{m.aiCardTags}</p>
          <Link
            to="/planner"
            className="mt-3 flex items-center justify-center gap-1.5 rounded-full py-3 text-[13px] font-bold text-white active:scale-[0.98] transition-transform"
            style={{ background: CTA_GRADIENT, boxShadow: '0 10px 26px rgba(124,92,255,0.30)' }}
          >
            {m.viewFullPlan} <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* ── 카테고리 타일 ── */}
      <section className="px-4 pt-4">
        <div className="grid grid-cols-5 gap-1">
          {CATEGORIES.map((c) => {
            const Icon = COCO_CATEGORY_ICONS[c.icon];
            return (
              <Link key={c.key} to={c.to} className="flex flex-col items-center gap-1.5 py-2 active:opacity-70">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-[15px]"
                  style={{
                    background: 'linear-gradient(180deg, #F7F5FE 0%, #EEEAFB 100%)',
                    border: c.accent ? '1px solid rgba(124,92,255,0.35)' : CARD_BORDER,
                    boxShadow: c.accent ? '0 10px 22px rgba(124,92,255,0.20)' : '0 8px 18px rgba(48,39,118,0.07)',
                  }}
                >
                  <Icon size={25} />
                </span>
                <span className="text-center text-[10px] font-semibold leading-tight" style={{ color: MUTED }}>{m[c.key]}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Smart Picks — 실데이터 (TOURS + 가격 SSOT) ── */}
      <section className="pt-4">
        <div className="mb-2 flex items-center justify-between px-5">
          <h2 className="text-[16px] font-extrabold tracking-tight">{m.smartPicks}</h2>
          <Link to="/tours" className="flex items-center text-[12.5px] font-semibold" style={{ color: PURPLE }}>
            {m.seeAll} <ChevronRight size={15} />
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {featuredTours.map((tour) => (
            <Link
              key={tour.slug}
              to={`/tours/${tour.slug}`}
              className="w-40 shrink-0 active:scale-[0.98] transition-transform"
            >
              <div className="relative h-28 overflow-hidden rounded-[18px]" style={{ boxShadow: '0 10px 24px rgba(48,39,118,0.10)' }}>
                <img src={tour.images[0]} alt={tour.title[language]} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0F1230]/55 via-transparent to-transparent" />
                <span className="absolute right-2 top-2 rounded-full bg-white/25 px-2 py-0.5 text-[9.5px] font-bold text-white backdrop-blur-sm">
                  {priceLabel(tour.id, tour.priceFrom, tour.priceUnit || 'group')}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12.5px] font-bold leading-tight">{tour.title[language]}</p>
              <p className="mt-0.5 text-[11px] font-semibold" style={{ color: PURPLE }}>
                <span style={{ color: MUTED }}>{m.from} </span>{priceLabel(tour.id, tour.priceFrom, tour.priceUnit || 'group')}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 지역 그리드 — 기존 t.regions 번역 재사용 ── */}
      <section className="px-5 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-extrabold tracking-tight">{m.exploreTitle}</h2>
          <Link to="/tours" className="flex items-center text-[12.5px] font-semibold" style={{ color: PURPLE }}>
            {m.seeAll} <ChevronRight size={15} />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {REGIONS.map((r) => (
            <Link
              key={r.id}
              to={`/region/${r.id}`}
              className="relative h-24 overflow-hidden rounded-[18px] active:scale-[0.98] transition-transform"
              style={{ boxShadow: '0 10px 24px rgba(48,39,118,0.09)' }}
            >
              <img src={r.image} alt={regionNames[r.id] || r.id} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0F1230]/75 via-[#0F1230]/10 to-transparent" />
              <div className="absolute bottom-2.5 left-3 flex items-center gap-1">
                <MapPin size={13} className="text-[#FF6DB7]" />
                <span className="text-sm font-bold text-white drop-shadow">{regionNames[r.id] || r.id}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Korea Travel Blog — 외부 링크. 권위 전달 목적이라 nofollow 금지. ── */}
      <section className="px-5 pt-4">
        <a
          href="https://cocotripkr.blogspot.com"
          target="_blank"
          rel="noopener"
          className="flex items-center gap-3 rounded-[18px] bg-white px-4 py-3.5 active:opacity-70"
          style={{ border: CARD_BORDER, boxShadow: '0 10px 24px rgba(48,39,118,0.08)' }}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(124,92,255,0.12)' }}
          >
            <BookOpen size={18} style={{ color: PURPLE }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold">{t.footer.blog || 'Korea Travel Blog'}</span>
            <span className="mt-0.5 block truncate text-[11px]" style={{ color: MUTED }}>{t.blogTeaser?.subtitle || 'Real routes, prices and local picks'}</span>
          </span>
          <ChevronRight size={16} className="shrink-0" style={{ color: 'rgba(110,106,143,0.5)' }} />
        </a>
      </section>

      {/* 하단 네비 = 앱 전역 mobile-bottom-nav 재사용 (중복 방지) */}
    </div>
  );
}
