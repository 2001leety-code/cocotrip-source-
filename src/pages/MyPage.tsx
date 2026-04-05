/**
 * MyPage — 마이페이지 (등급/포인트/쿠폰/위시리스트/일정)
 * 로그인 필수, AuthRequired 래핑
 */
import { useState } from 'react';
import {
  Crown, Coins, Gift, Heart, Calendar, Clock,
  ArrowLeft, TrendingUp, ChevronRight, Copy, Check,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLoyalty, type TierType } from '@/hooks/useLoyalty';
import { useWishlist } from '@/hooks/useWishlist';
import { useItinerary } from '@/hooks/useItinerary';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';

const TIER_COLORS: Record<TierType, { color: string; bg: string; border: string }> = {
  Bronze:   { color: '#CD7F32', bg: 'from-[#CD7F32]/15 to-[#8B4513]/10', border: 'border-[#CD7F32]/20' },
  Silver:   { color: '#C0C0C0', bg: 'from-[#C0C0C0]/15 to-[#808080]/10', border: 'border-[#C0C0C0]/20' },
  Gold:     { color: '#FFD700', bg: 'from-[#FFD700]/15 to-[#B8860B]/10', border: 'border-[#FFD700]/20' },
  Platinum: { color: '#E5E4E2', bg: 'from-[#B668FC]/20 to-[#7C5CFC]/15', border: 'border-[#7C5CFC]/25' },
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

type Tab = 'overview' | 'coupons' | 'wishlist' | 'itinerary' | 'history';

export default function MyPage() {
  const { language, t, changeLanguage } = useLanguage();
  const { user } = useAuth();
  const { loyalty, coupons, activeCoupons, pointHistory, coinsToUSD, loading } = useLoyalty();
  const { items: wishlistItems } = useWishlist();
  const { itineraries } = useItinerary();
  const [tab, setTab] = useState<Tab>('overview');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080b14] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
      </div>
    );
  }

  const tier = loyalty?.tier || 'Bronze';
  const tc = TIER_COLORS[tier];

  return (
    <div className="min-h-screen bg-[#080b14]">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <div className="max-w-4xl mx-auto px-4 pt-6 pb-20">
        {/* 뒤로 */}
        <Link to="/" className="inline-flex items-center gap-2 text-white/40 text-sm mb-6 hover:text-white/70 transition-colors">
          <ArrowLeft size={16} /> Home
        </Link>

        {/* 프로필 + 등급 카드 */}
        <div className={`rounded-2xl bg-gradient-to-br ${tc.bg} border ${tc.border} p-6 mb-8`}>
          <div className="flex items-start gap-4">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="w-14 h-14 rounded-full border-2" style={{ borderColor: tc.color }} />
            ) : (
              <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-2xl">
                {TIER_EMOJI[tier]}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-white text-xl font-bold">{user?.displayName || 'Traveler'}</h1>
              <p className="text-white/40 text-sm">{user?.email}</p>
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
                  <span className="text-white/30 text-xs">coins</span>
                </span>
              </div>
            </div>
          </div>

          {/* 등급 혜택 */}
          <div className="mt-5 pt-4 border-t border-white/5">
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">
              {tier} Benefits
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
        <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1 mb-8 overflow-x-auto">
          {([
            { id: 'overview', label: 'Overview', icon: TrendingUp },
            { id: 'coupons', label: `Coupons (${activeCoupons.length})`, icon: Gift },
            { id: 'wishlist', label: `Wishlist (${wishlistItems.length})`, icon: Heart },
            { id: 'itinerary', label: `Itinerary (${itineraries.length})`, icon: Calendar },
            { id: 'history', label: 'Points', icon: Clock },
          ] as { id: Tab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                tab === id
                  ? 'bg-[#7C5CFC] text-white'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* ── 탭: Overview ── */}
        {tab === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Spent" value={`$${(loyalty?.totalSpentUSD || 0).toFixed(0)}`} icon={TrendingUp} />
            <StatCard label="Bookings" value={String(loyalty?.bookingCount || 0)} icon={Calendar} />
            <StatCard label="Trip Coins" value={(loyalty?.tripCoins || 0).toLocaleString()} sub={`≈ $${coinsToUSD(loyalty?.tripCoins || 0)}`} icon={Coins} />
            <StatCard label="Earn Rate" value={`${((loyalty?.earnRate || 0.01) * 100).toFixed(1)}%`} icon={Crown} />
          </div>
        )}

        {/* ── 탭: Coupons ── */}
        {tab === 'coupons' && (
          <div className="space-y-3">
            {coupons.length === 0 ? (
              <EmptyState icon={Gift} text="No coupons yet" />
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
                    <p className="text-white/30 text-xs mt-1">
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
                          : <Copy size={14} className="text-white/40" />
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
                    <p className="text-white/30 text-xs mt-1">{item.productType}</p>
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
                  <span className="text-xs text-white/30">
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
                        <p className="text-white/40 text-xs mb-1">{day.date}</p>
                        {day.slots.length === 0 ? (
                          <p className="text-white/15 text-xs italic">Empty</p>
                        ) : day.slots.map(s => (
                          <div key={s.slotId} className="flex items-center gap-2 text-sm text-white/70">
                            <span className="text-white/25">{s.timeStart || '—'}</span>
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

        {/* ── 탭: Points History ── */}
        {tab === 'history' && (
          <div className="space-y-2">
            {pointHistory.length === 0 ? (
              <EmptyState icon={Clock} text="No points activity yet" />
            ) : pointHistory.map(log => (
              <div key={log.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <div>
                  <p className="text-white/70 text-sm">{log.description}</p>
                  <p className="text-white/20 text-[10px]">{new Date(log.createdAt).toLocaleString()}</p>
                </div>
                <span className={`font-semibold text-sm ${log.type === 'earn' ? 'text-green-400' : 'text-red-400'}`}>
                  {log.type === 'earn' ? '+' : ''}{log.amount}
                </span>
              </div>
            ))}
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
        <Icon size={14} className="text-white/25" />
        <p className="text-white/30 text-[10px] uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-white font-bold text-xl">{value}</p>
      {sub && <p className="text-white/25 text-[10px] mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyState({ icon: Icon, text, sub }: {
  icon: React.ElementType; text: string; sub?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-white/20">
      <Icon size={36} className="mb-3 opacity-30" />
      <p className="text-sm">{text}</p>
      {sub && <p className="text-xs mt-1 text-white/15">{sub}</p>}
    </div>
  );
}
