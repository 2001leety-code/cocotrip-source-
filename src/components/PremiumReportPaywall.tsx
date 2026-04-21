/**
 * @deprecated 이 컴포넌트는 현재 사용되지 않습니다.
 * PlannerPage.tsx 내부 인라인 페이월이 대신 사용 중입니다.
 * 향후 PlanDetailPage에서 Day 2+ 잠금 기능이 필요할 때 재활용 가능.
 */
import { useState } from 'react';
import { Lock, Sparkles, Check, Gift, Star } from 'lucide-react';
import { PayPalBookingButton } from './PayPalBookingButton';

// ── 다국어 라벨 ──────────────────────────────────────────
const LABELS: Record<string, {
  title: string; subtitle: string; badge: string;
  feat1: string; feat2: string; feat3: string;
  bonus: string; bonusDesc: string;
  price: string; priceNote: string;
  preview: string; locked: string;
}> = {
  ko: {
    title: '나머지 일정 언락하기', subtitle: '2~3일 차 완벽 일정을 받아보세요',
    badge: '프리미엄 리포트',
    feat1: '숨은 명소 + 로컬 맛집 + 최적 동선', feat2: '교통비·입장료 상세 예산 분석', feat3: 'PDF 일정표 + 네이버 지도 연동',
    bonus: '5% 추가 할인권 즉시 증정', bonusDesc: '전세차량 예약 시 사용 가능',
    price: '$9.90', priceNote: '1회 결제 · 전체 일정 영구 열람',
    preview: 'AI가 분석 중...', locked: 'Premium',
  },
  en: {
    title: 'Unlock Full Itinerary', subtitle: 'Get the complete 2-3 day plan with hidden gems',
    badge: 'PREMIUM REPORT',
    feat1: 'Hidden spots + local restaurants + optimal routes', feat2: 'Detailed budget: transport, admission, meals', feat3: 'PDF itinerary + Naver Map integration',
    bonus: 'Instant 5% off coupon', bonusDesc: 'Use on your charter booking',
    price: '$9.90', priceNote: 'One-time payment · Lifetime access',
    preview: 'AI analyzing...', locked: 'Premium itinerary',
  },
  ja: {
    title: '全日程をアンロック', subtitle: '2～3日目の完璧な旅程を受け取る',
    badge: 'プレミアムレポート',
    feat1: '隠れスポット + ローカルグルメ + 最適ルート', feat2: '交通費・入場料の詳細予算分析', feat3: 'PDF旅程表 + Naverマップ連携',
    bonus: '5%割引クーポンプレゼント', bonusDesc: 'チャーター車予約に使用可能',
    price: '$9.90', priceNote: '1回払い · 全日程永久閲覧',
    preview: 'AI分析中...', locked: 'プレミアム旅程',
  },
  zh: {
    title: '解锁完整行程', subtitle: '获取2-3天完美行程规划',
    badge: '高级报告',
    feat1: '隐藏景点 + 本地美食 + 最优路线', feat2: '交通·门票·餐饮详细预算分析', feat3: 'PDF行程表 + Naver地图集成',
    bonus: '即送5%优惠券', bonusDesc: '可用于包车预订',
    price: '$9.90', priceNote: '一次付款 · 永久查看',
    preview: 'AI分析中...', locked: '高级行程',
  },
};

interface PremiumReportPaywallProps {
  lang: string;
  p: Record<string, string | undefined>;
  totalDays: number;
  onUnlocked?: () => void;
}

export function PremiumReportPaywall({ lang, p, totalDays, onUnlocked }: PremiumReportPaywallProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [unlocked, _setUnlocked] = useState(false);
  const l = LABELS[lang] ?? LABELS.en;

  if (unlocked) return null;

  return (
    <div className="mt-8 rounded-2xl overflow-hidden border border-[#C4956A]/30"
      style={{ background: 'linear-gradient(160deg, rgba(196,149,106,0.08) 0%, rgba(124,92,252,0.06) 50%, rgba(10,12,24,0.95) 100%)' }}>

      {/* Locked days preview */}
      <div className="relative px-5 py-6">
        {/* Blur overlay for locked days */}
        {totalDays > 1 && (
          <div className="mb-4 space-y-2">
            {Array.from({ length: Math.min(totalDays - 1, 2) }, (_, i) => (
              <div key={i} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 relative overflow-hidden"
                style={{ filter: 'blur(3px)', pointerEvents: 'none' }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-[#7C5CFC]/20 flex items-center justify-center text-xs font-bold text-[#7C5CFC]">
                    {i + 2}
                  </div>
                  <div className="flex-1">
                    <div className="h-3 bg-white/10 rounded w-32 mb-1" />
                    <div className="h-2 bg-white/5 rounded w-48" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="h-2 bg-white/5 rounded w-full" />
                  <div className="h-2 bg-white/5 rounded w-3/4" />
                  <div className="h-2 bg-white/5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Lock icon overlay */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ top: totalDays > 1 ? '-20px' : '0' }}>
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-[#1a1a2e]/90 border border-[#C4956A]/30 flex items-center justify-center backdrop-blur-sm shadow-[0_0_30px_rgba(196,149,106,0.15)]">
              <Lock className="w-7 h-7 text-[#C4956A]" />
            </div>
            <span className="text-xs text-[#C4956A]/70 font-semibold mt-2">{l.locked}</span>
          </div>
        </div>
      </div>

      {/* Premium badge */}
      <div className="px-5 -mt-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#C4956A]/30 bg-[#C4956A]/10">
          <Sparkles className="w-3.5 h-3.5 text-[#C4956A]" />
          <span className="text-[10px] font-bold tracking-wider uppercase text-[#C4956A]">{l.badge}</span>
        </div>
      </div>

      {/* Title & subtitle */}
      <div className="px-5 pt-3 pb-4">
        <h3 className="text-lg font-bold text-white mb-1">{l.title}</h3>
        <p className="text-sm text-white/45">{l.subtitle}</p>
      </div>

      {/* Features */}
      <div className="px-5 pb-4 space-y-2.5">
        {[l.feat1, l.feat2, l.feat3].map((feat, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div className="w-5 h-5 rounded-md bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-emerald-400" />
            </div>
            <span className="text-xs text-white/60 leading-relaxed">{feat}</span>
          </div>
        ))}
      </div>

      {/* Bonus coupon */}
      <div className="mx-5 mb-4 bg-gradient-to-r from-amber-500/10 to-[#C4956A]/10 border border-amber-500/25 rounded-xl px-4 py-3 flex items-center gap-3">
        <Gift className="w-5 h-5 text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-bold text-amber-300">{l.bonus}</p>
          <p className="text-[11px] text-amber-200/60">{l.bonusDesc}</p>
        </div>
      </div>

      {/* Price + CTA */}
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{l.price}</span>
            <span className="text-xs text-white/30">{l.priceNote}</span>
          </div>
          <div className="flex items-center gap-0.5">
            {[1,2,3,4,5].map(i => <Star key={i} className="w-3 h-3 text-amber-400 fill-amber-400" />)}
          </div>
        </div>

        <PayPalBookingButton
          productType="premium_report"
          passengers={1}
          priceKRW={6800}
          p={p}
          lang={lang}
          pickupLocation=""
          dropoffLocation=""
          vehicleType="staria"
          memo="Premium AI Report"
        />

        {/* On success, call onUnlocked */}
        {unlocked && onUnlocked && onUnlocked()}
      </div>
    </div>
  );
}
