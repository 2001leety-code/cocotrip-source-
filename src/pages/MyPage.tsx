/**
 * MyPage — 마이페이지 (등급/포인트/쿠폰/위시리스트/일정)
 * 로그인 필수, AuthRequired 래핑
 */
import { useState, useEffect } from 'react';
import {
  Crown, Coins, Gift, Heart, Calendar, Clock, Star,
  ArrowLeft, TrendingUp, ChevronRight, Copy, Check,
  Map as MapIcon, FileText, History, Globe, Ticket, Timer, CloudSun, Sparkles,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLoyalty, type Coupon, type LoyaltyInfo, type PointLog, type TierType } from '@/hooks/useLoyalty';
import { useWishlist, type WishlistItem } from '@/hooks/useWishlist';
import { slugForTourId } from '@/data/tours';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { MyBookingsTab } from '@/components/MyBookingsTab';
import { MyCoursesTab } from '@/components/MyCoursesTab';
import { EcLoading, EcEmpty, EcError } from '@/components/ui/states';
import '@/styles/editorial-mypage.css';

// '내 코스' 탭 라벨 — 컴포넌트 로컬 4-lang (글로벌 locale JSON 무접촉)
const COURSES_TAB_LABEL: Record<string, string> = { ko: '내 코스', en: 'My Courses', ja: 'マイコース', zh: '我的行程' };
import { haptic } from '@/lib/haptic';
import { Package } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { wttrLangParam, pickWeatherDesc, pickWeatherIcon } from '@/lib/weatherDesc';
import { describePointLog } from '@/lib/pointLogText';
import { fillPrice } from '@/lib/aiPlannerPrice';

const TIER_EMOJI: Record<TierType, string> = {
  Bronze: '🥉', Silver: '🥈', Gold: '🥇', Platinum: '💎',
};

// 🔧 2026-07-18: 'Free cancellation 48h/72h' 티어혜택 문구 제거 — PR#1116 에서 취소정책이
//   24h 바이너리(등급 무관)로 통일돼 서버가 적용하지 않는 혜택을 고객에게 표기하던 회귀 잔재.
// 🔴 2026-08-11: 시즌 할인쿠폰·차량 우선배정·메신저 우대응대·라운지 이용 등 서버가 실제로
//   지급하지 않는 등급 혜택을 표기하던 회귀 재발 (번역 파일 mypage.tierBenefitList 경유). 이번엔
//   번역 파일 내용과 무관하게 api/_shared/loyalty-policy.js 의 적립률만 보여주도록 고정한다
//   (api/·src/ 교차 import 금지 관례라 값은 미러링 — tests/unit 가드로 drift 방지).
const TIER_EARN_PCT: Record<TierType, string> = {
  Bronze: '1%', Silver: '1.5%', Gold: '2%', Platinum: '3%',
};

function tierBenefits(language: string, t: TierType): string[] {
  const pct = TIER_EARN_PCT[t];
  const label =
    language === 'ko' ? `Trip Coins ${pct} 적립` :
    language === 'ja' ? `Trip Coins ${pct} 還元` :
    language === 'zh' ? `Trip Coins 返 ${pct}` :
    `${pct} Trip Coins earn`;
  return [label];
}

// Itinerary 탭 제거 (2026-04-29) — `useItinerary().createItinerary` 호출 UI가
// 어디에도 없어 사용자가 일정을 만들 수 없는 상태였음. 백엔드 hook은 유지하되
// 빈 탭은 노출하지 않음.
type Tab = 'overview' | 'bookings' | 'courses' | 'coupons' | 'wishlist' | 'reviews' | 'history';

type MyPageFixture = 'normal' | 'loading' | 'empty' | 'review-error';

interface MyReview {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  rating: number;
  text: string;
  targetType: string;
  targetId: string;
  createdAt: number;
}

const VALID_TABS: Tab[] = ['overview', 'bookings', 'courses', 'coupons', 'wishlist', 'reviews', 'history'];
const VALID_FIXTURES: MyPageFixture[] = ['normal', 'loading', 'empty', 'review-error'];

const FIXTURE_COPY = {
  ko: {
    nextTrip: '골목과 궁궐 여행', recentPlan: '해안 여행 일정', review: '동선과 준비 안내가 한눈에 들어왔어요.', coupon: '투어 5% 할인 쿠폰', weatherCity: '한국', weatherDesc: '맑음',
  },
  en: {
    nextTrip: 'Lanes and palaces', recentPlan: 'Coastal itinerary', review: 'The route and preparation notes were easy to follow.', coupon: '5% tour coupon', weatherCity: 'Korea', weatherDesc: 'Clear',
  },
  ja: {
    nextTrip: '路地と宮殿の旅', recentPlan: '海辺の旅程', review: '移動ルートと準備案内が分かりやすかったです。', coupon: 'ツアー5%割引クーポン', weatherCity: '韓国', weatherDesc: '晴れ',
  },
  zh: {
    nextTrip: '巷弄与宫殿之旅', recentPlan: '海岸旅行日程', review: '路线和准备说明一目了然。', coupon: '旅游商品 5% 优惠券', weatherCity: '韩国', weatherDesc: '晴朗',
  },
} as const;

