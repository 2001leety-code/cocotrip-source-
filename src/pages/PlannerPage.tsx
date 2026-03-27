import { useState, useRef, useEffect } from 'react';
import { detectCharterRecommendation, EXTRA_CHARGES, KPOP_SHUTTLE } from '@/data/charterPricing';
import { SEASONAL_SPOTS } from '@/data/seasonalSpots';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { PlannerForm } from '@/components/PlannerForm';
import type { PlannerFormValues } from '@/components/PlannerForm';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';

const PAGE_STYLE = `
@keyframes pulse-ring {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(1.9); opacity: 0; }
}
@keyframes fade-slide-up {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slide-in-left {
  from { opacity: 0; transform: translateX(-14px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes progress-ai {
  0%  { width: 0%; }
  25% { width: 30%; }
  55% { width: 62%; }
  80% { width: 84%; }
  100%{ width: 93%; }
}
`;

// ────────────────────────────────────────
// ★ 확장된 타입 정의
// ────────────────────────────────────────
interface TransportToNext {
  method: string;
  detail: string;
  durationMin: number;
  costKRW: string;
  fatigueComment?: string;
  charterRecommended?: string;
  charterReason?: string;
  charterCostEstimate?: string;
}

interface Place {
  order: number; name: string; nameEn: string; category: string;
  address: string; coordinates: { lat: number; lng: number };
  duration?: string; admissionFee?: string;
  tips: string; rainyAlternative?: string;
  transportToNext?: TransportToNext;
  openingHours?: string;
  closedDays?: string;
  naverMapUrl?: string;
  reservationRequired?: string;
  cashOnly?: string;
  crowdedTimes?: string;
}

interface Meal {
  type: string;
  restaurantName: string;
  cuisine: string;
  costPerPerson: string;
  reservationRequired: string;
  waitTime?: string;
  address?: string;
  tip?: string;
}

interface DayItinerary {
  day: number; date: string;
  dailyTips?: string[];
  places: Place[];
  meals: Meal[];
}

interface Accommodation {
  name: string; area: string; reason: string;
  priceRange: string; address: string;
}

interface BudgetSummary {
  transport: string; food: string;
  admission: string; accommodation: string; total: string;
}

interface PlannerResponse {
  meta: { categories: string[]; regions: string[]; startDate: string; endDate: string; generatedAt: string; };
  accommodation: Accommodation;
  budgetSummary: BudgetSummary;
  itinerary: DayItinerary[];
  currentSeason?: 'spring' | 'summer' | 'autumn' | 'winter';
}

// ────────────────────────────────────────
// 스타일 상수
// ────────────────────────────────────────
const CAT_BADGE: Record<string, string> = {
  'K-pop':     'bg-purple-500/20 text-purple-300 border-purple-500/40',
  'K-food':    'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'K-culture': 'bg-blue-500/20   text-blue-300   border-blue-500/40',
  'K-beauty':  'bg-pink-500/20   text-pink-300   border-pink-500/40',
  'nature':    'bg-green-500/20  text-green-300  border-green-500/40',
  'skiing':    'bg-cyan-500/20   text-cyan-300   border-cyan-500/40',
  'shopping':  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  'heritage':  'bg-amber-500/20  text-amber-300  border-amber-500/40',
};
const CAT_EMOJI: Record<string, string> = {
  'K-pop': '🎤', 'K-food': '🍜', 'K-culture': '🏯', 'K-beauty': '💄',
  'nature': '🌿', 'skiing': '⛷️', 'shopping': '🛍️', 'heritage': '🏛️',
};
const DATE_LOCALE: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
};
const TRANSPORT_ICON: Record<string, string> = {
  bus: '🚌', subway: '🚇', taxi: '🚕', walk: '🚶', charter: '🚐', default: '🚗',
};
const MEAL_ICON: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙',
};

function formatDate(dateStr: string, lang: string) {
  return new Date(dateStr).toLocaleDateString(DATE_LOCALE[lang] ?? 'en-US', {
    month: 'long', day: 'numeric', weekday: 'short',
  });
}

