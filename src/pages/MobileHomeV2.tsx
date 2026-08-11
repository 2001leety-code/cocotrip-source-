import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, MapPin, ChevronRight, BookOpen, ArrowRight, CloudSun, User, Bell, Search, Check } from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { TripEssentialsCards, shouldShowHomeAffiliate } from '@/components/home/TripEssentialsCards';
import { signalAppReady } from '@/lib/appReady';
import { TOURS, getTourPriceKRW, publicBadgeTag } from '@/data/tours';
import { COCO_CATEGORY_ICONS } from '@/components/icons/CocoIcons';
import { COCO, GradientCTA, StatusChip } from '@/components/coco/CocoUI';
import { formatPrice } from '@/lib/exchange-rate';
import { wttrLangParam, pickWeatherDesc } from '@/lib/weatherDesc';
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

type CategoryKey = 'catPlanner' | 'catTours' | 'catCharter' | 'catMap' | 'catCommunity';
// 아이콘: 옛 3D PNG → 가이드 p.2 규격 선 아이콘(CocoIcons, 운영자 시안 컨펌 2026-07-12)
// 2026-07-19: 가이드 p.1 Quick Actions 정렬 — airport(/charter 중복)·kpop(/tours 중복) 타일을
// Map(/map)·Community(/community) 실화면 진입으로 교체.
const CATEGORIES: { icon: keyof typeof COCO_CATEGORY_ICONS; key: CategoryKey; to: string; accent?: boolean }[] = [
  { icon: 'planner', key: 'catPlanner', to: '/planner', accent: true },
  { icon: 'tours', key: 'catTours', to: '/tours' },
  { icon: 'charter', key: 'catCharter', to: '/charter' },
  { icon: 'map', key: 'catMap', to: '/map' },
  { icon: 'community', key: 'catCommunity', to: '/community' },
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
// P1 (2026-07-14): 언어 셀렉터 — 순환 버튼 대신 이름 있는 드롭다운 메뉴(발견성↑).
// 트리거 버튼 외형은 기존과 픽셀 동일(홈 above-fold visual baseline 무변경) —
// 메뉴는 탭 시에만 열리므로 정적 fold 스크린샷에 안 잡힘.
const LANG_FULL: Record<Language, string> = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文' };

// 팔레트 토큰 = CocoUI 단일 원천(COCO)에서 파생 — 가이드 p.2 값 중복 정의 제거(P10 공용화).
const NAVY = COCO.navy;
const MUTED = COCO.muted;
const PURPLE = COCO.purple;
const CTA_GRADIENT = COCO.ctaGradient;
const CARD_BORDER = COCO.cardBorder;
const CARD_SHADOW = COCO.cardShadow;

export default function MobileHomeV2() {
  const { language, t, changeLanguage } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const m = t.mobileHomeV2;
  const regionNames = t.regions as unknown as Record<string, string>;
  const [weather, setWeather] = useState<{ temp: string; desc: string } | null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // 알림 뱃지 (UIUX P1, 2026-07-13) — 로그인 시 1회 조회. 실패 = 뱃지 0(무해).
  useEffect(() => {
    if (!user) { setUnreadAlerts(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/community-notifications', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!cancelled && data.ok) setUnreadAlerts(data.data.unread || 0);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  usePageMeta({
    title: `${m.headline1} ${m.headline2}`,
    description: 'Private tours, charter vehicles and Korea itineraries built from real local routes - CocoTrip.',
  });

  // PWA 실행 스플래시 페이드아웃 — 홈 첫 화면 준비됨 신호 (코코트립 standalone 진입점).
  useEffect(() => { signalAppReady(); }, []);

  // 히어로 날씨 칩 — v1 MobileHome 과 동일한 실측 소스(wttr.in). 실패 시 칩 미노출(silent).
  // 2026-07-17: 설명 텍스트 UI 언어 반영 (영어 "Partly cloudy" 잔존 해소, 없으면 영어 폴백).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`https://wttr.in/Seoul?format=j1${wttrLangParam(language)}`);
        const data = await res.json();
        const cur = data.current_condition?.[0];
        if (cur) setWeather({ temp: `${cur.temp_C}°C`, desc: pickWeatherDesc(cur, language) });
      } catch { /* silent */ }
    })();
  }, [language]);

  const featuredTours = TOURS.slice(0, 6);
  const priceLabel = (tourId: string, priceFrom: number, unit: 'group' | 'per_person') => {
    const krw = getTourPriceKRW(tourId, priceFrom, unit);
    if (language === 'ko') {
      return krw >= 10000 ? `${Math.round(krw / 10000)}만원~` : `${krw.toLocaleString()}원~`;
    }
    return formatPrice(krw, language, { approximate: true });
  };

  const [langOpen, setLangOpen] = useState(false);

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
          <Link
            to="/community?tab=alerts"
            aria-label="Alerts"
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white active:opacity-70"
            style={{ color: PURPLE, border: CARD_BORDER, boxShadow: '0 6px 16px rgba(48,39,118,0.08)' }}
          >
            <Bell size={15} />
            {unreadAlerts > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{ background: '#FF6B9D' }}>
                {unreadAlerts > 9 ? '9+' : unreadAlerts}
              </span>
            )}
          </Link>
          <div className="relative">
            <button
              // 열기는 idempotent(setTrue) — dev StrictMode/이중마운트로 핸들러가
              // 2회 발화해도 열림 유지(토글 !o 였다면 짝수 발화 시 도로 닫힘).
              // 닫기는 backdrop(열렸을 때 버튼 위 오버레이) 또는 항목 선택이 담당.
              onClick={() => setLangOpen(true)}
              aria-label="Language"
              aria-haspopup="menu"
              aria-expanded={langOpen}
              className="flex h-9 min-w-9 items-center justify-center rounded-full bg-white px-2.5 text-xs font-bold active:opacity-70"
              style={{ color: PURPLE, border: CARD_BORDER, boxShadow: '0 6px 16px rgba(48,39,118,0.08)' }}
            >
              {LANG_LABEL[language]}
            </button>
            {langOpen && (
              <>
                {/* 바깥 클릭 닫기 */}
                <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} aria-hidden />
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-36 overflow-hidden rounded-2xl bg-white py-1"
                  style={{ border: CARD_BORDER, boxShadow: '0 12px 30px rgba(48,39,118,0.18)' }}
                >
                  {LANG_CYCLE.map((lng) => {
                    const active = lng === language;
                    return (
                      <button
                        key={lng}
                        role="menuitem"
                        onClick={() => { changeLanguage(lng); setLangOpen(false); }}
                        className="flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] active:opacity-70"
                        style={{ color: active ? PURPLE : NAVY, fontWeight: active ? 700 : 500 }}
                      >
                        {LANG_FULL[lng]}
                        {active && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
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

      {/* ── 검색바 (가이드 p.1 "Search destinations, attractions...") — 제출 시 투어 검색으로 라우팅 ── */}
      <form
        className="px-5 pt-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = searchQuery.trim();
          navigate(q ? `/tours?q=${encodeURIComponent(q)}` : '/tours');
        }}
      >
        <div
          className="flex items-center gap-2.5 rounded-full bg-white px-4 py-3"
          style={{ border: CARD_BORDER, boxShadow: '0 6px 16px rgba(48,39,118,0.08)' }}
        >
          <Search size={16} aria-hidden style={{ color: PURPLE }} className="shrink-0" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={m.searchPlaceholder}
            aria-label={m.searchPlaceholder}
            enterKeyHint="search"
            className="w-full bg-transparent text-[13px] font-medium outline-none placeholder:text-[#9B96BC]"
            style={{ color: NAVY }}
          />
        </div>
      </form>

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
            <StatusChip tone="purple">{m.bestMatch}</StatusChip>
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>{m.aiCardTags}</p>
          <GradientCTA to="/planner" className="mt-3 w-full">
            {m.viewFullPlan} <ArrowRight size={15} />
          </GradientCTA>
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
          {featuredTours.map((tour) => {
            // TourCard 와 같은 진실성 필터 — 근거 없는 태그(Popular/Best Value/AI-Curated)는 배지로 내보내지 않는다.
            const badgeTag = publicBadgeTag(tour.tags);
            return (
            <Link
              key={tour.slug}
              to={`/tours/${tour.slug}`}
              className="w-40 shrink-0 active:scale-[0.98] transition-transform"
            >
              <div className="relative h-28 overflow-hidden rounded-[18px]" style={{ boxShadow: '0 10px 24px rgba(48,39,118,0.10)' }}>
                <img src={tour.images[0]} alt={tour.title[language]} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0F1230]/55 via-transparent to-transparent" />
                {badgeTag && (
                  <span className="absolute left-2 top-2"><StatusChip tone="purple">{badgeTag}</StatusChip></span>
                )}
                <span className="absolute right-2 top-2 rounded-full bg-white/25 px-2 py-0.5 text-[9.5px] font-bold text-white backdrop-blur-sm">
                  {priceLabel(tour.id, tour.priceFrom, tour.priceUnit || 'group')}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-1 text-[12.5px] font-bold leading-tight">{tour.title[language]}</p>
              {/* Why we love it — tour.summary 실데이터 파생(가이드 p.10 Smart Pick). 별점·리뷰수 삽입 금지. */}
              <p className="mt-0.5 text-[8.5px] font-bold uppercase tracking-wide" style={{ color: PURPLE }}>{m.whyWeLove}</p>
              <p className="line-clamp-2 text-[10.5px] leading-snug" style={{ color: MUTED }}>{tour.summary[language]}</p>
              <p className="mt-1 text-[11px] font-semibold" style={{ color: PURPLE }}>
                <span style={{ color: MUTED }}>{m.from} </span>{priceLabel(tour.id, tour.priceFrom, tour.priceUnit || 'group')}
              </p>
            </Link>
            );
          })}
        </div>
      </section>

      {/* ── 여행 준비 (제휴) ──
          🔴 자체 상품(Smart Picks) **아래**에 둔다 — 우리 상품이 먼저다.
          기본 OFF. VITE_FEATURE_HOME_AFFILIATE=true 이고 Trip.com 제휴 ID 가
          env 에 실제로 설정돼 있을 때만 렌더한다(fail-closed). 컴포넌트 안에서도
          한 번 더 막지만, 여기서도 걸러 불필요한 렌더를 만들지 않는다. */}
      {shouldShowHomeAffiliate() && <TripEssentialsCards language={language} />}

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