const REVIEW_COPY = {
  ko: { title: '내 리뷰', count: '{n}개', delete: '삭제', confirm: '이 리뷰를 삭제할까요?', view: '일정 보기', error: '리뷰를 불러오지 못했어요.', retry: '다시 시도' },
  en: { title: 'My reviews', count: '{n} reviews', delete: 'Delete', confirm: 'Delete this review?', view: 'View plan', error: 'We could not load your reviews.', retry: 'Try again' },
  ja: { title: 'マイレビュー', count: '{n}件', delete: '削除', confirm: 'このレビューを削除しますか？', view: 'プランを見る', error: 'レビューを読み込めませんでした。', retry: '再試行' },
  zh: { title: '我的评价', count: '{n}条', delete: '删除', confirm: '要删除这条评价吗？', view: '查看行程', error: '无法加载评价。', retry: '重试' },
} as const;

const MYPAGE_UI_COPY = {
  ko: { tabsLabel: '마이페이지 메뉴', loading: '계정 정보를 불러오는 중', loadingReviews: '리뷰를 불러오는 중', balance: '보유', offCoupon: '할인 쿠폰', redeeming: '교환 중', expires: '만료일', copyCode: '쿠폰 코드 복사', fixtureBoundaryTitle: '읽기 전용 미리보기', fixtureBoundaryBody: '실제 예약·코스 정보는 불러오지 않습니다.' },
  en: { tabsLabel: 'My page sections', loading: 'Loading your account', loadingReviews: 'Loading your reviews', balance: 'Balance', offCoupon: 'OFF coupon', redeeming: 'Redeeming', expires: 'Expires', copyCode: 'Copy coupon code', fixtureBoundaryTitle: 'Read-only preview', fixtureBoundaryBody: 'Live booking and course data is not loaded.' },
  ja: { tabsLabel: 'マイページのメニュー', loading: 'アカウント情報を読み込み中', loadingReviews: 'レビューを読み込み中', balance: '残高', offCoupon: '割引クーポン', redeeming: '交換中', expires: '有効期限', copyCode: 'クーポンコードをコピー', fixtureBoundaryTitle: '読み取り専用プレビュー', fixtureBoundaryBody: '実際の予約・コース情報は読み込みません。' },
  zh: { tabsLabel: '我的页面菜单', loading: '正在加载账户信息', loadingReviews: '正在加载评价', balance: '余额', offCoupon: '优惠券', redeeming: '兑换中', expires: '有效期至', copyCode: '复制优惠券代码', fixtureBoundaryTitle: '只读预览', fixtureBoundaryBody: '不会加载真实的预订和课程数据。' },
} as const;

const DATE_LOCALE = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' } as const;

const FIXTURE_USER = {
  uid: 'mypage-editorial-fixture',
  displayName: 'Coco Traveler',
  email: 'traveler@example.com',
  photoURL: null,
};

const FIXTURE_LOYALTY: LoyaltyInfo = {
  tier: 'Gold',
  tripCoins: 2450,
  totalSpentUSD: 840,
  bookingCount: 3,
  earnRate: 0.02,
};

const FIXTURE_COUPONS: Coupon[] = [{
  id: 'fixture-coupon',
  code: 'COCO-FIXTURE',
  type: 'percent',
  value: 5,
  currency: 'USD',
  label: '5% tour coupon',
  minOrderUSD: 0,
  isUsed: false,
  expiresAt: Date.UTC(2030, 11, 31),
  createdAt: Date.UTC(2026, 7, 15),
  productScope: 'tour-package',
}];

const FIXTURE_HISTORY: PointLog[] = [{
  id: 'fixture-point-log',
  type: 'earn',
  amount: 50,
  balance: 2450,
  description: 'review_reward',
  createdAt: Date.UTC(2026, 7, 14),
}];

const FIXTURE_WISHLIST: WishlistItem[] = [{
  id: 'tour-editorial-preview',
  productType: 'tour',
  name: 'Editorial tour preview',
  priceUSD: 231,
  href: '/tours',
  addedAt: Date.UTC(2026, 7, 13),
}];

function parseFixture(value: string | null): MyPageFixture | null {
  return value && VALID_FIXTURES.includes(value as MyPageFixture) ? value as MyPageFixture : null;
}