// ────────────────────────────────────────
// 로딩 애니메이션 (기존 유지)
// ────────────────────────────────────────
function LoadingAnimation({ p }: { p: any }) {
  const steps = [
    { emoji: '🗺️', text: p.step1 }, { emoji: '📍', text: p.step2 },
    { emoji: '🧭', text: p.step3 }, { emoji: '🚗', text: p.step4 },
  ];
  return (
    <div className="flex flex-col items-center py-20 gap-10">
      <div className="relative w-20 h-20 flex items-center justify-center">
        {[0, 1].map((i) => (
          <div key={i} className="absolute inset-0 rounded-full border border-cyan-400/40"
            style={{ animation: `pulse-ring 2s ease-out infinite`, animationDelay: `${i * 0.8}s` }} />
        ))}
        <div className="w-12 h-12 rounded-full border-2 border-t-cyan-400 border-white/10 animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-white mb-1.5">{p.loadingTitle}</p>
        <p className="text-sm text-white/40">{p.loadingHint}</p>
      </div>
      <div className="w-full max-w-xs">
        <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
            style={{ animation: 'progress-ai 20s linear forwards' }} />
        </div>
      </div>
      <div className="w-full max-w-xs space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3"
            style={{ animation: 'slide-in-left 0.4s ease forwards', animationDelay: `${i * 0.5}s`, opacity: 0 }}>
            <span className="text-base shrink-0">{step.emoji}</span>
            <span className="text-sm text-white/60 flex-1">{step.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 교통 커넥터 (확장)
// ────────────────────────────────────────
function TravelConnector({ transport, p }: { transport?: TransportToNext; p: any }) {
  if (!transport) return null;
  const icon = TRANSPORT_ICON[transport.method] ?? TRANSPORT_ICON.default;
  const isCharter = transport.charterRecommended === 'yes';

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 my-1">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center gap-0.5 ml-4">
          {[0,1,2].map((i) => <div key={i} className="w-0.5 h-2 rounded-full bg-white/20" />)}
        </div>
        <div className="flex-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-white/50 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
            {icon} <span>{transport.detail}</span>
            <span className="text-white/30">·</span>
            <span className="text-cyan-400/80">{transport.costKRW}</span>
          </span>
        </div>
      </div>
      {transport.fatigueComment && (
        <div className="ml-10 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
          <span className="text-amber-400 text-sm shrink-0">💼</span>
          <p className="text-xs text-amber-200/80 leading-relaxed">{transport.fatigueComment}</p>
        </div>
      )}
      {isCharter && (
        <div className="ml-10 flex items-start gap-2 bg-blue-500/10 border border-blue-500/25 rounded-xl px-3 py-2">
          <span className="text-blue-400 text-sm shrink-0">🚐</span>
          <div>
            <p className="text-xs text-blue-200/90 font-semibold mb-0.5">{p.charterLabel}</p>
            <p className="text-xs text-blue-200/60 leading-relaxed">{transport.charterReason}</p>
            {transport.charterCostEstimate && (
              <p className="text-xs text-blue-400/80 mt-0.5">{p.charterCostPrefix}{transport.charterCostEstimate}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// ★ 장소 카드 (확장)
// ────────────────────────────────────────
function PlaceCard({ place, p }: { place: Place; p: any }) {
  const badgeClass = CAT_BADGE[place.category] ?? 'bg-white/10 text-white/60 border-white/20';
  const emoji = CAT_EMOJI[place.category] ?? '📌';
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 transition-all duration-300 hover:border-white/25"
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.4)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}>
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-9 h-9 rounded-full text-white text-sm font-bold flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', boxShadow: '0 0 12px rgba(124,92,252,0.4)' }}>
          {place.order}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-bold text-white text-base leading-snug">{place.name}</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${badgeClass}`}>
              {emoji} {place.category}
            </span>
          </div>
          <p className="text-xs text-white/30 mb-2">{place.nameEn}</p>
          <p className="text-xs text-white/50 mb-2 flex items-start gap-1">
            <span className="mt-0.5 shrink-0">📍</span>
            <span>{place.address}</span>
          </p>

          {/* 운영시간 + 휴무 */}
          {(place.openingHours || place.closedDays) && (
            <p className="text-xs text-white/40 mb-2 flex items-center gap-2 flex-wrap">
              {place.openingHours && <span className="flex items-center gap-1"><span>🕐</span>{p.placeHours}: {place.openingHours}</span>}
              {place.closedDays && place.closedDays !== 'None' && place.closedDays !== 'none' && (
                <span className="flex items-center gap-1"><span>🚫</span>{p.placeClosed}: {place.closedDays}</span>
              )}
            </p>
          )}

          {(place.duration || place.admissionFee) && (
            <div className="flex gap-3 mb-3 flex-wrap">
              {place.duration && <span className="text-xs text-white/40 flex items-center gap-1"><span>⏱️</span>{place.duration}</span>}
              {place.admissionFee && <span className="text-xs text-white/40 flex items-center gap-1"><span>🎟️</span>{place.admissionFee}</span>}
            </div>
          )}

          {/* 태그 pills */}
          {(place.reservationRequired === 'yes' || place.reservationRequired === 'recommended' || place.cashOnly === 'yes' || place.crowdedTimes) && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {place.reservationRequired === 'yes' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 font-medium">📞 {p.placeReservationRequired}</span>
              )}
              {place.reservationRequired === 'recommended' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 font-medium">📞 {p.placeReservationRecommended}</span>
              )}
              {place.cashOnly === 'yes' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 border border-white/15 text-white/55 font-medium">💵 {p.placeCashOnly}</span>
              )}
              {place.crowdedTimes && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 border border-white/15 text-white/55 font-medium">👥 {p.placeCrowded}: {place.crowdedTimes}</span>
              )}
            </div>
          )}

          <div className="bg-cyan-500/10 border-l-2 border-cyan-400/60 rounded-r-xl px-3 py-2.5 mb-2">
            <p className="text-sm text-cyan-100/80 leading-relaxed">
              <span className="mr-1 text-cyan-400">›</span>{place.tips}
            </p>
          </div>

          {/* 액션 버튼 */}
          {place.naverMapUrl && (
            <div className="flex gap-2 mb-2 flex-wrap">
              <a href={place.naverMapUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#03C75A]/30 bg-[#03C75A]/10 text-[#03C75A] text-xs font-medium hover:bg-[#03C75A]/20 transition-colors">
                <span>🗺️</span>{p.placeNaverMap}
              </a>
            </div>
          )}

          {place.rainyAlternative && (
            <div className="flex items-start gap-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2">
              <span className="text-indigo-400 text-xs shrink-0">☂️</span>
              <p className="text-xs text-indigo-200/70 leading-relaxed">{place.rainyAlternative}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 식사 섹션
// ────────────────────────────────────────
function MealsSection({ meals, p }: { meals: Meal[]; p: any }) {
  if (!meals?.length) return null;
  return (
    <div className="mt-6 mb-2">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">🍽️ {p.mealsLabel}</p>
      <div className="grid gap-2">
        {meals.map((meal, i) => (
          <div key={i} className="flex items-start gap-3 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3">
            <span className="text-base shrink-0 mt-0.5">{MEAL_ICON[meal.type] ?? '🍴'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="text-sm font-semibold text-white">{meal.restaurantName}</span>
                <span className="text-[11px] text-white/40 bg-white/5 px-2 py-0.5 rounded-full">{meal.cuisine}</span>
              </div>
              <div className="flex gap-3 flex-wrap text-xs text-white/40">
                <span>💰 {meal.costPerPerson}</span>
                {meal.waitTime && <span>⏳ {meal.waitTime}</span>}
                <span>{meal.reservationRequired === 'yes' ? p.reservationRequired : p.reservationNotRequired}</span>
              </div>
              {meal.tip && <p className="text-xs text-white/40 mt-1 leading-relaxed">{meal.tip}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 숙소 카드
// ────────────────────────────────────────
function AccommodationCard({ acc, p }: { acc: Accommodation; p: any }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">🏨 {p.accommodationLabel}</p>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <span className="text-base">🏨</span>
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base mb-0.5">{acc.name}</p>
          <p className="text-xs text-white/40 mb-2">📍 {acc.area} · {acc.address}</p>
          <div className="bg-emerald-500/10 border-l-2 border-emerald-400/50 rounded-r-xl px-3 py-2 mb-2">
            <p className="text-xs text-emerald-200/80 leading-relaxed">{acc.reason}</p>
          </div>
          <p className="text-xs text-white/50">💰 {acc.priceRange}</p>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 시즌 스폳 배너
// ────────────────────────────────────────
function SeasonalSpotsBanner({ result, lang, p }: { result: PlannerResponse; lang: string; p: any }) {
  const season = result.currentSeason ?? 'spring';
  const data = SEASONAL_SPOTS[season];
  const title = data.title[lang as keyof typeof data.title] ?? data.title.en;
  const subtitle = data.subtitle[lang as keyof typeof data.subtitle] ?? data.subtitle.en;
  const urgency = data.urgency[lang as keyof typeof data.urgency] ?? data.urgency.en;

  return (
    <div className="mt-6 rounded-2xl overflow-hidden border border-emerald-500/25"
      style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(6,182,212,0.07))' }}>
      <div className="px-5 py-4 border-b border-emerald-500/20">
        <p className="font-bold text-white text-base mb-0.5">{title}</p>
        <p className="text-xs text-emerald-300/70">{subtitle}</p>
        <div className="mt-2 inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/25 rounded-full px-3 py-1">
          <span className="text-xs text-amber-200/90 font-medium">{urgency}</span>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto px-5 py-4 pb-5 -mb-1" style={{ scrollbarWidth: 'none' }}>
        {data.spots.map((spot, i) => {
          const name = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.nameEn : spot.name;
          const location = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.locationEn : spot.location;
          const highlight = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.highlightEn : spot.highlight;
          const period = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.periodEn : spot.period;
          const tip = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.tipEn : spot.tip;
          return (
            <div key={i} className="shrink-0 w-64 bg-white/5 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2">
              <div>
                <p className="font-semibold text-white text-sm leading-snug">{name}</p>
                <p className="text-[11px] text-white/40 mt-0.5">📍 {location}</p>
              </div>
              <p className="text-xs text-emerald-200/80 leading-relaxed flex-1">{highlight}</p>
              <div className="space-y-1">
                <p className="text-[11px] text-white/40">⏰ {p.seasonalSpotsPeriod}: <span className="text-white/60">{period}</span></p>
                <p className="text-[11px] text-amber-200/70">💡 {p.seasonalSpotsTip}: {tip}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 pb-4">
        <a href="/planner"
          className="block w-full py-2.5 rounded-xl text-center text-sm font-semibold text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 transition-all duration-300">
          {data.emoji} {p.seasonalSpotsCtaBtn}
        </a>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ K-pop 셔틀 배너
// ────────────────────────────────────────
function KpopShuttleBanner({ p, lang }: { p: any; lang: string }) {
  return (
    <div className="mt-6 rounded-2xl overflow-hidden border border-purple-500/30"
      style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(236,72,153,0.08))' }}>

      <div className="px-5 py-4 border-b border-purple-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎴</span>
            <div>
              <p className="font-bold text-white text-base">{p.kpopShuttleTitle}</p>
              <p className="text-xs text-purple-300/70 mt-0.5">{p.kpopShuttlePrice}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-pink-300">₩{KPOP_SHUTTLE.pricePerPerson.toLocaleString()}</p>
            <p className="text-xs text-white/40">/인</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="mb-3">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">🏟️ Venues</p>
          <div className="flex flex-wrap gap-2">
            {KPOP_SHUTTLE.venues.map((v) => (
              <span key={v.name} className="text-[11px] text-purple-200/70 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-full">
                {v.nameEn}
              </span>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">📍 {p.kpopShuttlePickup}</p>
          <div className="flex flex-wrap gap-2">
            {KPOP_SHUTTLE.pickupPoints.map((pt) => (
              <span key={pt} className="text-[11px] text-pink-200/70 bg-pink-500/10 border border-pink-500/20 px-2.5 py-1 rounded-full">
                {pt}
              </span>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">✅ {p.kpopShuttleIncludes}</p>
          <div className="flex flex-wrap gap-2">
            {KPOP_SHUTTLE.includes.map((inc) => (
              <span key={inc} className="text-[11px] text-white/60 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
                {inc}
              </span>
            ))}
          </div>
        </div>

        <PayPalBookingButton
          productType="kpop_shuttle"
          passengers={2}
          priceKRW={50000}
          p={p}
          lang={lang}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 전세차량 배너 컴포넌트
// ────────────────────────────────────────
function CharterBanner({ result, p, lang }: { result: PlannerResponse; p: any; lang: string }) {
  const [expanded, setExpanded] = useState(false);

  const allPlaces = result.itinerary.flatMap((d) => d.places);
  const detection = detectCharterRecommendation(allPlaces);

  if (!detection.recommended || !detection.pricing) return null;

  const { pricing } = detection;
  const perPersonKRW = Math.round(pricing.priceKRW / 4);
  const perPersonUSD = Math.round(pricing.priceUSD / 4);
  const warning = detection.tourType === 'seoul-city' ? p.charterWarningSeoul : p.charterWarningSuburb;

  return (
    <div className="mt-6 rounded-2xl overflow-hidden border border-blue-500/30"
      style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(6,182,212,0.08))' }}>

      <div className="px-5 py-4 border-b border-blue-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚐</span>
            <div>
              <p className="font-bold text-white text-base">{p.charterTitle}</p>
              <p className="text-xs text-blue-300/70 mt-0.5">{p.charterSubtitle}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-cyan-300">₩{pricing.priceKRW.toLocaleString()}</p>
            <p className="text-xs text-white/40">(≈ ${pricing.priceUSD} USD)</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-3 bg-amber-500/10 border-b border-amber-500/20">
        <p className="text-xs text-amber-200/90 flex items-start gap-1.5">
          <span className="shrink-0 mt-0.5">⚠️</span>
          {warning}
        </p>
      </div>

      <div className="px-5 py-4">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterBasePrice}</p>
            <p className="text-sm font-bold text-white">₩{pricing.priceKRW.toLocaleString()}</p>
            <p className="text-[10px] text-white/30">{pricing.hours}{p.charterHourUnit}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterPerPerson}</p>
            <p className="text-sm font-bold text-cyan-300">₩{perPersonKRW.toLocaleString()}</p>
            <p className="text-[10px] text-white/30">≈ ${perPersonUSD}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterOvertime}</p>
            <p className="text-sm font-bold text-white">₩{EXTRA_CHARGES.overtimePerHour.toLocaleString()}</p>
            <p className="text-[10px] text-white/30">{p.charterOvertimeUnit}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {[p.charterFeat1, p.charterFeat2, p.charterFeat3, p.charterFeat4].map((feat: string) => (
            <span key={feat} className="text-[11px] text-blue-200/70 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full">
              ✓ {feat}
            </span>
          ))}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-white/40 hover:text-cyan-400 transition-colors flex items-center gap-1 mb-3">
          {expanded ? p.charterExtraToggleOpen : p.charterExtraToggleClose}
        </button>

        {expanded && (
          <div className="bg-white/[0.04] rounded-xl p-3 mb-4 space-y-1.5 text-xs text-white/50">
            <p>🌙 {p.charterNight}</p>
            <p>🔄 {p.charterRoundTrip}</p>
            <p>🌟 {p.charterPeakSeason}</p>
            <p>🗣️ {p.charterGuide}</p>
            <p>🪧 {p.charterPicket}</p>
            <p>👶 {p.charterChildSeat}</p>
            <p>🛣️ {p.charterToll}</p>
          </div>
        )}

        <PayPalBookingButton
          productType={(() => {
            const map: Record<string, string> = {
              'seoul-city':      'charter_seoul_city',
              'seoul-suburb':    'charter_seoul_suburb',
              'dmz':             'charter_dmz',
              'gangwon':         'charter_gangwon',
              'ski-resort':      'charter_ski',
              'gyeongju-jeonju': 'charter_gyeongju',
              'busan-day':       'charter_busan',
            };
            return map[detection.tourType ?? ''] ?? 'charter_seoul_suburb';
          })()}
          passengers={1}
          dateStart={result.itinerary[0]?.date ?? ''}
          dateEnd={result.itinerary[result.itinerary.length - 1]?.date ?? ''}
          priceKRW={detection.pricing?.priceKRW ?? 330000}
          p={p}
          lang={lang}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 예산 요약 카드
// ────────────────────────────────────────
function BudgetCard({ budget, p }: { budget: BudgetSummary; p: any }) {
  const items = [
    { label: p.budgetTransport,     value: budget.transport,     icon: '🚌' },
    { label: p.budgetFood,          value: budget.food,          icon: '🍽️' },
    { label: p.budgetAdmission,     value: budget.admission,     icon: '🎟️' },
    { label: p.budgetAccommodation, value: budget.accommodation, icon: '🏨' },
  ];
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4">💰 {p.budgetLabel}</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {items.map((item) => (
          <div key={item.label} className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
            <p className="text-xs text-white/40 mb-1">{item.icon} {item.label}</p>
            <p className="text-sm font-semibold text-white">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-gradient-to-r from-blue-500/15 to-cyan-400/10 border border-cyan-400/25 rounded-xl px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-white/70">{p.budgetTotal}</span>
        <span className="text-base font-bold text-cyan-300">{budget.total}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 하루 팁 섹션
// ────────────────────────────────────────
function DailyTipsSection({ tips, p }: { tips?: string[]; p: any }) {
  if (!tips?.length) return null;
  return (
    <div className="bg-yellow-500/[0.08] border border-yellow-500/20 rounded-2xl px-4 py-3 mb-4">
      <p className="text-xs font-semibold text-yellow-400/70 uppercase tracking-widest mb-2">💡 {p.dailyTipsLabel}</p>
      <ul className="space-y-1">
        {tips.map((tip, i) => (
          <li key={i} className="text-xs text-yellow-100/70 flex items-start gap-1.5">
            <span className="text-yellow-400/60 shrink-0 mt-0.5">·</span>{tip}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 전체 결과 뷰
// ────────────────────────────────────────
function ItineraryResult({ result, onReset, p, lang }: {
  result: PlannerResponse; onReset: () => void; p: any; lang: string;
}) {
  const [activeDay, setActiveDay] = useState(0);
  const current = result.itinerary[activeDay];

  return (
    <div>
      <div className="rounded-2xl border border-white/10 p-5 mb-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(6,182,212,0.08))' }}>
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-t-2xl" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🗺️</span>
            <div>
              <p className="font-bold text-white text-lg">{result.meta.regions.join(' · ')} {p.tripSuffix}</p>
              <p className="text-xs text-white/40 mt-0.5">
                {formatDate(result.meta.startDate, lang)} – {formatDate(result.meta.endDate, lang)}
                &nbsp;·&nbsp;{result.itinerary.length}{p.dayCountSuffix}
                &nbsp;·&nbsp;{result.meta.categories.join(', ')}
              </p>
            </div>
          </div>
          <button onClick={onReset}
            className="shrink-0 text-xs text-white/40 hover:text-cyan-400 transition-colors border border-white/15 hover:border-cyan-400/50 rounded-lg px-3 py-1.5">
            {p.resetBtn}
          </button>
        </div>
      </div>

      {result.accommodation && <AccommodationCard acc={result.accommodation} p={p} />}

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
        {result.itinerary.map((day, idx) => (
          <button key={day.day} onClick={() => setActiveDay(idx)}
            style={activeDay === idx ? { boxShadow: '0 0 16px rgba(59,130,246,0.45)' } : {}}
            className={`shrink-0 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
              activeDay === idx
                ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white'
                : 'bg-white/5 text-white/50 border border-white/15 hover:border-white/30'
            }`}>
            {p.dayLabel} {day.day}
          </button>
        ))}
      </div>

      {current && (
        <div>
          <p className="text-sm font-medium text-white/40 mb-4 font-mono">
            {formatDate(current.date, lang)}&nbsp;·&nbsp;{current.places.length} {p.placesVisit}
          </p>
          <DailyTipsSection tips={current.dailyTips} p={p} />
          <div>
            {current.places.map((place, idx) => (
              <div key={idx}>
                {idx > 0 && <TravelConnector transport={place.transportToNext} p={p} />}
                <PlaceCard place={place} p={p} />
              </div>
            ))}
          </div>
          <MealsSection meals={current.meals} p={p} />
          <div className="flex justify-between mt-8 gap-3">
            <button onClick={() => setActiveDay((d) => Math.max(0, d - 1))} disabled={activeDay === 0}
              className="flex-1 py-3 rounded-xl border border-white/15 text-sm font-medium text-white/60 hover:border-white/30 hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition-all duration-300">
              {p.prevDay}
            </button>
            <button onClick={() => setActiveDay((d) => Math.min(result.itinerary.length - 1, d + 1))} disabled={activeDay === result.itinerary.length - 1}
              className="flex-1 py-3 rounded-xl border border-white/15 text-sm font-medium text-white/60 hover:border-white/30 hover:bg-white/5 disabled:opacity-25 disabled:cursor-not-allowed transition-all duration-300">
              {p.nextDay}
            </button>
          </div>
        </div>
      )}

      <SeasonalSpotsBanner result={result} lang={lang} p={p} />
      <KpopShuttleBanner p={p} lang={lang} />
      <CharterBanner result={result} p={p} lang={lang} />
      {result.budgetSummary && <BudgetCard budget={result.budgetSummary} p={p} />}
    </div>
  );
}

// ────────────────────────────────────────
// 메인 페이지 (기존 구조 유지)
// ────────────────────────────────────────
export default function PlannerPage() {
  const { language, t, changeLanguage } = useLanguage();
  const p = t.planner;

  type Status = 'idle' | 'loading' | 'success' | 'error';
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<PlannerResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastValues = useRef<PlannerFormValues | null>(null);
  const prevLangRef = useRef(language);

  useEffect(() => {
    if (prevLangRef.current !== language && status === 'success' && lastValues.current) {
      prevLangRef.current = language;
      handleSubmit(lastValues.current);
    }
  }, [language]);

  async function handleSubmit(values: PlannerFormValues) {
    lastValues.current = values;
    setStatus('loading');
    setResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/.netlify/functions/generateTravelPlan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, language }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Server error (${res.status})`);
      }
      const data: PlannerResponse = await res.json();
      setResult(data);
      setStatus('success');
      setTimeout(() => {
        document.getElementById('planner-result')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error.');
      setStatus('error');
    }
  }

  function handleReset() {
    setStatus('idle');
    setResult(null);
    setErrorMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="min-h-screen" style={{ background: '#080b14' }}>
      <style>{PAGE_STYLE}</style>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <section className="text-white py-16 px-4"
        style={{ background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}>
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[rgba(124,92,252,.35)] bg-[rgba(124,92,252,.1)] text-[#b09eff] text-[11px] font-semibold tracking-wider uppercase mb-5"
            style={{ animation: 'fade-slide-up 0.5s ease forwards' }}>
            <span>✨</span>{p.badgeLabel}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight text-white mb-4 whitespace-pre-line"
            style={{ animation: 'fade-slide-up 0.6s ease forwards', animationDelay: '0.1s', opacity: 0 }}>{p.heroTitle}</h1>
          <p className="text-white/50 text-sm sm:text-base whitespace-pre-line"
            style={{ animation: 'fade-slide-up 0.6s ease forwards', animationDelay: '0.2s', opacity: 0 }}>{p.heroSubtitle}</p>
        </div>
      </section>
      <main className="max-w-3xl mx-auto px-4 py-12 space-y-10">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 sm:p-10">
          <PlannerForm onSubmit={handleSubmit} isLoading={status === 'loading'} t={t} lang={language} />
        </div>
        {status === 'loading' && <LoadingAnimation p={p} />}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 text-center">
            <p className="text-3xl mb-3">😢</p>
            <p className="font-semibold text-red-300 mb-1">{p.errorTitle}</p>
            <p className="text-sm text-red-400/70 mb-5">{errorMsg}</p>
            <button onClick={handleReset}
              className="px-6 py-2.5 rounded-xl border border-red-400/40 text-red-300 text-sm font-bold hover:bg-red-500/20 transition-colors">
              {p.retry}
            </button>
          </div>
        )}
        {status === 'success' && result && (
          <div id="planner-result">
            <ItineraryResult result={result} onReset={handleReset} p={p} lang={language} />
          </div>
        )}
      </main>
      <Footer t={t} />
    </div>
  );
}
