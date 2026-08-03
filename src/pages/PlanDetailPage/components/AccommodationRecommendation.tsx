// AI 가 생성한 호텔 추천 카드 (plan.accommodation 렌더).
// B9-20 (2026-05-09 round 4): 추적 결과 누락 발견 — Gemini 가 wantAccom=true 시
// "accommodation" 객체를 응답에 포함하지만 PlanDetailPage 가 어디서도 렌더하지
// 않아 사용자에게 보이지 않았음. 이 컴포넌트가 그 missing piece.
//
// affiliate HotelAd (광고 — 외부 booking 사이트로 funnel) 와는 별개.
// AI 가 itinerary 동선·예산·취향 분석 후 고른 "이 플랜에 딱 맞는 한 채" 의 추천.
import { Hotel, MapPin, CreditCard, Sparkles } from 'lucide-react';
import { buildAccommodationLinks } from '@/config/affiliateLinks';
import { trackAffiliateClick } from '@/lib/affiliateTracking';
import { AffiliateCard } from '@/components/AffiliateCard';
import { useLanguage } from '@/hooks/useLanguage';

interface AccommodationRecommendationProps {
  /** Firestore plan.accommodation — Gemini 응답 그대로 (필드 names 비결정적). */
  acc: Record<string, unknown>;
  /** 메인 도시 (어필리에이트 link region). */
  region: string;
  /** i18n 라벨 — caller 에서 미리 추출 (planDetail dict). */
  labelTitle?: string;
  /** "왜 이 호텔" 라벨. */
  labelWhy?: string;
  /** 예약 팁 라벨. */
  labelTip?: string;
  /** 어필리에이트 노출 라벨. */
  labelAffiliateNote?: string;
}

/** 안전 추출 — Gemini 가 다양한 필드명 (name / hotel_name / title) 으로 반환. */
function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function AccommodationRecommendation({
  acc,
  region,
  labelTitle,
  labelWhy,
  labelTip,
  labelAffiliateNote,
}: AccommodationRecommendationProps) {
  // Gemini 비결정성 대응: name / hotel_name / title 모두 fallback.
  // CLAUDE.md C 의 신/구 폴백 패턴과 동일 정신.
  // 🔴 훅은 조건부 return 위에서 부른다 — 아래 `if (!name) return null` 뒤로 내리면
  //   렌더마다 훅 개수가 달라져 React 가 상태를 뒤섞는다.
  const { language } = useLanguage();
  const name = pickStr(acc, ['name', 'hotel_name', 'title', 'display_name']);
  const area = pickStr(acc, ['area', 'neighborhood', 'district', 'location']);
  const priceRange = pickStr(acc, ['price_range', 'priceRange', 'nightly_rate', 'price']);
  const why = pickStr(acc, ['why', 'reason', 'recommendation_reason']);
  const bookingTip = pickStr(acc, ['booking_tip', 'bookingTip', 'tip', 'note']);
  const address = pickStr(acc, ['address']);


  // 호텔 이름 자체가 없으면 렌더 skip (legacy plan / Gemini 빈 응답 호환).
  if (!name) return null;

  const links = buildAccommodationLinks(name, area || region);

  return (
    <div className="mb-6 rounded-2xl overflow-hidden border border-emerald-500/20"
      style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(20,184,166,0.05))' }}>
      <div className="px-5 py-4">
        <p className="text-[13px] uppercase tracking-widest text-emerald-300/80 font-semibold mb-3 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          {labelTitle || 'AI Hotel Recommendation'}
        </p>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Hotel className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-base mb-1 break-words">{name}</p>
            {(area || address) && (
              <p className="text-[14px] text-white/65 mb-2 flex items-start gap-1">
                <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                <span className="break-words">{[area, address].filter(Boolean).join(' · ')}</span>
              </p>
            )}
            {why && (
              <div className="bg-emerald-500/10 border-l-2 border-emerald-400/50 rounded-r-xl px-3 py-2 mb-2">
                <p className="text-[13px] uppercase tracking-wider text-emerald-300/80 font-semibold mb-1">
                  {labelWhy || 'Why this hotel'}
                </p>
                <p className="text-[14px] text-emerald-100/85 leading-relaxed">{why}</p>
              </div>
            )}
            {priceRange && (
              <p className="text-[14px] text-white/70 mb-2 flex items-center gap-1">
                <CreditCard className="w-3 h-3 shrink-0" />
                <span>{priceRange}</span>
              </p>
            )}
            {bookingTip && (
              <p className="text-[13px] text-white/65 leading-relaxed mb-2">
                <span className="text-amber-300/80 font-semibold">{labelTip || 'Booking tip'}: </span>
                {bookingTip}
              </p>
            )}
          </div>
        </div>
      </div>
      {/* 어필리에이트 link — 호텔 이름·지역으로 검색해서 외부 booking 사이트로 funnel. */}
      {links.length > 0 && (
        <div className="px-5 pb-4 space-y-2">
          {/* 노출 계측 (2026-08-03) — 기존 flex 컨테이너를 AffiliateCard 로 **교체**한다.
              새 div 를 끼우거나 `<a>` 를 개별로 감싸면 `flex-1` 이 래퍼로 넘어가 버튼 폭이
              무너진다. payload 는 아래 클릭과 **글자 그대로 같아야** 노출·클릭 짝이 맞는다
              (`String(area || region).toLowerCase()` 를 표현식째로 맞춘다). */}
          <AffiliateCard
            className="flex flex-wrap gap-2"
            payload={{
              product: 'hotel', placement: 'plan_lodging_recommendation',
              language, city: String(area || region).toLowerCase(),
            }}
          >
            {links.map((lk: { provider: string; url: string; label: string; color?: string }) => (
              <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer sponsored"
                onClick={() => trackAffiliateClick({
                  product: 'hotel', placement: 'plan_lodging_recommendation',
                  language, city: String(area || region).toLowerCase(),
                })}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[14px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: lk.color || '#0073E6' }}>
                {lk.label} {'→'}
              </a>
            ))}
          </AffiliateCard>
          <p className="text-[12px] text-white/65 text-center">
            {labelAffiliateNote || 'Affiliate link — helps support CocoTrip.'}
          </p>
        </div>
      )}
    </div>
  );
}