export default function MyPage() {
  const { language, t, changeLanguage } = useLanguage();
  const mp = ((t as unknown) as { mypage?: Record<string, string> }).mypage || {};
  const languageKey = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as keyof typeof MYPAGE_UI_COPY;
  const uiCopy = MYPAGE_UI_COPY[languageKey];
  const { user: realUser } = useAuth();
  const loyaltyState = useLoyalty();
  const wishlistState = useWishlist();
  // Deep-link 지원: ?tab=wishlist 등으로 특정 탭 직진입 (햄버거 메뉴와 sync).
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = import.meta.env.DEV ? parseFixture(searchParams.get('__fixture')) : null;
  const fixtureCopy = FIXTURE_COPY[languageKey];
  const fixtureHasData = fixture === 'normal' || fixture === 'review-error';
  const user = fixture ? FIXTURE_USER : realUser;
  const loyalty = fixture
    ? (fixtureHasData ? FIXTURE_LOYALTY : { ...FIXTURE_LOYALTY, tier: 'Bronze' as TierType, tripCoins: 0, totalSpentUSD: 0, bookingCount: 0, earnRate: 0.01 })
    : loyaltyState.loyalty;
  const coupons = fixture ? (fixtureHasData ? FIXTURE_COUPONS : []) : loyaltyState.coupons;
  const activeCoupons = fixture ? (fixtureHasData ? FIXTURE_COUPONS : []) : loyaltyState.activeCoupons;
  const pointHistory = fixture ? (fixtureHasData ? FIXTURE_HISTORY : []) : loyaltyState.pointHistory;
  const wishlistItems = fixture
    ? (fixtureHasData ? FIXTURE_WISHLIST.map(item => ({ ...item, name: fixtureCopy.recentPlan })) : [])
    : wishlistState.items;
  const loading = fixture === 'loading' || (!fixture && loyaltyState.loading);
  const { coinsToUSD } = loyaltyState;
  const initialTab = (() => {
    const q = searchParams.get('tab') as Tab | null;
    return q && VALID_TABS.includes(q) ? q : 'overview';
  })();
  const [tab, setTabState] = useState<Tab>(initialTab);
  // 탭 변경 시 URL ?tab= 동기화 (브라우저 뒤로가기/공유 가능)
  const setTab = (next: Tab) => {
    setTabState(next);
    const sp = new URLSearchParams(searchParams);
    if (next === 'overview') sp.delete('tab'); else sp.set('tab', next);
    setSearchParams(sp, { replace: true });
  };
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<number | null>(null);
  const [couponClock] = useState(Date.now);
  // UIUX 가이드 P8 쿠폰 지갑 — Available/Used/Expired 탭 필터 (2026-07-13)
  const [walletFilter, setWalletFilter] = useState<'available' | 'used' | 'expired'>('available');

  // Travel-dashboard data — D-day to next trip + recent plans + weather.
  // Mirrors what MobileHome does so the dashboard reflects the same state
  // without a re-prompt. All effects are no-ops when user isn't signed in.
  const [nextTrip, setNextTrip] = useState<{ title: string; dday: number; date: string } | null>(null);
  const [recentPlans, setRecentPlans] = useState<{ id: string; title: string; date: string; cover?: string }[]>([]);
  const [weather, setWeather] = useState<{ temp: string; desc: string; icon: string; city: string } | null>(null);

  useEffect(() => {
    if (fixture || !user) return;
    (async () => {
      try {
        const q = query(collection(db, 'plans'), where('uid', '==', user.uid));
        const snap = await getDocs(q);
        const now = Date.now();
        let nearest: { title: string; dday: number; date: string } | null = null;
        const plans: { id: string; title: string; date: string; cover?: string; sortKey: number }[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const sd = data.input?.startDate || '';
          const title = data.itinerary?.tour_title || 'Korea Trip';
          const cover = data.itinerary?.cover_image || data.itinerary?.days?.[0]?.stops?.[0]?.photo_ref;
          plans.push({ id: d.id, title, date: sd, cover, sortKey: data.createdAt?.toMillis?.() || 0 });
          if (sd) {
            const diff = Math.ceil((new Date(sd).getTime() - now) / 86400000);
            if (diff >= 0 && (!nearest || diff < nearest.dday)) {
              nearest = { title, dday: diff, date: sd };
            }
          }
        });
        plans.sort((a, b) => b.sortKey - a.sortKey);
        setRecentPlans(plans.slice(0, 3).map(({ id, title, date, cover }) => ({ id, title, date, cover })));
        setNextTrip(nearest);
      } catch {
        /* silent */
      }
    })();
  }, [fixture, user]);

  // 회원가입 직후 웰컴 모달은 App.tsx GlobalWidgets 의 OnboardingCouponModal 이
  // sessionStorage 플래그를 감지해 전역 노출. MyPage 에서 중복 토스트 제거 (2026-05-07).
  // toast / mp.welcomeCoupons* i18n 키는 하위 호환 보존용으로 남겨둠.

  useEffect(() => {
    if (fixture) return;
    let city = 'Seoul';
    try {
      const saved = localStorage.getItem('cocotrip_last_region');
      if (saved) city = saved;
    } catch { /* silent */ }
    (async () => {
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1${wttrLangParam(language)}`);
        const data = await res.json();
        const cur = data.current_condition?.[0];
        if (cur) setWeather({
          temp: cur.temp_C + '°C',
          desc: pickWeatherDesc(cur, language),
          // 아이콘과 설명을 같은 데이터에서 결정한다(기온으로 고르면 이슬비에 해가 뜬다).
          icon: pickWeatherIcon(cur),
          city,
        });
      } catch { /* silent */ }
    })();
  }, [fixture, language]);

  const displayedNextTrip = fixtureHasData
    ? { title: fixtureCopy.nextTrip, dday: 12, date: '2026-09-01' }
    : nextTrip;
  const displayedRecentPlans = fixtureHasData
    ? [{ id: 'fixture-plan', title: fixtureCopy.recentPlan, date: '2026-08-08' }]
    : recentPlans;
  const displayedWeather = fixtureHasData
    ? { temp: '24°C', desc: fixtureCopy.weatherDesc, icon: '☀️', city: fixtureCopy.weatherCity }
    : weather;

  usePageMeta({
    title: t.pageMeta?.myPage?.title || 'My Page — Membership & Rewards',
    description: t.pageMeta?.myPage?.description || 'Manage your CocoTrip membership, trip coins, coupons, wishlists and travel itineraries.',
  });

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleRedeem = async (coins: number) => {
    if (fixture) return;
    if (!user?.uid) return;
    if ((loyalty?.tripCoins || 0) < coins) return;
    if (!confirm(`Redeem ${coins} coins for a coupon?`)) return;

    setRedeeming(coins);
    try {
      // 서버가 토큰(auth.uid)으로 본인 확인 — body.userId 제거 (loyalty IDOR fix).
      const res = await authFetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem-coupon', coins }),
      });
      const data = await res.json();
      if (data.success) {
        navigator.clipboard?.writeText(data.code).catch(() => {});
        setCopiedCode(data.code);
        setTimeout(() => setCopiedCode(null), 5000);
      }
    } catch {
      // error handled silently
    } finally {
      setRedeeming(null);
    }
  };

  const tier = loyalty?.tier || 'Bronze';

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: mp.tabOverview || 'Overview', icon: TrendingUp },
    { id: 'bookings', label: mp.tabBookings || 'My Bookings', icon: Package },
    { id: 'courses', label: COURSES_TAB_LABEL[language as 'ko'|'en'|'ja'|'zh'] || COURSES_TAB_LABEL.en, icon: MapIcon },
    { id: 'coupons', label: (mp.tabCoupons || 'Coupons ({n})').replace('{n}', String(activeCoupons.length)), icon: Gift },
    { id: 'wishlist', label: (mp.tabWishlist || 'Wishlist ({n})').replace('{n}', String(wishlistItems.length)), icon: Heart },
    { id: 'reviews', label: mp.tabReviews || 'Reviews', icon: Star },
    { id: 'history', label: mp.tabPoints || 'Points', icon: Clock },
  ];

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    setTab(nextTab.id);
    document.getElementById(`mypage-tab-${nextTab.id}`)?.focus();
  };

  return (
    <div className={`mypage-editorial ec-root${fixture ? ' is-fixture' : ''}`} data-testid="mypage-editorial-shell">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <main className="mypage-editorial-main">
        {/* 뒤로 */}
        <Link to="/" className="mypage-editorial-back">
          <ArrowLeft size={16} /> {mp.home || 'Home'}
        </Link>

        {loading ? (
          <div data-testid="mypage-loading" aria-busy="true">
            <EcLoading label={uiCopy.loading} lines={4} />
          </div>
        ) : (
          <>
            {/* 프로필 + 등급 카드 */}
            <div className="mypage-editorial-profile" data-tier={tier.toLowerCase()}>
              <div className="mypage-editorial-avatar">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || 'Profile'} />
                ) : (
                  <span aria-hidden>{TIER_EMOJI[tier]}</span>
                )}
              </div>
              <div className="min-w-0">
                <h1 className="ec-h3 mypage-editorial-name">{user?.displayName || mp.traveler || 'Traveler'}</h1>
                <p className="mypage-editorial-email">{user?.email}</p>
                <div className="mypage-editorial-badges">
                  <span className="mypage-editorial-tier">
                    {TIER_EMOJI[tier]} {tier}
                  </span>
                  <span className="mypage-editorial-coins">
                    <Coins size={14} aria-hidden />
                    <strong>{(loyalty?.tripCoins || 0).toLocaleString()}</strong>
                    {mp.coinsLabel || 'coins'}
                  </span>
                </div>
              </div>

              {/* 등급 혜택 */}
              <div className="mypage-editorial-benefits">
                <p className="mypage-editorial-benefits-label">
                  {(mp.tierBenefits || '{tier} Benefits').replace('{tier}', tier)}
                </p>
                <div className="mypage-editorial-benefit-list">
                  {tierBenefits(language, tier).map((b, i) => (
                    <span key={i} className="mypage-editorial-benefit-chip">
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 탭 네비 */}
            <div className="mypage-editorial-tabs" role="tablist" aria-label={uiCopy.tabsLabel}>
              {TABS.map(({ id, label, icon: Icon }, index) => (
                <button
                  key={id}
                  role="tab"
                  id={`mypage-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`mypage-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={`mypage-editorial-tab${tab === id ? ' is-active' : ''}`}
                >
                  <Icon aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── 탭: Overview — Travel dashboard + nav (Option D, 2026-04-29) ──
            Replaces the previous 4-stat grid with: D-day card → compact stats
            → recent plans → category nav. The nav mirrors the hamburger menu
            so users can stay on /mypage after deep-linking. */}
        {!loading && tab === 'overview' && (
          <div className="space-y-6" id="mypage-panel-overview" role="tabpanel" aria-labelledby="mypage-tab-overview">
            {/* Next-trip D-day + weather */}
            {displayedNextTrip && (
              <Link to="/my-plans" onClick={() => haptic('tap')} className="mypage-editorial-nexttrip">
                <div className="mypage-editorial-nexttrip-row">
                  <div className="mypage-editorial-dday">
                    <Timer aria-hidden />
                    <span>{displayedNextTrip.dday === 0 ? 'D-0' : `D-${displayedNextTrip.dday}`}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="mypage-editorial-nexttrip-eyebrow">{mp.dashNextTrip || 'Next Trip'}</p>
                    <p className="mypage-editorial-nexttrip-title">{displayedNextTrip.title}</p>
                    <p className="mypage-editorial-nexttrip-date">{displayedNextTrip.date}</p>
                  </div>
                  <ChevronRight className="mypage-editorial-icon-faint w-4 h-4 shrink-0" />
                </div>
                {displayedWeather && (
                  <div className="mypage-editorial-weather">
                    <CloudSun className="w-4 h-4 shrink-0" aria-hidden />
                    <span>{displayedWeather.city}</span>
                    <strong>{displayedWeather.temp}</strong>
                    <span>{displayedWeather.icon}</span>
                    <span className="truncate">{displayedWeather.desc}</span>
                  </div>
                )}
              </Link>
            )}

            {/* Compact 2×2 stats */}
            <div className="mypage-editorial-stats">
              <StatCard label={mp.statTotalSpent || 'Total Spent'} value={`$${(loyalty?.totalSpentUSD || 0).toFixed(0)}`} icon={TrendingUp} />
              {/* 🔴 이 값은 **원장 누적 예약 수**다. 아래 "내 예약" 탭 목록 개수와 다를 수 있다.
                  목록은 현재 계정 이메일로 조회한 것이고, 누적은 과거 보정·다른 이메일 결제까지
                  포함한 원장값이라 숫자가 어긋나면 손님이 "예약이 사라졌다" 고 읽는다. */}
              <StatCard label={mp.statBookings || 'Bookings'} value={String(loyalty?.bookingCount || 0)}
                sub={mp.statBookingsNote || 'Lifetime total'} icon={Calendar} />
              <StatCard label={mp.statTripCoins || 'Trip Coins'} value={(loyalty?.tripCoins || 0).toLocaleString()} sub={`≈ $${coinsToUSD(loyalty?.tripCoins || 0)}`} icon={Coins} />
              <StatCard label={mp.statEarnRate || 'Earn Rate'} value={`${((loyalty?.earnRate || 0.01) * 100).toFixed(1)}%`} icon={Crown} />
            </div>

            {/* Recent plans — horizontal scroll, 3 most recent */}
            {displayedRecentPlans.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="mypage-editorial-section-label is-flush">{mp.dashRecentPlans || 'Recent Plans'}</p>
                  <Link to="/my-plans" onClick={() => haptic('tap')} className="mypage-editorial-inline-link">
                    {mp.dashViewAll || 'View all'}
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="mypage-editorial-plans">
                  {displayedRecentPlans.map((p) => (
                    <Link key={p.id} to={`/my-plans/${p.id}`} onClick={() => haptic('tap')} className="mypage-editorial-plan-card">
                      <div className="mypage-editorial-plan-cover">
                        {p.cover && p.cover.startsWith('http') ? (
                          <img src={p.cover} alt={p.title} loading="lazy" />
                        ) : (
                          <Sparkles className="mypage-editorial-icon-faint w-6 h-6" />
                        )}
                      </div>
                      <div className="mypage-editorial-plan-body">
                        <p className="mypage-editorial-plan-title">{p.title}</p>
                        <p className="mypage-editorial-plan-date">{p.date || '—'}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Category nav — mirrors hamburger so users don't need to re-open it */}
            <div>
              <p className="mypage-editorial-section-label is-flush">{mp.dashExplore || 'Explore'}</p>
              <div className="mypage-editorial-nav">
                {[
                  { to: '/charter', icon: MapIcon, label: t.nav.charter || 'Charter' },
                  { to: '/tours', icon: Package, label: t.nav.tours || 'Tours' },
                  { to: '/planner', icon: Sparkles, label: t.nav.planner || 'Trip Planner' },
                  { to: '/about', icon: Globe, label: t.nav.about || 'About' },
                ].map(({ to, icon: Icon, label }) => (
                  <Link key={to} to={to} onClick={() => haptic('tap')} className="mypage-editorial-nav-item">
                    <Icon aria-hidden />
                    <span className="mypage-editorial-nav-item-label">{label}</span>
                    <ChevronRight className="mypage-editorial-nav-item-chevron" />
                  </Link>
                ))}
              </div>

              <p className="mypage-editorial-section-label">{mp.dashAccount || 'My Account'}</p>
              <div className="mypage-editorial-nav">
                {(() => {
                  type AccountItem =
                    | { kind: 'link'; to: string; icon: React.ElementType; label: string }
                    | { kind: 'tab'; tab: Tab; icon: React.ElementType; label: string };
                  const items: AccountItem[] = [
                    { kind: 'link', to: '/my-plans', icon: FileText, label: t.nav.myPlans || 'My Plans' },
                    { kind: 'tab', tab: 'wishlist', icon: Heart, label: t.nav.wishlist || 'Wishlist' },
                    { kind: 'tab', tab: 'bookings', icon: History, label: t.nav.bookingHistory || 'Booking History' },
                    { kind: 'tab', tab: 'coupons', icon: Ticket, label: t.nav.coupons || 'Coupons' },
                    { kind: 'tab', tab: 'reviews', icon: Star, label: t.nav.reviews || 'Reviews' },
                  ];
                  return items.map((it) => {
                    const Icon = it.icon;
                    if (it.kind === 'tab') {
                      return (
                        <button key={it.tab} onClick={() => { haptic('tap'); setTab(it.tab); }} className="mypage-editorial-nav-item">
                          <Icon aria-hidden />
                          <span className="mypage-editorial-nav-item-label">{it.label}</span>
                          <ChevronRight className="mypage-editorial-nav-item-chevron" />
                        </button>
                      );
                    }
                    return (
                      <Link key={it.to} to={it.to} onClick={() => haptic('tap')} className="mypage-editorial-nav-item">
                        <Icon aria-hidden />
                        <span className="mypage-editorial-nav-item-label">{it.label}</span>
                        <ChevronRight className="mypage-editorial-nav-item-chevron" />
                      </Link>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── 탭: My Bookings ── */}
        {!loading && tab === 'bookings' && (
          <div id="mypage-panel-bookings" role="tabpanel" aria-labelledby="mypage-tab-bookings">
            {fixture ? (
              <EcEmpty title={uiCopy.fixtureBoundaryTitle} body={uiCopy.fixtureBoundaryBody} />
            ) : (
              <div className="mypage-editorial-legacy-panel">
                <MyBookingsTab userEmail={user?.email || ''} tier={tier}
                  language={(['ko','en','ja','zh'].includes(language) ? language : 'en') as 'ko'|'en'|'ja'|'zh'} />
              </div>
            )}
          </div>
        )}

        {/* ── 탭: My Courses ── */}
        {!loading && tab === 'courses' && (
          <div id="mypage-panel-courses" role="tabpanel" aria-labelledby="mypage-tab-courses">
            {fixture ? (
              <EcEmpty title={uiCopy.fixtureBoundaryTitle} body={uiCopy.fixtureBoundaryBody} />
            ) : (
              <div className="mypage-editorial-legacy-panel">
                <MyCoursesTab />
              </div>
            )}
          </div>
        )}

        {!loading && tab === 'coupons' && (
          <div className="space-y-6" id="mypage-panel-coupons" role="tabpanel" aria-labelledby="mypage-tab-coupons">
            {/* 교환 섹션 */}
            <div className="mypage-editorial-redeem">
              <h3 className="ec-h3 flex items-center gap-2">
                <Gift className="mypage-editorial-icon-brand w-4 h-4" aria-hidden />
                {mp.redeemTripCoins || 'Redeem Trip Coins'}
              </h3>
              <p className="mypage-editorial-redeem-balance">
                {uiCopy.balance}: <strong className="mypage-editorial-strong">{(loyalty?.tripCoins || 0).toLocaleString()}</strong> {mp.coinsLabel || 'coins'}
              </p>
              <div className="mypage-editorial-redeem-grid">
                {[
                  { coins: 500,  value: 5,  bonus: false },
                  { coins: 1000, value: 10, bonus: false },
                  { coins: 2000, value: 25, bonus: true  },
                ].map(redeemTier => {
                  const enabled = (loyalty?.tripCoins || 0) >= redeemTier.coins;
                  const busy = redeeming === redeemTier.coins;
                  return (
                    <button
                      key={redeemTier.coins}
                      onClick={() => handleRedeem(redeemTier.coins)}
                      disabled={!enabled || busy || Boolean(fixture)}
                      className="mypage-editorial-redeem-option"
                    >
                      {redeemTier.bonus && (
                        <span className="mypage-editorial-redeem-bonus">+25%</span>
                      )}
                      <div className="mypage-editorial-redeem-coins">{redeemTier.coins.toLocaleString()} {mp.coinsLabel || 'coins'}</div>
                      <div className="mypage-editorial-redeem-value">${redeemTier.value}</div>
                      <div className="mypage-editorial-redeem-coins">{uiCopy.offCoupon}</div>
                      {busy && <span className="sr-only">{uiCopy.redeeming}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="mypage-editorial-redeem-note">
                {mp.couponValid || 'Valid for 1 year. Enter code at checkout.'}
              </p>
            </div>

            {/* 쿠폰 지갑 탭 (UIUX P8) — Available/Used/Expired. 실쿠폰(useLoyalty)만, 가짜 수치 없음. */}
            {coupons.length > 0 && (() => {
              const now = couponClock;
              const counts = {
                available: coupons.filter((c) => !c.isUsed && c.expiresAt > now).length,
                used: coupons.filter((c) => c.isUsed).length,
                expired: coupons.filter((c) => !c.isUsed && c.expiresAt <= now).length,
              };
              const tabs: { key: 'available' | 'used' | 'expired'; label: string }[] = [
                { key: 'available', label: `${mp.walletAvailable || 'Available'} (${counts.available})` },
                { key: 'used', label: `${mp.walletUsed || 'Used'} (${counts.used})` },
                { key: 'expired', label: `${mp.walletExpired || 'Expired'} (${counts.expired})` },
              ];
              return (
                <div className="mypage-editorial-wallet-tabs">
                  {tabs.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setWalletFilter(key)}
                      className={`mypage-editorial-wallet-tab${walletFilter === key ? ' is-active' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* 쿠폰 리스트 (지갑 필터 적용) */}
            <div className="space-y-3">
              {(() => {
                if (coupons.length === 0) return null;
                const now = couponClock;
                const filtered = coupons.filter((c) => {
                  if (walletFilter === 'available') return !c.isUsed && c.expiresAt > now;
                  if (walletFilter === 'used') return c.isUsed;
                  return !c.isUsed && c.expiresAt <= now; // expired
                });
                if (filtered.length === 0) {
                  const emptyMsg = walletFilter === 'available'
                    ? (mp.walletEmptyAvailable || 'No available coupons.')
                    : walletFilter === 'used'
                      ? (mp.walletEmptyUsed || 'No used coupons yet.')
                      : (mp.walletEmptyExpired || 'No expired coupons.');
                  return (
                    <p className="mypage-editorial-empty-note">{emptyMsg}</p>
                  );
                }
                return filtered.map((c) => (
              <div key={c.id} className={`mypage-editorial-coupon${c.isUsed || c.expiresAt < couponClock ? ' is-inactive' : ''}`}>
                <div className="mypage-editorial-coupon-row">
                  <div>
                    <p className="mypage-editorial-coupon-label">{fixture ? fixtureCopy.coupon : c.label}</p>
                    <p className="mypage-editorial-coupon-expiry">
                      {uiCopy.expires}: {new Date(c.expiresAt).toLocaleDateString(DATE_LOCALE[languageKey])}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="mypage-editorial-coupon-value">
                      {c.type === 'percent' ? `${c.value}%` : `$${c.value}`}
                    </span>
                    {!c.isUsed && c.expiresAt > couponClock && (
                      <button onClick={() => handleCopy(c.code)} className="mypage-editorial-coupon-copy" aria-label={uiCopy.copyCode}>
                        {copiedCode === c.code
                          ? <Check size={14} className="mypage-editorial-icon-success" />
                          : <Copy size={14} />
                        }
                      </button>
                    )}
                  </div>
                </div>
                <code className="mypage-editorial-coupon-code">{c.code}</code>
                {c.isUsed && <span className="mypage-editorial-coupon-used">{mp.walletUsed || 'Used'}</span>}
                {/* AI 무료쿠폰(ai-plan)은 쿠폰함 경유로 사용 (2026-06-28): "사용하기" →
                    /planner?coupon=CODE. PurchaseSection 이 URL 코드를 검증 후 0원 적용. */}
                {c.productScope === 'ai-plan' && !c.isUsed && c.expiresAt > couponClock && (
                  <Link to={`/planner?coupon=${encodeURIComponent(c.code)}`} onClick={() => haptic('tap')} className="mypage-editorial-coupon-cta">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden />
                    {mp.useAiCoupon || '사용하기'}
                  </Link>
                )}
              </div>
                ));
              })()}
              {coupons.length === 0 && (
                /* AI-planner ad — same copy as PayPal checkout picker. */
                <Link to="/planner" onClick={() => haptic('tap')} className="mypage-editorial-adcard">
                  <div className="mypage-editorial-adcard-row">
                    <div className="mypage-editorial-adcard-mark">
                      <Sparkles className="w-4 h-4" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="mypage-editorial-adcard-title">{mp.couponAdTitle || '1 AI plan = 1× 5% coupon'}</p>
                      <p className="mypage-editorial-adcard-body">{fillPrice(mp.couponAdBody || 'Book a ₩124,000 charter saves more than the planner ({price}).', language)}</p>
                      <span className="mypage-editorial-adcard-link">
                        {mp.couponAdCta || 'Make AI plan'}
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ── 탭: Wishlist ── */}
        {!loading && tab === 'wishlist' && (
          <div id="mypage-panel-wishlist" role="tabpanel" aria-labelledby="mypage-tab-wishlist">
            {wishlistItems.length === 0 ? (
              <EcEmpty title={mp.wlEmptyTitle || 'No wishlisted items'} body={mp.wlEmptySub || 'Tap the heart on any tour to save it here'} />
            ) : (
              <div className="mypage-editorial-wishlist-grid">
                {wishlistItems.map(item => {
                  // 상세 링크: 저장된 href 우선(2026-07-05) → 없으면 투어 id→slug 매핑 폴백
                  // (기존 id-only 데이터 호환). id.replace('tour-','') 억지변환은 slug 와 달라 깨졌음.
                  const href = item.href
                    || (item.productType === 'tour'
                      ? (slugForTourId(item.id) ? `/tours/${slugForTourId(item.id)}` : '/tours')
                      : item.productType === 'charter' ? '/charter' : '/planner');
                  return (
                    <Link key={item.id} to={href} onClick={() => haptic('tap')} className="mypage-editorial-wishlist-card">
                      <div className="mypage-editorial-wishlist-cover">
                        {item.thumbnailUrl ? (
                          <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
                        ) : (
                          <Heart className="mypage-editorial-icon-faint w-6 h-6" aria-hidden />
                        )}
                      </div>
                      <div className="mypage-editorial-wishlist-body">
                        <p className="mypage-editorial-wishlist-name">{item.name}</p>
                        <div className="mypage-editorial-wishlist-meta">
                          <span className="mypage-editorial-wishlist-type">{item.productType}</span>
                          {item.priceUSD ? (
                            <span className="mypage-editorial-wishlist-price">${item.priceUSD}</span>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 탭: My Reviews ── */}
        {!loading && tab === 'reviews' && (
          <div id="mypage-panel-reviews" role="tabpanel" aria-labelledby="mypage-tab-reviews">
            <MyReviewsTab userId={user?.uid || ''} fixture={fixture} language={language} fixtureText={fixtureCopy.review} />
          </div>
        )}

        {/* ── 탭: Points History ── */}
        {!loading && tab === 'history' && (
          <div className="space-y-3" id="mypage-panel-history" role="tabpanel" aria-labelledby="mypage-tab-history">
            <div className="flex items-center justify-between mb-4">
              <h3 className="ec-h3">{mp.pointHistoryTitle || 'Point history'}</h3>
              <span className="mypage-editorial-balance">
                {uiCopy.balance}: <strong>{(loyalty?.tripCoins || 0).toLocaleString()}</strong>
              </span>
            </div>

            {pointHistory.length === 0 ? (
              <EcEmpty title={mp.pointEmpty || 'No point activity yet.'} body={mp.pointEmptySub || 'Share a plan to earn your first Trip Coins!'} />
            ) : (
              <div className="space-y-3">
                {pointHistory.map(log => (
                  <div key={log.id} className="mypage-editorial-log">
                    <div className="flex-1 min-w-0">
                      <p className="mypage-editorial-log-desc">{describePointLog(log.description, language)}</p>
                      <p className="mypage-editorial-log-date">
                        {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className={`mypage-editorial-log-amount ${log.type === 'earn' ? 'is-earn' : 'is-spend'}`}>
                      {log.type === 'earn' ? '+' : ''}{log.amount}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }: {
  label: string; value: string; sub?: string; icon: React.ElementType;
}) {
  return (
    <div className="mypage-editorial-stat">
      <div className="mypage-editorial-stat-label">
        <Icon size={14} aria-hidden />
        <p>{label}</p>
      </div>
      <p className="mypage-editorial-stat-value">{value}</p>
      {sub && <p className="mypage-editorial-stat-sub">{sub}</p>}
    </div>
  );
}

function MyReviewsTab({
  userId,
  fixture,
  language,
  fixtureText,
}: {
  userId: string;
  fixture: MyPageFixture | null;
  language: string;
  fixtureText: string;
}) {
  const { t } = useLanguage();
  const mp = ((t as unknown) as { mypage?: Record<string, string> }).mypage || {};
  const copy = REVIEW_COPY[(['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as keyof typeof REVIEW_COPY];
  const fixtureReviews: MyReview[] = fixture === 'normal' ? [{
    id: 'fixture-review',
    authorUid: 'mypage-editorial-fixture',
    authorName: 'Coco Traveler',
    rating: 5,
    text: fixtureText,
    targetType: 'plan',
    targetId: 'fixture-plan',
    createdAt: Date.UTC(2026, 7, 12),
  }] : [];
  const [reviews, setReviews] = useState<MyReview[]>(fixtureReviews);
  const [loading, setLoading] = useState(!fixture && Boolean(userId));
  const [error, setError] = useState(fixture === 'review-error');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (fixture || !userId) return;
    let active = true;
    authFetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'my-reviews' }),
    })
      .then(response => response.json())
      .then(data => {
        if (active) setReviews(data.reviews || []);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [fixture, reloadKey, userId]);

  const handleRetry = () => {
    setError(false);
    setLoading(true);
    setReloadKey(value => value + 1);
  };

  const handleDelete = async (reviewId: string) => {
    if (fixture) return;
    if (!confirm(copy.confirm)) return;
    try {
      // PR #418 IDOR fix: server uses verified auth.uid.
      await authFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', reviewId }),
      });
      setReviews(prev => prev.filter(r => r.id !== reviewId));
    } catch { /* silent */ }
  };

  if (loading) {
    return <EcLoading label={MYPAGE_UI_COPY[(['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as keyof typeof MYPAGE_UI_COPY].loadingReviews} lines={3} className="mypage-editorial-panel" />;
  }

  if (error) {
    return <EcError title={copy.error} retryLabel={copy.retry} onRetry={fixture ? undefined : handleRetry} />;
  }

  if (reviews.length === 0) {
    return <EcEmpty title={mp.noReviewsYet || 'No reviews yet'} body={mp.noReviewsSub || 'Review a trip to earn +50 Trip Coins'} />;
  }

  return (
    <div className="space-y-3">
      <div className="mypage-editorial-review-heading">
        <h3 className="ec-h3">{copy.title}</h3>
        <span>{language === 'en' && reviews.length === 1 ? '1 review' : copy.count.replace('{n}', String(reviews.length))}</span>
      </div>
      {reviews.map(r => (
        <article key={r.id} className="mypage-editorial-review">
          <div className="mypage-editorial-review-topline">
            <div className="mypage-editorial-review-meta">
              <div className="mypage-editorial-review-stars" aria-label={`${r.rating}/5`}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} size={14} className={i <= r.rating ? 'is-filled' : ''} aria-hidden />
                ))}
              </div>
              <span className="mypage-editorial-review-date">
                {new Date(r.createdAt).toLocaleDateString(DATE_LOCALE[(['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as keyof typeof DATE_LOCALE])}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(r.id)}
              disabled={Boolean(fixture)}
              className="mypage-editorial-review-delete"
            >
              {copy.delete}
            </button>
          </div>
          <p className="mypage-editorial-review-text">{r.text}</p>
          <Link
            to={`/my-plans/${r.targetId}`}
            className="mypage-editorial-review-link"
          >
            {copy.view} <ChevronRight size={12} />
          </Link>
        </article>
      ))}
    </div>
  );
}
