/**
 * LoyaltyBadge — 등급 배지 + Trip Coins 표시
 * Header에 삽입하여 유저 리텐션 강화
 */
import { Coins, Gift, ChevronRight } from 'lucide-react';
import { useLoyalty, type TierType } from '@/hooks/useLoyalty';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';

const TIER_CONFIG: Record<TierType, { icon: string; color: string; bg: string; glow: string }> = {
  Bronze:   { icon: '🥉', color: '#CD7F32', bg: 'from-[#CD7F32]/10 to-[#CD7F32]/5',  glow: 'shadow-[0_0_8px_rgba(205,127,50,0.2)]' },
  Silver:   { icon: '🥈', color: '#C0C0C0', bg: 'from-[#C0C0C0]/10 to-[#C0C0C0]/5',  glow: 'shadow-[0_0_8px_rgba(192,192,192,0.2)]' },
  Gold:     { icon: '🥇', color: '#FFD700', bg: 'from-[#FFD700]/10 to-[#FFD700]/5',  glow: 'shadow-[0_0_10px_rgba(255,215,0,0.25)]' },
  Platinum: { icon: '💎', color: '#E5E4E2', bg: 'from-[#E5E4E2]/15 to-[#C0C0C0]/10', glow: 'shadow-[0_0_12px_rgba(229,228,226,0.3)]' },
};

export function LoyaltyBadge() {
  const { user } = useAuth();
  const { loyalty, activeCoupons, coinsToUSD, loading } = useLoyalty();
  const [expanded, setExpanded] = useState(false);

  if (!user || loading || !loyalty) return null;

  const config = TIER_CONFIG[loyalty.tier];

  return (
    <div className="relative">
      {/* 미니 배지 (항상 표시) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${config.bg} border border-white/10 ${config.glow} hover:border-white/20 transition-all`}
      >
        <span className="text-sm">{config.icon}</span>
        <span className="text-xs font-semibold" style={{ color: config.color }}>
          {loyalty.tier}
        </span>
        <span className="text-white/30 text-[9px]">|</span>
        <div className="flex items-center gap-1">
          <Coins size={12} className="text-[#C4956A]" />
          <span className="text-xs text-[#C4956A] font-medium">
            {loyalty.tripCoins.toLocaleString()}
          </span>
        </div>
        <ChevronRight
          size={12}
          className={`text-white/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* 확장 카드 */}
      {expanded && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#0c1220] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* 등급 헤더 */}
          <div className={`p-4 bg-gradient-to-r ${config.bg} border-b border-white/5`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider">Membership Tier</p>
                <p className="text-lg font-bold mt-0.5" style={{ color: config.color }}>
                  {config.icon} {loyalty.tier}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/40">Earn Rate</p>
                <p className="text-[#C4956A] font-semibold">
                  {(loyalty.earnRate * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          {/* Trip Coins */}
          <div className="p-4 border-b border-white/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Coins size={16} className="text-[#C4956A]" />
                <span className="text-white/60 text-sm">Trip Coins</span>
              </div>
              <div className="text-right">
                <p className="text-[#C4956A] font-bold text-lg">
                  {loyalty.tripCoins.toLocaleString()}
                </p>
                <p className="text-white/30 text-[10px]">
                  ≈ ${coinsToUSD(loyalty.tripCoins)}
                </p>
              </div>
            </div>
          </div>

          {/* 쿠폰 */}
          {activeCoupons.length > 0 && (
            <div className="p-4 border-b border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <Gift size={14} className="text-[#7C5CFC]" />
                <span className="text-white/60 text-xs">
                  Available Coupons ({activeCoupons.length})
                </span>
              </div>
              <div className="space-y-1.5">
                {activeCoupons.slice(0, 3).map(c => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#7C5CFC]/5 border border-[#7C5CFC]/10"
                  >
                    <span className="text-xs text-white/70">{c.label}</span>
                    <span className="text-xs font-semibold text-[#7C5CFC]">
                      {c.type === 'percent' ? `${c.value}% OFF` : `$${c.value}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 통계 */}
          <div className="p-4 grid grid-cols-2 gap-3">
            <div className="text-center">
              <p className="text-white/30 text-[10px] uppercase">Total Spent</p>
              <p className="text-white/80 font-semibold text-sm">
                ${loyalty.totalSpentUSD.toFixed(0)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-white/30 text-[10px] uppercase">Bookings</p>
              <p className="text-white/80 font-semibold text-sm">{loyalty.bookingCount}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
