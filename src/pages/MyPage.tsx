/**
 * MyPage — 마이페이지 (등급/포인트/쿠폰/위시리스트/일정)
 * 로그인 필수, AuthRequired 래핑
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Crown, Coins, Gift, Heart, Calendar, Clock, Star,
  ArrowLeft, TrendingUp, ChevronRight, Copy, Check,
  Map as MapIcon, FileText, History, Globe, Ticket, Timer, CloudSun, Sparkles,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLoyalty, type TierType } from '@/hooks/useLoyalty';
import { useWishlist } from '@/hooks/useWishlist';
import { useItinerary } from '@/hooks/useItinerary';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { MyBookingsTab } from '@/components/MyBookingsTab';
import { haptic } from '@/lib/haptic';
import { Package } from 'lucide-react';

const TIER_COLORS: Record<TierType, { color: string; bg: string; border: string }> = {
  Bronze:   { color: '#CD7F32', bg: 'from-[#CD7F32]/15 to-[#8B4513]/10', border: 'border-[#CD7F32]/20' },
  Silver:   { color: '#C0C0C0', bg: 'from-[#C0C0C0]/15 to-[#808080]/10', border: 'border-[#C0C0C0]/20' },
  Gold:     { color: '#FFD700', bg: 'from-[#FFD700]/15 to-[#B8860B]/10', border: 'border-[#FFD700]/20' },
  Platinum: { color: '#E5E4E2', bg: 'from-[#7C5CFC]/20 to-[#7C5CFC]/15', border: 'border-[#7C5CFC]/25' },
};

const TIER_EMOJI: Record<TierType, string> = {
  Bronze: '🥉', Silver: '🥈', Gold: '🥇', Platinum: '💎',
};

const TIER_BENEFITS: Record<TierType, string[]> = {
  Bronze:   ['Basic 1% Trip Coins earn', 'Welcome 5% coupon'],
  Silver:   ['1.5% Trip Coins earn', '$5 season coupon', 'Priority support'],
  Gold:     ['2% Trip Coins earn', '$10 season coupon', 'Priority vehicle assignment', 'Free cancellation 48h'],
  Platinum: ['3% Trip Coins earn', '$20 season coupon', 'VIP KakaоTalk support', 'Free cancellation 72h', 'Airport lounge access'],
};

type Tab = 'overview' | 'bookings' | 'coupons' | 'wishlist' | 'itinerary' | 'reviews' | 'history';

export default function MyPage() {
  const { language, t, changeLanguage } = useLanguage();
  const mp = (t as { mypage?: Record<string, string> }).mypage || {};
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { loyalty, coupons, activeCoupons, pointHistory, coinsToUSD, loading } = useLoyalty();
  const { items: wishlistItems } = useWishlist();
  const { itineraries } = useItinerary();
  // Deep-link 지원: ?tab=wishlist 등으로 특정 탭 직진입 (햄버거 메뉴와 sync).
  const [searchParams, setSearchParams] = useSearchParams();
  const VALID_TABS: Tab[] = ['overview', 'bookings', 'coupons', 'wishlist', 'itinerary', 'reviews', 'history'];
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

  // Travel-dashboard data — D-day to next trip + recent plans + weather.
  // Mirrors what MobileHome does so the dashboard reflects the same state
  // without a re-prompt. All effects are no-ops when user isn't signed in.
  const [nextTrip, setNextTrip] = useState<{ title: string; dday: number; date: string } | null>(null);
  const [recentPlans, setRecentPlans] = useState<{ id: string; title: string; date: string; cover?: string }[]>([]);
  const [weather, setWeather] = useState<{ temp: string; desc: string; icon: string; city: string } | null>(null);

  useEffect(() => {
    if (!user) return;
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
        setRecentPlans(plans.slice(0, 3).map(({ sortKey: _s, ...rest }) => rest));
        setNextTrip(nearest);
      } catch {
        /* silent */
      }
    })();
  }, [user]);

  useEffect(() => {
    let city = 'Seoul';
    try {
      const saved = localStorage.getItem('cocotrip_last_region');
      if (saved) city = saved;
    } catch { /* silent */ }
    (async () => {
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
        const data = await res.json();
        const cur = data.current_condition?.[0];
        if (cur) setWeather({
          temp: cur.temp_C + '°C',
          desc: cur.weatherDesc?.[0]?.value || '',
          icon: Number(cur.temp_C) > 20 ? '☀️' : Number(cur.temp_C) > 10 ? '⛅' : '❄️',
          city,
        });
      } catch { /* silent */ }
    })();
  }, []);

  usePageMeta({
    title: t.pageMeta?.myPage?.title ?? 'My Page — Membership & Rewards',
    description: t.pageMeta?.myPage?.description ?? 'Manage your CocoTrip membership, trip coins, coupons, wishlists and travel itineraries.',
  });

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleRedeem = async (coins: number) => {
    if (!user?.uid) return;
    if ((loyalty?.tripCoins ?? 0) < coins) return;
    if (!confirm(`Redeem ${coins} coins for a coupon?`)) return;

    setRedeeming(coins);
    try {
      const res = await fetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem-coupon', userId: user.uid, coins }),
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

  if (loading) {
    return (
      <div className={isMobile ? 'm-page flex items-center justify-center' : 'min-h-screen bg-[#080b14] flex items-center justify-center'}>
        <div className="w-8 h-8 border-2 border-[#B668FC] border-t-transparent animate-spin rounded-full" />
      </div>
    );
  }

  const tier = loyalty?.tier || 'Bronze';
  const tc = TIER_COLORS[tier];

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen bg-[#080b14]'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <div className={`max-w-4xl mx-auto px-4 pt-6 ${isMobile ? 'pb-4' : 'pb-20'}`}>
        {/* 뒤로 */}
        <Link to="/" className="inline-flex items-center gap-2 text-white/55 text-sm mb-6 hover:text-white/70 transition-colors">
          <ArrowLeft size={16} /> {mp.home || 'Home'}
        </Link>

        {/* 프로필 + 등급 카드 */}
        <div className={isMobile
          ? 'm-card m-appear m-glow-border p-5 mb-6'
          : `rounded-2xl bg-gradient-to-br ${tc.bg} border ${tc.border} p-6 mb-8`
        }
          style={isMobile ? { background: 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.04))' } : undefined}
        >
          <div className="flex items-start gap-4">
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'Profile'} className="w-14 h-14 rounded-full border-2" style={{ borderColor: tc.color }} />
            ) : (
              <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-2xl">
                {TIER_EMOJI[tier]}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-white text-xl font-bold">{user?.displayName || mp.traveler || 'Traveler'}</h1>
              <p className="text-white/55 text-sm">{user?.email}</p>
              <div className="flex items-center gap-3 mt-3">
                <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{
                  color: tc.color,
                  backgroundColor: `${tc.color}15`,
                  border: `1px solid ${tc.color}30`,
                }}>
                  {TIER_EMOJI[tier]} {tier}
                </span>
                <span className="flex items-center gap-1.5 text-sm">
                  <Coins size={14} className="text-[#C4956A]" />
                  <span className="text-[#C4956A] font-bold">{(loyalty?.tripCoins || 0).toLocaleString()}</span>
                  <span className="text-white/55 text-xs">{mp.coinsLabel || 'coins'}</span>
                </span>
              </div>
            </div>
          </div>

          {/* 등급 혜택 */}
          <div className="mt-5 pt-4 border-t border-white/5">
            <p className="text-[10px] uppercase tracking-widest text-white/55 mb-2">
              {(mp.tierBenefits || '{tier} Benefits').replace('{tier}', tier)}
            </p>
            <div className="flex flex-wrap gap-2">
              {TIER_BENEFITS[tier].map((b, i) => (
                <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 text-white/50 border border-white/5">
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 탭 네비 */}
        <div className={`flex gap-1 rounded-xl p-1 overflow-x-auto scrollbar-hide ${isMobile ? 'm-card mb-5' : 'bg-white/[0.03] mb-8'}`}>
          {([
            { id: 'overview', label: mp.tabOverview || 'Overview', icon: TrendingUp },
            { id: 'bookings', label: mp.tabBookings || 'My Bookings', icon: Package },
            { id: 'coupons', label: (mp.tabCoupons || 'Coupons ({n})').replace('{n}', String(activeCoupons.length)), icon: Gift },
            { id: 'wishlist', label: (mp.tabWishlist || 'Wishlist ({n})').replace('{n}', String(wishlistItems.length)), icon: Heart },
            { id: 'itinerary', label: (mp.tabItinerary || 'Itinerary ({n})').replace('{n}', String(itineraries.length)), icon: Calendar },
            { id: 'reviews', label: mp.tabReviews || 'Reviews', icon: Star },
            { id: 'history', label: mp.tabPoints || 'Points', icon: Clock },
          ] as { id: Tab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                tab === id
                  ? (isMobile ? 'bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] text-white' : 'bg-[#7C5CFC] text-white')
                  : 'text-white/55 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* ── 탭: Overview — Travel dashboard + nav (Option D, 2026-04-29) ──
            Replaces the previous 4-stat grid with: D-day card → compact stats
            → recent plans → category nav. The nav mirrors the hamburger menu
            so users can stay on /mypage after deep-linking. */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Next-trip D-day + weather */}
            {nextTrip && (
              <Link
                to="/my-plans"
                onClick={() => haptic('tap')}
                className="block rounded-2xl px-4 py-4 border border-pink-500/15 transition-all hover:border-pink-400/30 active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, rgba(255,107,157,0.10), rgba(182,104,252,0.06))' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #FF6B9D, #C850C0)' }}>
                    <Timer className="w-3.5 h-3.5 text-white mb-0.5" />
                    <span className="text-[15px] font-black text-white leading-none">{nextTrip.dday === 0 ? 'D-0' : `D-${nextTrip.dday}`}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-widest text-white/55 font-semibold">{mp.dashNextTrip || 'Next Trip'}</p>
                    <p className="text-[14px] font-bold text-white truncate mt-0.5">{nextTrip.title}</p>
                    <p className="text-[11px] text-white/55 mt-0.5">{nextTrip.date}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/25 shrink-0" />
                </div>
                {weather && (
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
                    <CloudSun className="w-4 h-4 text-purple-300/60 shrink-0" />
                    <span className="text-[12px] text-white/65">{weather.city}</span>
                    <span className="text-[12px] font-black text-pink-400">{weather.temp}</span>
                    <span className="text-[13px]">{weather.icon}</span>
                    <span className="text-[11px] text-white/45 truncate">{weather.desc}</span>
                  </div>
                )}
              </Link>
            )}

            {/* Compact 2×2 stats */}
            <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
              <StatCard label={mp.statTotalSpent || 'Total Spent'} value={`$${(loyalty?.totalSpentUSD || 0).toFixed(0)}`} icon={TrendingUp} />
              <StatCard label={mp.statBookings || 'Bookings'} value={String(loyalty?.bookingCount || 0)} icon={Calendar} />
              <StatCard label={mp.statTripCoins || 'Trip Coins'} value={(loyalty?.tripCoins || 0).toLocaleString()} sub={`≈ $${coinsToUSD(loyalty?.tripCoins || 0)}`} icon={Coins} />
              <StatCard label={mp.statEarnRate || 'Earn Rate'} value={`${((loyalty?.earnRate || 0.01) * 100).toFixed(1)}%`} icon={Crown} />
            </div>

            {/* Recent plans — horizontal scroll, 3 most recent */}
            {recentPlans.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-semibold text-white/65">{mp.dashRecentPlans || 'Recent Plans'}</p>
                  <Link to="/my-plans" onClick={() => haptic('tap')} className="text-[11px] text-[#B668FC] font-semibold flex items-center gap-0.5">
                    {mp.dashViewAll || 'View all'}
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="flex gap-2.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
                  {recentPlans.map((p) => (
                    <Link
                      key={p.id}
                      to={`/my-plans/${p.id}`}
                      onClick={() => haptic('tap')}
                      className="shrink-0 w-[160px] rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] transition-all overflow-hidden block"
                    >
                      <div className="h-20 bg-gradient-to-br from-[#7C5CFC]/20 to-[#FF6B9D]/15 flex items-center justify-center">
                        {p.cover && p.cover.startsWith('http') ? (
                          <img src={p.cover} alt={p.title} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <Sparkles className="w-6 h-6 text-white/35" />
                        )}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-[12px] font-bold text-white truncate">{p.title}</p>
                        <p className="text-[10px] text-white/45 mt-0.5">{p.date || '—'}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Category nav — mirrors hamburger so users don't need to re-open it */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-semibold pt-2">{mp.dashExplore || 'Explore'}</p>
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] overflow-hidden">
                {[
                  { to: '/charter', icon: MapIcon, label: t.nav.charter ?? 'Charter' },
                  { to: '/tours', icon: Package, label: t.nav.tours ?? 'Tours' },
                  { to: '/planner', icon: Sparkles, label: t.nav.planner ?? 'AI Planner' },
                  { to: '/about', icon: Globe, label: t.nav.about ?? 'About' },
                ].map(({ to, icon: Icon, label }, i) => (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => haptic('tap')}
                    className={`flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.03] ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}
                  >
                    <Icon className="w-[18px] h-[18px] text-white/55" />
                    <span className="text-[14px] font-semibold text-white flex-1">{label}</span>
                    <ChevronRight className="w-4 h-4 text-white/15" />
                  </Link>
                ))}
              </div>

              <p className="text-[10px] uppercase tracking-[0.2em] text-white/55 font-semibold pt-2">{mp.dashAccount || 'My Account'}</p>
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] overflow-hidden">
                {(() => {
                  type AccountItem =
                    | { kind: 'link'; to: string; icon: React.ElementType; label: string }
                    | { kind: 'tab'; tab: Tab; icon: React.ElementType; label: string };
                  const items: AccountItem[] = [
                    { kind: 'link', to: '/my-plans', icon: FileText, label: t.nav.myPlans ?? 'My Plans' },
                    { kind: 'tab', tab: 'wishlist', icon: Heart, label: t.nav.wishlist ?? 'Wishlist' },
                    { kind: 'tab', tab: 'bookings', icon: History, label: t.nav.bookingHistory ?? 'Booking History' },
                    { kind: 'tab', tab: 'coupons', icon: Ticket, label: t.nav.coupons ?? 'Coupons' },
                    { kind: 'tab', tab: 'reviews', icon: Star, label: t.nav.reviews ?? 'Reviews' },
                  ];
                  const baseCls = 'flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.03] cursor-pointer w-full text-left';
                  return items.map((it, i) => {
                    const Icon = it.icon;
                    const cls = `${baseCls} ${i > 0 ? 'border-t border-white/[0.04]' : ''}`;
                    if (it.kind === 'tab') {
                      return (
                        <button
                          key={it.tab}
                          onClick={() => { haptic('tap'); setTab(it.tab); }}
                          className={cls}
                        >
                          <Icon className="w-[18px] h-[18px] text-white/55" />
                          <span className="text-[14px] font-semibold text-white flex-1">{it.label}</span>
                          <ChevronRight className="w-4 h-4 text-white/15" />
                        </button>
                      );
                    }
                    return (
                      <Link key={it.to} to={it.to} onClick={() => haptic('tap')} className={cls}>
                        <Icon className="w-[18px] h-[18px] text-white/55" />
                        <span className="text-[14px] font-semibold text-white flex-1">{it.label}</span>
                        <ChevronRight className="w-4 h-4 text-white/15" />
                      </Link>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── 탭: My Bookings ── */}
        {tab === 'bookings' && (
          <MyBookingsTab userEmail={user?.email ?? ''} tier={tier}
            language={(['ko','en','ja','zh'].includes(language) ? language : 'en') as 'ko'|'en'|'ja'|'zh'} />
        )}

        {/* ── 탭: Coupons ── */}
        {tab === 'coupons' && (
          <div className="space-y-6">
            {/* 교환 섹션 */}
            <div className="rounded-2xl bg-gradient-to-br from-[#FFD700]/[0.08] to-[#7C5CFC]/[0.08] border border-[#FFD700]/20 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <Gift className="w-4 h-4 text-[#FFD700]" />
                    Redeem Trip Coins
                  </h3>
                  <p className="text-xs text-white/50 mt-0.5">
                    Balance: <span className="text-[#FFD700] font-semibold">{(loyalty?.tripCoins ?? 0).toLocaleString()}</span> coins
                  </p>
                </div>
              </div>
              <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
                {[
                  { coins: 500,  value: 5,  bonus: false },
                  { coins: 1000, value: 10, bonus: false },
                  { coins: 2000, value: 25, bonus: true  },
                ].map(tier => {
                  const enabled = (loyalty?.tripCoins ?? 0) >= tier.coins;
                  const busy = redeeming === tier.coins;
                  return (
                    <button
                      key={tier.coins}
                      onClick={() => handleRedeem(tier.coins)}
                      disabled={!enabled || busy}
                      className={`relative p-4 rounded-xl border transition-all ${
                        enabled
                          ? 'border-[#FFD700]/30 bg-white/[0.04] hover:bg-white/[0.08] hover:border-[#FFD700]/50'
                          : 'border-white/5 bg-white/[0.02] opacity-40 cursor-not-allowed'
                      }`}
                    >
                      {tier.bonus && (
                        <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#EA537E] text-white">
                          +25% BONUS
                        </span>
                      )}
                      <div className="text-white/60 text-xs">{tier.coins.toLocaleString()} coins</div>
                      <div className="text-white text-xl font-bold mt-1">${tier.value}</div>
                      <div className="text-white/55 text-[10px] mt-0.5">OFF coupon</div>
                      {busy && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
                          <div className="w-5 h-5 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-white/55 mt-3 text-center">
                Valid for 90 days. Enter code at checkout.
              </p>
            </div>

            {/* 기존 쿠폰 리스트 */}
            <div className="space-y-3">
              {coupons.length === 0 ? (
                /* AI-planner ad — same copy as PayPal checkout picker. */
                <Link
                  to="/planner"
                  onClick={() => haptic('tap')}
                  className="block rounded-xl border border-[#7C5CFC]/25 p-4 hover:border-[#7C5CFC]/45 transition-all"
                  style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(255,107,157,0.06))' }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}>
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-white leading-tight">{mp.couponAdTitle || '1 AI plan = 1× 5% coupon'}</p>
                      <p className="text-[11.5px] text-white/65 leading-snug mt-1">{mp.couponAdBody || 'Book a ₩124,000 charter ≈ ₩6,200 saved. The planner ($9.90) pays for itself.'}</p>
                      <span className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#B668FC]">
                        {mp.couponAdCta || 'Make AI plan'}
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </Link>
              ) : coupons.map(c => (
              <div
                key={c.id}
                className={`p-4 rounded-xl border transition-all ${
                  c.isUsed || c.expiresAt < Date.now()
                    ? 'bg-white/[0.02] border-white/5 opacity-50'
                    : 'bg-[#7C5CFC]/5 border-[#7C5CFC]/15 hover:border-[#7C5CFC]/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold text-sm">{c.label}</p>
                    <p className="text-white/55 text-xs mt-1">
                      Expires: {new Date(c.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#7C5CFC] font-bold">
                      {c.type === 'percent' ? `${c.value}%` : `$${c.value}`}
                    </span>
                    {!c.isUsed && c.expiresAt > Date.now() && (
                      <button
                        onClick={() => handleCopy(c.code)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        {copiedCode === c.code
                          ? <Check size={14} className="text-green-400" />
                          : <Copy size={14} className="text-white/55" />
                        }
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="text-xs bg-white/5 px-2 py-0.5 rounded text-[#C4956A]">{c.code}</code>
                  {c.isUsed && <span className="text-[10px] text-red-400/60 uppercase">Used</span>}
                </div>
              </div>
            ))}
            </div>
          </div>
        )}

        {/* ── 탭: Wishlist ── */}
        {tab === 'wishlist' && (
          <div className="space-y-3">
            {wishlistItems.length === 0 ? (
              <EmptyState icon={Heart} text="No wishlisted items" />
            ) : wishlistItems.map(item => (
              <div key={item.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-[#EA537E]/20 transition-all">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{item.name}</p>
                    <p className="text-white/55 text-xs mt-1">{item.productType}</p>
                  </div>
                  {item.priceUSD && (
                    <span className="text-[#C4956A] font-semibold">${item.priceUSD}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 탭: Itinerary ── */}
        {tab === 'itinerary' && (
          <div className="space-y-4">
            {itineraries.length === 0 ? (
              <EmptyState icon={Calendar} text="No itineraries yet" sub="Create your dream trip plan!" />
            ) : itineraries.map(it => (
              <div key={it.id} className="p-5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-[#7C5CFC]/20 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-semibold">{it.title}</h3>
                  <span className="text-xs text-white/55">
                    {it.startDate} → {it.endDate}
                  </span>
                </div>
                <div className="space-y-2">
                  {it.days.map((day, di) => (
                    <div key={di} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-6 h-6 rounded-full bg-[#7C5CFC]/20 text-[#7C5CFC] text-[10px] font-bold flex items-center justify-center">
                          {day.dayNumber}
                        </div>
                        {di < it.days.length - 1 && <div className="w-px flex-1 bg-white/10 my-1" />}
                      </div>
                      <div className="flex-1 pb-3">
                        <p className="text-white/55 text-xs mb-1">{day.date}</p>
                        {day.slots.length === 0 ? (
                          <p className="text-white/15 text-xs italic">Empty</p>
                        ) : day.slots.map(s => (
                          <div key={s.slotId} className="flex items-center gap-2 text-sm text-white/70">
                            <span className="text-white/55">{s.timeStart || '—'}</span>
                            <ChevronRight size={10} className="text-white/15" />
                            <span>{s.name}</span>
                            {s.priceUSD && <span className="text-[#C4956A] text-xs">${s.priceUSD}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 탭: My Reviews ── */}
        {tab === 'reviews' && (
          <MyReviewsTab userId={user?.uid || ''} />
        )}

        {/* ── 탭: Points History ── */}
        {tab === 'history' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-lg">Point History</h3>
              <span className="text-white/55 text-sm">
                Balance: <span className="text-[#FFD700] font-bold">{(loyalty?.tripCoins ?? 0).toLocaleString()}</span>
              </span>
            </div>

            {pointHistory.length === 0 ? (
              <div className="text-center py-12 text-white/55">
                <Clock className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No point activity yet.</p>
                <p className="text-xs mt-1 text-white/55">Share a plan to earn your first Trip Coins!</p>
              </div>
            ) : (
              pointHistory.map(log => (
                <div key={log.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] transition-all">
                  <div className="flex-1">
                    <p className="text-white/90 text-sm font-medium">{log.description}</p>
                    <p className="text-white/55 text-xs mt-0.5">
                      {new Date(log.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className={`font-bold text-lg ${
                    log.type === 'earn' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {log.type === 'earn' ? '+' : ''}{log.amount}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }: {
  label: string; value: string; sub?: string; icon: React.ElementType;
}) {
  return (
    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-white/55" />
        <p className="text-white/55 text-[10px] uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-white font-bold text-xl">{value}</p>
      {sub && <p className="text-white/55 text-[10px] mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyState({ icon: Icon, text, sub }: {
  icon: React.ElementType; text: string; sub?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-white/55">
      <Icon size={36} className="mb-3 opacity-30" />
      <p className="text-sm">{text}</p>
      {sub && <p className="text-xs mt-1 text-white/15">{sub}</p>}
    </div>
  );
}

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

function MyReviewsTab({ userId }: { userId: string }) {
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMyReviews = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'my-reviews', userId }),
      });
      const data = await res.json();
      setReviews(data.reviews || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { fetchMyReviews(); }, [fetchMyReviews]);

  const handleDelete = async (reviewId: string) => {
    if (!confirm('Delete this review?')) return;
    try {
      await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', reviewId, userId }),
      });
      setReviews(prev => prev.filter(r => r.id !== reviewId));
    } catch { /* silent */ }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
      </div>
    );
  }

  if (reviews.length === 0) {
    return <EmptyState icon={Star} text="No reviews yet" sub="Review a trip to earn +50 Trip Coins!" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold text-lg">My Reviews</h3>
        <span className="text-white/55 text-sm">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</span>
      </div>
      {reviews.map(r => (
        <div key={r.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} size={12} className={i <= r.rating ? 'fill-[#FFD700] text-[#FFD700]' : 'fill-transparent text-white/55'} />
                ))}
              </div>
              <span className="text-white/55 text-[10px]">
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </div>
            <button
              onClick={() => handleDelete(r.id)}
              className="text-white/55 text-xs hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          </div>
          <p className="text-white/70 text-sm">{r.text}</p>
          <Link
            to={`/my-plans/${r.targetId}`}
            className="inline-flex items-center gap-1 text-[#7C5CFC] text-xs mt-2 hover:underline"
          >
            View plan <ChevronRight size={10} />
          </Link>
        </div>
      ))}
    </div>
  );
}
