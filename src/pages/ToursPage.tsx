// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – Tours 상품 리스트 페이지
// 디자인: 다크 네이비 배경 + 퍼플/핑크 그라데이션 (기존 토큰 재사용)
// 통합 시: App.tsx 라우터에 <Route path="/tours" element={<ToursPage />} /> 추가
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Package, ShieldCheck, CreditCard, Phone,
  ChevronRight, Languages, ArrowUpDown, ExternalLink, Search, X,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { TourCard } from '@/components/tours/TourCard';
import { TourInquireModal } from '@/components/tours/TourInquireModal';
import { TOUR_REGIONS, getToursByRegion } from '@/data/tours';
import type { TourRegion, DriverLanguage, TourTag } from '@/data/tours';
import type { Language } from '@/i18n';
import { buildHotelListLink } from '@/config/affiliateLinks';
import { trackEvent } from '@/lib/analytics';
import { trackAffiliateClick } from '@/lib/affiliateTracking';
import { AffiliateCard } from '@/components/AffiliateCard';
import { matchesTourQuery } from '@/lib/tourSearch';
import { TOUR_PACE, PACE_ORDER, paceEmoji, paceLabel, type TripPace } from '@/data/tourPace';

type SortKey = 'default' | 'price-asc' | 'price-desc';

// ── 로컬 i18n ─────────────────────────────────────────────────────────────────
// 통합 시 이 객체를 src/i18n/index.ts 의 translations.*.tours 로 이전하고
// useLanguage()의 t.tours 로 교체
const TL = {
  ko: {
    pageTitle: '투어 상품',
    pageSubtitle: '코코트립이 엄선한 한국 프라이빗 투어 패키지',
    filterLabel: '지역 필터',
    inquireTitle: '원하는 투어가 없나요?',
    inquireSub: '지역·테마·예산만 알려주시면 맞춤 견적을 보내드립니다',
    inquireBtn: '맞춤 문의',
    charterLink: '차터 견적폼',
    hotelCtaText: '투어 전후 숙소가 필요하신가요?',
    hotelCtaBtn: 'Trip.com에서 숙소 보기',
    hotelCtaNew: '새 창에서 Trip.com이 열립니다',
    seoTitle: 'CocoTrip 투어 — 한국 프라이빗 투어',
    seoDesc: '서울·부산·제주 전세차량 투어. 톨비·주차비 포함, PayPal 안심결제.',
    noResults: '해당 지역 투어 상품이 없습니다',
    noSearchResults: '검색어와 일치하는 투어가 없어요',
    searchPlaceholder: '여행지·명소 검색...',
    clearSearch: '검색어 지우기',
    popularDestinations: '인기 목적지',
    toursUnit: '투어',
  },
  en: {
    pageTitle: 'Tours',
    pageSubtitle: 'Handpicked Korea private tour packages by CocoTrip',
    filterLabel: 'Filter by region',
    inquireTitle: 'Need a custom tour?',
    inquireSub: 'Tell us your region, theme & budget — we will send a tailored quote',
    inquireBtn: 'Inquire',
    charterLink: 'Charter quote form',
    hotelCtaText: 'Need a place to stay before or after your tour?',
    hotelCtaBtn: 'Browse hotels on Trip.com',
    hotelCtaNew: 'Opens Trip.com in a new tab',
    seoTitle: 'CocoTrip Tours — Korea Private Tours',
    seoDesc: 'Seoul, Busan & Jeju private van tours. Tolls and parking included. PayPal secure.',
    noResults: 'No tours available for this region',
    noSearchResults: 'No tours match your search',
    searchPlaceholder: 'Search destinations, attractions...',
    clearSearch: 'Clear search',
    popularDestinations: 'Popular Destinations',
    toursUnit: 'tours',
  },
  ja: {
    pageTitle: 'ツアー',
    pageSubtitle: 'CocoTripが厳選した韓国プライベートツアーパッケージ',
    filterLabel: '地域フィルター',
    inquireTitle: '希望のツアーがありませんか？',
    inquireSub: '地域・テーマ・予算を教えていただければ、お見積もりをお送りします',
    inquireBtn: 'お問い合わせ',
    charterLink: 'チャーター見積フォーム',
    hotelCtaText: 'ツアー前後の宿泊先をお探しですか？',
    hotelCtaBtn: 'Trip.comでホテルを見る',
    hotelCtaNew: '新しいタブでTrip.comが開きます',
    seoTitle: 'CocoTrip ツアー — 韓国プライベートツアー',
    seoDesc: 'ソウル・釜山・済州の専用バンツアー。通行料・駐車場込み。PayPal安全決済。',
    noResults: 'このエリアのツアーはありません',
    noSearchResults: '検索に一致するツアーがありません',
    searchPlaceholder: '目的地・観光スポットを検索...',
    clearSearch: '検索をクリア',
    popularDestinations: '人気の目的地',
    toursUnit: '件',
  },
  zh: {
    pageTitle: '旅游产品',
    pageSubtitle: 'CocoTrip精选韩国私人旅游套餐',
    filterLabel: '按地区筛选',
    inquireTitle: '没有想要的路线？',
    inquireSub: '告诉我们地区·主题·预算，我们将发送定制报价',
    inquireBtn: '立即咨询',
    charterLink: '包车报价表',
    hotelCtaText: '旅游前后需要住宿吗？',
    hotelCtaBtn: '在Trip.com查看酒店',
    hotelCtaNew: '将在新窗口打开Trip.com',
    seoTitle: 'CocoTrip 旅游 — 韩国私人包车游',
    seoDesc: '首尔、釜山和济州私人包车游览，含过路费·停车费，PayPal安全支付。',
    noResults: '该地区暂无旅游产品',
    noSearchResults: '没有符合搜索的旅游产品',
    searchPlaceholder: '搜索目的地、景点...',
    clearSearch: '清除搜索',
    popularDestinations: '热门目的地',
    toursUnit: '条',
  },
} satisfies Record<Language, Record<string, string>>;

// 지역 대표 이미지 — 실존 public 자산만 매핑. 없는 지역은 그라디언트 폴백(잘못된 사진 라벨링 금지).
const REGION_IMAGE: Record<string, string> = {
  Seoul: '/region-seoul.jpg',
  Busan: '/region-busan.webp',
  Gyeongju: '/region-gyeongju.jpg',
  Danyang: '/region-danyang.webp',
};

// ─────────────────────────────────────────────────────────────────────────────
export default function ToursPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const tl = TL[language] || TL.en;

  // 홈 검색바(?q=) 시딩 — 초기값만 URL에서 읽고, 타이핑마다 history 는 쌓지 않음.
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [activeRegion, setActiveRegion] = useState<TourRegion | 'All'>('All');
  const [activeDuration, setActiveDuration] = useState<'All' | 'Day' | 'Short' | 'Long'>('All');
  // Interests 필터 (UIUX 가이드 P7 'Filter Your Interests') — TourTag 실데이터만 칩으로 노출.
  // 데이터 없는 관심사(Food·Wellness 등)는 칩 자체를 만들지 않음(죽은 필터 금지). OR 매칭.
  const [activeTags, setActiveTags] = useState<Set<TourTag>>(new Set());
  const [activeLangs, setActiveLangs] = useState<Set<DriverLanguage>>(new Set());
  // Trip Style(pace) 필터 (가이드 P7) — tourPace.ts 실데이터. OR 매칭.
  const [activePace, setActivePace] = useState<Set<TripPace>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const [inquireOpen, setInquireOpen] = useState(false);

  // Trip.com 숙소 CTA — 활성 지역 필터에 맞춰 도시 좁힘 (hotels.ts REGION_MAP 과 동일 폴백).
  const HOTEL_CITY_KEY: Partial<Record<TourRegion, string>> = {
    Seoul: 'seoul', Busan: 'busan', Jeju: 'jeju', Gyeongju: 'gyeongju',
    Chuncheon: 'chuncheon', Danyang: 'danyang', Incheon: 'incheon',
    Ganghwa: 'seoul', DMZ: 'seoul', 'Multi-City': 'seoul',
  };
  const hotelCityKey = activeRegion === 'All' ? undefined : HOTEL_CITY_KEY[activeRegion];
  const hotelSearchUrl = buildHotelListLink(hotelCityKey);

  // 맞춤투어 모달 지역 프리필 — 투어 필터가 서울/부산/제주면 그대로, 그 외 지역이면 '기타'.
  const inquireDefaultRegion: '' | 'seoul' | 'busan' | 'jeju' | 'other' =
    activeRegion === 'All' ? '' :
    activeRegion === 'Seoul' ? 'seoul' :
    activeRegion === 'Busan' ? 'busan' :
    activeRegion === 'Jeju' ? 'jeju' : 'other';

  const toggleLang = (lang: DriverLanguage) => {
    setActiveLangs(prev => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang); else next.add(lang);
      return next;
    });
  };

  const toggleTag = (tag: TourTag) => {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const togglePace = (pace: TripPace) => {
    setActivePace(prev => {
      const next = new Set(prev);
      if (next.has(pace)) next.delete(pace); else next.add(pace);
      return next;
    });
  };

  const regionTours = getToursByRegion(activeRegion);

  const filteredTours = regionTours.filter(t => {
    if (!matchesTourQuery(t, searchQuery)) return false;
    if (activeDuration === 'Day'   && t.durationDays !== 1)  return false;
    if (activeDuration === 'Short' && !(t.durationDays === 2 || t.durationDays === 3)) return false;
    if (activeDuration === 'Long'  && t.durationDays < 4)    return false;
    if (activeLangs.size > 0) {
      const langs = (t.driverLanguages && t.driverLanguages.length > 0) ? t.driverLanguages : (['en'] as DriverLanguage[]);
      const hasAll = Array.from(activeLangs).every(l => langs.includes(l));
      if (!hasAll) return false;
    }
    if (activeTags.size > 0 && !t.tags.some(tag => activeTags.has(tag))) return false;
    if (activePace.size > 0) {
      const p = TOUR_PACE[t.id];
      if (!p || !activePace.has(p)) return false;
    }
    return true;
  });

  const visibleTours = (() => {
    const arr = [...filteredTours];
    if (sortBy === 'price-asc')  arr.sort((a, b) => a.priceFrom - b.priceFrom);
    else if (sortBy === 'price-desc') arr.sort((a, b) => b.priceFrom - a.priceFrom);
    return arr;
  })();

  usePageMeta({
    title: tl.seoTitle,
    description: tl.seoDesc,
  });

  const TRUST_BADGES = [
    {
      icon: ShieldCheck,
      color: '#B668FC',
      label: language === 'ko' ? '톨비·주차비 포함' :
             language === 'ja' ? '通行料・駐車場込み' :
             language === 'zh' ? '含过路费·停车费' :
             'Tolls & Parking Incl.',
      sub: language === 'ko' ? '식사·입장료 별도' :
           language === 'ja' ? '食事・入場料は別' :
           language === 'zh' ? '餐费·门票另计' :
           'Meals & Admission Extra',
    },
    {
      icon: CreditCard,
      color: '#FF6B9D',
      label: 'PayPal', // brand, intentionally untranslated
      sub: language === 'ko' ? 'PayPal 안심결제' :
           language === 'ja' ? 'PayPal 安全決済' :
           language === 'zh' ? 'PayPal 安全支付' :
           'Secure Payment',
    },
    {
      icon: Phone,
      color: '#C850C0',
      label: language === 'ko' ? '평일 10~18시' :
             language === 'ja' ? '平日10~18時' :
             language === 'zh' ? '工作日10-18点' :
             'Weekdays 10am–6pm',
      sub: language === 'ko' ? '영어 지원' :
           language === 'ja' ? '英語サポート' :
           language === 'zh' ? '英语客服' :
           'English Support',
    },
  ];

  // 정제 퍼플·핑크 (시각만). OFF=현재 그대로.
  const REFINED = import.meta.env.VITE_FEATURE_REFINED_UI === 'true'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('refined'));

  return (
    <div
      className={`min-h-screen pb-28 ${isMobile ? 'cocotrip-mobile-tours' : ''} ${REFINED ? 'refined-tours' : ''}`}
      style={{ background: 'linear-gradient(180deg, #0a0412 0%, #0d0618 50%, #080210 100%)' }}
    >
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .tours-shimmer {
          background: linear-gradient(90deg, #B668FC 0%, #FF6B9D 40%, #B668FC 80%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
        .tour-chip { transition: all 0.22s cubic-bezier(0.2, 0, 0.2, 1); }
        .tour-chip:active { transform: scale(0.93); }
        .hotel-card-hover { transition: border-color 0.22s ease, box-shadow 0.22s ease; }
        .hotel-card-hover:hover {
          border-color: rgba(182,104,252,0.30) !important;
          box-shadow: 0 0 20px rgba(182,104,252,0.10);
        }
      `}</style>

      {/* ── 헤더 ── */}
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      {/* ── 페이지 헤더 ── */}
      <header className={`max-w-6xl mx-auto px-4 sm:px-6 ${isMobile ? 'pt-3 pb-3' : 'pt-10 pb-5'}`}>
        <div
          className="rounded-[22px] px-4 py-4 sm:px-6 sm:py-6"
          style={{
            background: 'linear-gradient(135deg, rgba(19,45,88,0.92), rgba(24,13,42,0.86))',
            border: '1px solid rgba(118,83,194,0.22)',
            boxShadow: '0 18px 44px rgba(0,0,0,0.24)',
          }}
        >
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            <Package className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-purple-200/75 leading-none mb-1">
            CocoTrip tours
          </p>
          <h1 className="text-[24px] sm:text-[34px] font-black leading-[1.05] tours-shimmer">
            {tl.pageTitle}
          </h1>
          </div>
        </div>
        <p className="text-[12px] sm:text-[14px] text-white/58 sm:ml-[52px] leading-relaxed">
          {tl.pageSubtitle}
        </p>
        </div>
      </header>

      {/* ── 신뢰 배지 ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-3 sm:mb-5">
        <div data-testid="tours-trust-badges" className="flex flex-wrap sm:flex-nowrap gap-2 sm:overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TRUST_BADGES.map(({ icon: Icon, color, label, sub }, idx) => (
            <div
              key={label}
              data-testid={`tours-trust-badge-${idx}`}
              className="shrink-0 flex items-center gap-2 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-2xl"
              style={{
                background: `${color}0d`,
                border: `1px solid ${color}28`,
              }}
            >
              <Icon className="w-4 h-4 shrink-0" style={{ color }} />
              <div>
                <p className="text-[11px] font-black text-white leading-none">{label}</p>
                <p className="text-[10px] mt-0.5" style={{ color: `${color}99` }}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 구분선 ── */}
      <div className="max-w-6xl mx-auto mx-4 sm:mx-auto sm:px-6 h-px bg-white/[0.06] mb-4 sm:mb-5" />

      {/* UIUX 계절 팁 (운영자 아이디어 2026-07-14): 현재 월 기준 한국 계절 실팩트 안내.
          per-tour 가짜 별점 대신 정직한 계절 가이드(무슨 시즌·뭐가 좋고 힘든지). 4언어.
          투어별 세분화(예: 여름 레일바이크 더위 주의)는 실계절 적합도 큐레이션 필요=후속. */}
      {(() => {
        const mo = new Date().getMonth() + 1; // 1-12
        const season = mo >= 3 && mo <= 5 ? 'spring' : mo >= 6 && mo <= 8 ? 'summer' : mo >= 9 && mo <= 11 ? 'autumn' : 'winter';
        const TIP = {
          spring: { emoji: '🌸', ko: '봄 — 벚꽃 시즌(3월말~4월)이라 야외 투어 최적기예요. 일교차가 크니 겉옷을 챙기세요.', en: 'Spring — cherry-blossom season (late Mar–Apr) is prime time for outdoor tours. Pack a layer for chilly mornings.', ja: '春 — 桜シーズン(3月末〜4月)は屋外ツアーに最適。朝晩は冷えるので上着を。', zh: '春季 — 樱花季(3月底~4月)最适合户外行程。早晚温差大，请带外套。' },
          summer: { emoji: '☀️', ko: '여름 — 덥고 습해요(장마 6월말~7월). 한낮 야외·등산은 힘들 수 있어 이른 아침·저녁이나 실내·계곡·해변 투어를 추천해요.', en: 'Summer — hot & humid (rainy season late Jun–Jul). Midday outdoor/hiking can be tough; prefer early/late hours or indoor·valley·beach tours.', ja: '夏 — 蒸し暑い(梅雨6月末〜7月)。日中の屋外・登山は大変。早朝・夕方や室内・渓谷・海のツアーがおすすめ。', zh: '夏季 — 炎热潮湿(梅雨6月底~7月)。正午户外·登山较吃力，建议清晨/傍晚或室内·溪谷·海滨行程。' },
          autumn: { emoji: '🍁', ko: '가을 — 단풍 시즌(10~11월)이라 여행하기 가장 좋은 날씨예요. 야외 투어 강력 추천!', en: 'Autumn — foliage season (Oct–Nov) is the best weather of the year. Outdoor tours highly recommended!', ja: '秋 — 紅葉シーズン(10〜11月)は一年で最も快適。屋外ツアーが断然おすすめ。', zh: '秋季 — 红叶季(10~11月)是全年最佳天气，强烈推荐户外行程!' },
          winter: { emoji: '❄️', ko: '겨울 — 춥고 건조해요. 방한 필수! 실내·온천·설경 투어를 추천해요.', en: 'Winter — cold & dry. Bundle up! Indoor·hot-spring·snow-scenery tours recommended.', ja: '冬 — 寒く乾燥。防寒必須! 室内・温泉・雪景色ツアーがおすすめ。', zh: '冬季 — 寒冷干燥。请注意保暖! 推荐室内·温泉·雪景行程。' },
        } as const;
        const tip = TIP[season];
        return (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-4">
            <div className="flex items-start gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <span className="text-lg leading-none mt-0.5 shrink-0">{tip.emoji}</span>
              <p className="text-[12.5px] leading-relaxed text-white/70">{tip[language] || tip.en}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Discover: 인기 목적지 카드 (가이드 P7) — N Tours = getToursByRegion 실카운트(TOURS SSOT 파생) ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-4 sm:mb-6">
        <p className="text-[10px] uppercase tracking-[0.1em] text-white/55 font-semibold mb-2.5">
          {tl.popularDestinations}
        </p>
        <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TOUR_REGIONS.filter((r) => r.key !== 'All').map(({ key, label }) => {
            const count = getToursByRegion(key).length;
            if (count === 0) return null;
            const isActive = activeRegion === key;
            const img = REGION_IMAGE[key];
            return (
              <button
                key={key}
                onClick={() => setActiveRegion(key)}
                aria-pressed={isActive}
                className="relative shrink-0 w-[124px] sm:w-[144px] h-[92px] rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform"
                style={{
                  border: isActive ? '1px solid rgba(182,104,252,0.55)' : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: isActive ? '0 0 14px rgba(182,104,252,0.22)' : 'none',
                }}
              >
                {img ? (
                  <img src={img} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(182,104,252,0.22), rgba(255,107,157,0.14))' }} />
                )}
                <span className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,4,18,0.04) 0%, rgba(10,4,18,0.80) 100%)' }} />
                <div className="absolute bottom-2 left-2.5 right-2.5">
                  <p className="text-[13px] font-black text-white leading-tight truncate drop-shadow">{label[language] || label.en}</p>
                  <p className="mt-0.5 flex items-baseline gap-1">
                    <span className="text-[15px] font-black text-white">{count}</span>
                    <span className="text-[10px] font-semibold text-white/70">{tl.toursUnit}</span>
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 지역 필터 칩 ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-4 sm:mb-6">
        <div
          className="rounded-[22px] p-3 sm:p-4"
          style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
        {/* 텍스트 검색 (가이드 P7 Discover) — 홈 검색바 ?q= 시딩과 연동 */}
        <div
          className="mb-3 flex items-center gap-2.5 rounded-full px-4 py-2.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <Search className="w-4 h-4 shrink-0 text-white/45" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tl.searchPlaceholder}
            aria-label={tl.searchPlaceholder}
            enterKeyHint="search"
            className="w-full bg-transparent text-[13px] font-medium text-white outline-none placeholder:text-white/35"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={tl.clearSearch}
              className="shrink-0 text-white/45 hover:text-white/80"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mb-2.5">
          <p className="text-[10px] uppercase tracking-[0.1em] text-white/55 font-semibold">
            {tl.filterLabel}
          </p>
          <p className="text-[11px] font-bold text-white/45">{visibleTours.length} {tl.toursUnit}</p>
        </div>
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TOUR_REGIONS.map(({ key, label }) => {
            const isActive = activeRegion === key;
            const chipLabel = label[language] || label.en;
            return (
              <button
                key={key}
                onClick={() => setActiveRegion(key)}
                className="tour-chip shrink-0 text-[11px] sm:text-[12px] font-bold px-3.5 sm:px-4 py-2 min-h-[36px] sm:min-h-[40px] rounded-full"
                style={
                  isActive
                    ? {
                        background: 'linear-gradient(135deg, rgba(182,104,252,0.18), rgba(255,107,157,0.12))',
                        border: '1px solid rgba(182,104,252,0.45)',
                        color: '#D0A8FF',
                        boxShadow: '0 0 12px rgba(182,104,252,0.18)',
                      }
                    : {
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'rgba(255,255,255,0.45)',
                      }
                }
              >
                {chipLabel}
              </button>
            );
          })}
        </div>

        {/* 기간 필터 (2번째 행) */}
        <div className="flex gap-1.5 sm:gap-2 mt-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'All',   label: { ko: '전체 기간',  en: 'All',        ja: '全期間',  zh: '全部' } },
            { key: 'Day',   label: { ko: '당일',       en: 'Day',        ja: '日帰り',  zh: '当天' } },
            { key: 'Short', label: { ko: '2~3일',      en: '2-3 Days',   ja: '2~3日',   zh: '2~3天' } },
            { key: 'Long',  label: { ko: '4일 이상',   en: '4+ Days',    ja: '4日以上', zh: '4天+' } },
          ] as const).map(({ key, label }) => {
            const isActive = activeDuration === key;
            return (
              <button
                key={key}
                onClick={() => setActiveDuration(key)}
                className="tour-chip shrink-0 text-[11px] font-semibold px-3 py-1.5 min-h-[32px] rounded-full"
                style={
                  isActive
                    ? { background: 'rgba(182,104,252,0.15)', border: '1px solid rgba(182,104,252,0.40)', color: '#D0A8FF' }
                    : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }
                }
              >
                {label[language] || label.en}
              </button>
            );
          })}
        </div>

        {/* Interests 필터 (가이드 P7) — TOURS 실태그만. 데이터 없는 관심사 칩 금지. */}
        <div className="flex gap-1.5 sm:gap-2 mt-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'Popular' as TourTag,    label: { ko: '인기',     en: 'Popular',    ja: '人気',       zh: '热门' } },
            { key: 'Nature' as TourTag,     label: { ko: '자연',     en: 'Nature',     ja: '自然',       zh: '自然' } },
            { key: 'History' as TourTag,    label: { ko: '역사·문화', en: 'History',    ja: '歴史・文化', zh: '历史文化' } },
            { key: 'Night Tour' as TourTag, label: { ko: '야경',     en: 'Night view', ja: '夜景',       zh: '夜景' } },
            { key: 'Multi-City' as TourTag, label: { ko: '다도시',   en: 'Multi-city', ja: '複数都市',   zh: '多城市' } },
          ]).map(({ key, label }) => {
            const isActive = activeTags.has(key);
            return (
              <button
                key={key}
                onClick={() => toggleTag(key)}
                className="tour-chip shrink-0 text-[11px] font-semibold px-3 py-1.5 min-h-[32px] rounded-full"
                style={
                  isActive
                    ? { background: 'rgba(255,107,157,0.14)', border: '1px solid rgba(255,107,157,0.45)', color: '#FF9DC0' }
                    : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }
                }
              >
                {label[language] || label.en}
              </button>
            );
          })}
        </div>

        {/* Trip Style(pace) 필터 (가이드 P7) — tourPace.ts 실데이터. OR 매칭. */}
        <div className="flex gap-1.5 sm:gap-2 mt-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {PACE_ORDER.map((pace) => {
            const isActive = activePace.has(pace);
            return (
              <button
                key={pace}
                onClick={() => togglePace(pace)}
                aria-pressed={isActive}
                className="tour-chip shrink-0 flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 min-h-[32px] rounded-full"
                style={isActive
                  ? { background: 'rgba(0,200,140,0.14)', border: '1px solid rgba(0,200,140,0.45)', color: '#5FE3B0' }
                  : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}
              >
                <span aria-hidden>{paceEmoji(pace)}</span>{paceLabel(pace, language)}
              </button>
            );
          })}
        </div>

        {/* 언어·정렬 필터 (3번째 행) */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2">
          <Languages className="w-3.5 h-3.5 text-white/55" />
          {([
            { key: 'en' as DriverLanguage, label: { ko: '영어 기사', en: 'English driver',  ja: '英語ドライバー',  zh: '英语司机' } },
            { key: 'ja' as DriverLanguage, label: { ko: '일본어 기사', en: 'Japanese driver', ja: '日本語ドライバー', zh: '日语司机' } },
            { key: 'zh' as DriverLanguage, label: { ko: '중국어 기사', en: 'Chinese driver',  ja: '中国語ドライバー', zh: '中文司机' } },
          ]).map(({ key, label }) => {
            const isActive = activeLangs.has(key);
            return (
              <button
                key={key}
                onClick={() => toggleLang(key)}
                className="tour-chip text-[10.5px] sm:text-[11px] font-semibold px-2.5 sm:px-3 py-1.5 min-h-[30px] rounded-full"
                style={
                  isActive
                    ? { background: 'rgba(140,200,255,0.15)', border: '1px solid rgba(140,200,255,0.45)', color: '#A0CBFF' }
                    : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }
                }
                title={label[language] || label.en}
              >
                {label[language] || label.en}
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-white/55" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="text-[11px] font-semibold px-2.5 sm:px-3 py-1.5 rounded-full cursor-pointer focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.65)' }}
            >
              <option value="default">{language === 'ko' ? '추천순' : language === 'ja' ? 'おすすめ順' : language === 'zh' ? '推荐排序' : 'Recommended'}</option>
              <option value="price-asc">{language === 'ko' ? '가격 낮은순' : language === 'ja' ? '価格安い順' : language === 'zh' ? '价格升序' : 'Price ↑'}</option>
              <option value="price-desc">{language === 'ko' ? '가격 높은순' : language === 'ja' ? '価格高い順' : language === 'zh' ? '价格降序' : 'Price ↓'}</option>
            </select>
          </div>
        </div>
        </div>
      </div>

      {/* ── 투어 카드 리스트 ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mb-8 sm:mb-10">
        {visibleTours.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div
              className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(182,104,252,0.08)', border: '1px solid rgba(182,104,252,0.15)' }}
            >
              <Package className="w-7 h-7" style={{ color: 'rgba(182,104,252,0.5)' }} />
            </div>
            <p className="text-[14px] text-white/55">{searchQuery.trim() ? tl.noSearchResults : tl.noResults}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
            {visibleTours.map(tour => (
              <TourCard key={tour.id} tour={tour} language={language} />
            ))}
          </div>
        )}
      </section>

      {/* ── 맞춤 투어 문의 배너 — 클릭 시 견적 문의 모달 (결제 없음) ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-2 mb-3">
        <div
          className="flex items-center gap-3 px-4 py-3.5 sm:px-5 sm:py-4 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(182,104,252,0.10), rgba(255,107,157,0.07))',
            border: '1px solid rgba(182,104,252,0.18)',
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            <Package className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-white">{tl.inquireTitle}</p>
            <p className="text-[11px] text-white/55 mt-0.5">
              {tl.inquireSub}
              {' · '}
              <Link to="/charter" className="underline underline-offset-2 text-white/65 hover:text-white/85">
                {tl.charterLink}
              </Link>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              trackEvent('tour_custom_inquiry_open', { region: activeRegion });
              setInquireOpen(true);
            }}
            className="flex items-center gap-1 text-[12px] font-bold px-3.5 py-1.5 rounded-full shrink-0"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)', color: '#fff' }}
          >
            {tl.inquireBtn}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Trip.com 숙소 비교 소형 CTA — 맞춤투어 배너보다 약한 톤, 외부 새 창 ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-6">
        {/* 노출 계측 (2026-08-03) — 기존 행 div 를 AffiliateCard 로 **교체**(DOM 증가 0).
            `<a>` 만 감싸면 `shrink-0` 이 래퍼로 넘어가지 않아 좁은 폭에서 버튼이 찌그러진다.
            한 줄 배너라 "행이 반 이상 보임" = "버튼이 반 이상 보임" 이므로 노출 정의도 정확하다. */}
        <AffiliateCard
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2.5 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
          payload={{ product: 'hotel', placement: 'tours_page_bottom', language, city: hotelCityKey }}
        >
          <p className="text-[11px] text-white/50 min-w-0">{tl.hotelCtaText}</p>
          <a
            href={hotelSearchUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            title={tl.hotelCtaNew}
            aria-label={`${tl.hotelCtaBtn} — ${tl.hotelCtaNew}`}
            onClick={() => trackAffiliateClick({
              product: 'hotel', placement: 'tours_page_bottom', language, city: hotelCityKey,
            })}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(0,115,230,0.10)', border: '1px solid rgba(0,115,230,0.30)', color: '#4D9FFF' }}
          >
            {tl.hotelCtaBtn}
            <ExternalLink className="w-3 h-3" />
          </a>
        </AffiliateCard>
      </div>

      {/* ── 맞춤형 투어 문의 모달 ── */}
      <TourInquireModal
        open={inquireOpen}
        onClose={() => setInquireOpen(false)}
        language={language}
        defaultRegion={inquireDefaultRegion}
      />
    </div>
  );
}
