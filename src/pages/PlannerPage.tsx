import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { detectCharterRecommendation, EXTRA_CHARGES } from '@/data/charterPricing';
import { SEASONAL_SPOTS } from '@/data/seasonalSpots';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { WizardForm } from '@/components/WizardForm';
import type { PlannerFormValues } from '@/components/PlannerForm';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import {
  Music, UtensilsCrossed, Landmark, Sparkles, Leaf, Snowflake, ShoppingBag, Palette,
  Car, Bus as BusIcon, TrainFront, Footprints, MapPin, Clock, Ban, Phone, Banknote,
  Map, CreditCard, Hotel, Lightbulb, CloudRain, AlertTriangle, Search, Plane,
  Check, Calendar, Globe, Target, Ticket, Briefcase, Moon, RefreshCw, Star as StarIcon,
  MessageSquare, Baby, RectangleHorizontal, Navigation, Sun, Sunrise,
  Lock, Camera, Train,
} from 'lucide-react';
import { buildAccommodationLinks, buildTourLinks, buildFlightLink, PICKUP_PRICES } from '@/config/affiliateLinks';
import { usePageMeta } from '@/hooks/usePageMeta';

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
@keyframes trivia-fade {
  0%   { opacity: 0; transform: translateY(8px); }
  15%  { opacity: 1; transform: translateY(0); }
  80%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-6px); }
}
@keyframes indeterminate {
  0%   { left: -35%; right: 100%; }
  60%  { left: 100%; right: -90%; }
  100% { left: 100%; right: -90%; }
}
@keyframes indeterminate2 {
  0%   { left: -200%; right: 100%; }
  60%  { left: 107%; right: -8%; }
  100% { left: 107%; right: -8%; }
}
@keyframes day-fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
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
  naverMapUrl?: string;
}

interface DayItinerary {
  day: number; date: string;
  dailyTips?: string[];
  places: Place[];
  meals?: Meal[];
}

interface Accommodation {
  name: string; area: string; reason: string;
  priceRange: string; address: string;
}

interface BudgetSummary {
  transport: string; food: string;
  admission: string; accommodation: string; total: string;
}

interface CustomerSupport {
  greetingMessage: string;
  paymentPolicy: string;
  cancellationPolicy: string;
  contactInfo: string;
  chatbotResponses?: {
    welcome: string;
    faqs: { q: string; a: string }[];
  };
}

interface PlannerResponse {
  meta: { categories: string[]; regions: string[]; startDate: string; endDate: string; generatedAt: string; estimatedBudget?: any };
  accommodation?: Accommodation;
  budgetSummary?: BudgetSummary;
  itinerary: DayItinerary[];
  currentSeason?: 'spring' | 'summer' | 'autumn' | 'winter';
  enriched?: boolean;
  customerSupport?: CustomerSupport;
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
const CAT_ICON: Record<string, ReactNode> = {
  'K-pop': <Music className="w-3.5 h-3.5" />, 'K-food': <UtensilsCrossed className="w-3.5 h-3.5" />,
  'K-culture': <Landmark className="w-3.5 h-3.5" />, 'K-beauty': <Palette className="w-3.5 h-3.5" />,
  'nature': <Leaf className="w-3.5 h-3.5" />, 'skiing': <Snowflake className="w-3.5 h-3.5" />,
  'shopping': <ShoppingBag className="w-3.5 h-3.5" />, 'heritage': <Landmark className="w-3.5 h-3.5" />,
};
const DATE_LOCALE: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
};
const TRANSPORT_ICON_MAP: Record<string, ReactNode> = {
  bus: <BusIcon className="w-3.5 h-3.5" />, subway: <TrainFront className="w-3.5 h-3.5" />,
  taxi: <Car className="w-3.5 h-3.5" />, walk: <Footprints className="w-3.5 h-3.5" />,
  charter: <Car className="w-3.5 h-3.5" />, default: <Car className="w-3.5 h-3.5" />,
};
const MEAL_ICON_MAP: Record<string, ReactNode> = {
  breakfast: <Sunrise className="w-5 h-5" />, lunch: <Sun className="w-5 h-5" />, dinner: <Moon className="w-5 h-5" />,
};

function formatDate(dateStr: string, lang: string) {
  return new Date(dateStr).toLocaleDateString(DATE_LOCALE[lang] ?? 'en-US', {
    month: 'long', day: 'numeric', weekday: 'short',
  });
}

// ────────────────────────────────────────
// ★ 트리비아 로딩 애니메이션
// ────────────────────────────────────────
function TriviaLoadingAnimation({ p, streamStep, streamAgent }: { p: any, streamStep?: number, streamAgent?: string }) {
  const tips: string[]   = p.loading_tips ?? [];
  const phases: string[] = [p.loading_step1, p.loading_step2, p.loading_step3, p.loading_step4];
  const [tipIdx,   setTipIdx]   = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [visible,  setVisible]  = useState(true);

  const AGENT_DISPLAY_NAMES: Record<string, string> = {
    planner: p.agentPlanner,
    route: p.agentRoute,
    designer: p.agentDesigner,
    marketing: p.agentMarketing,
    qa: p.agentQa,
    cs: p.agentCs,
  };

  useEffect(() => {
    if (!tips.length) return;
    const tipTimer = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setTipIdx(i => (i + 1) % tips.length); setVisible(true); }, 400);
    }, 3400);
    const phaseTimer = setInterval(() => {
      setPhaseIdx(i => Math.min(i + 1, phases.length - 1));
    }, 3000);
    return () => { clearInterval(tipTimer); clearInterval(phaseTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentPhaseText = streamAgent && AGENT_DISPLAY_NAMES[streamAgent] ? AGENT_DISPLAY_NAMES[streamAgent] : phases[phaseIdx];
  const progressPercent = streamStep ? Math.round((streamStep / 6) * 100) : null;

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 100%)' }}>
      <div className="relative h-1 bg-white/8 overflow-hidden">
        {progressPercent ? (
          <div className="absolute h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%`, background: 'linear-gradient(90deg, #7C5CFC, #EA537E)' }} />
        ) : (
          <>
            <div className="absolute h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #7C5CFC, #EA537E)', animation: 'indeterminate 2.1s cubic-bezier(.65,.815,.735,.395) infinite' }} />
            <div className="absolute h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #7C5CFC, #EA537E)', animation: 'indeterminate2 2.1s cubic-bezier(.5,.3,.1,.7) infinite 1.15s' }} />
          </>
        )}
      </div>
      <div className="flex flex-col items-center py-12 px-6 gap-6">
        <div className="relative w-16 h-16 flex items-center justify-center">
          {[0, 1].map((i) => (
            <div key={i} className="absolute inset-0 rounded-full border border-[#7C5CFC]/30"
              style={{ animation: 'pulse-ring 2s ease-out infinite', animationDelay: `${i * 0.8}s` }} />
          ))}
          <Globe className="w-8 h-8 text-[#7C5CFC]" />
        </div>
        <div className="text-center min-h-[52px] flex items-center">
          <p className="text-sm text-white/65 leading-relaxed max-w-xs"
            style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(6px)', transition: 'opacity 0.35s ease, transform 0.35s ease' }}>
            {tips[tipIdx]}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-semibold text-[#7C5CFC] tracking-wider">{currentPhaseText}</p>
          {streamStep && <p className="text-[10px] text-white/40">{(p.streamStepStatus || '').replace('{step}', String(streamStep))}</p>}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 이동수단 배지 (타임라인 사이)
// ────────────────────────────────────────
function TransportBadge({ transport, p }: { transport: TransportToNext; p: any }) {
  const icon = TRANSPORT_ICON_MAP[transport.method] ?? TRANSPORT_ICON_MAP.default;
  const isCharter = transport.charterRecommended === 'yes';
  return (
    <div className="flex items-start gap-3 pl-[22px] py-1.5">
      <div className="flex flex-col items-center shrink-0 mt-1">
        {[0,1,2,3].map(i => <div key={i} className="w-px h-1.5 bg-white/15 my-px" />)}
      </div>
      <div className="flex flex-col gap-1.5 flex-1">
        <span className="inline-flex items-center gap-1.5 text-xs text-white/45 bg-white/[0.04] border border-white/[0.08] px-3 py-1.5 rounded-full w-fit">
          {icon}
          <span>{transport.detail}</span>
          <span className="text-white/25">·</span>
          <span className="text-[#C4956A]/80 font-medium">{transport.costKRW}</span>
          {transport.durationMin > 0 && <>
            <span className="text-white/25">·</span>
            <span className="text-white/40">{transport.durationMin}{p.minuteUnit}</span>
          </>}
        </span>
        {transport.fatigueComment && (
          <div className="flex items-start gap-1.5 bg-amber-500/8 border border-amber-500/15 rounded-lg px-3 py-2 max-w-sm">
            <Briefcase className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/65 leading-relaxed">{transport.fatigueComment}</p>
          </div>
        )}
        {isCharter && transport.charterReason && (
          <div className="flex items-start gap-1.5 bg-blue-500/8 border border-blue-500/15 rounded-lg px-3 py-2 max-w-sm">
            <Car className="w-3.5 h-3.5 text-blue-400/80 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-200/65 leading-relaxed">{transport.charterReason}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 타임라인 장소 카드
// ────────────────────────────────────────
function TimelineCard({ place, index, p }: { place: Place; index: number; p: any }) {
  const badgeClass = CAT_BADGE[place.category] ?? 'bg-white/10 text-white/60 border-white/20';
  const catIcon    = CAT_ICON[place.category] ?? <MapPin className="w-3.5 h-3.5" />;
  const mapQuery = place.address || place.name || '';
  const mapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(mapQuery)}`;

  return (
    <div className="flex items-start gap-3">
      {/* 타임라인 라인 + 번호 */}
      <div className="flex flex-col items-center shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #C4956A, #B8804A)', boxShadow: '0 0 10px rgba(196,149,106,.35)' }}>
          {index + 1}
        </div>
      </div>

      {/* 카드 */}
      <div className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 mb-1 hover:border-white/20 transition-all duration-200">
        <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-white text-base leading-snug">{place.name}</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border inline-flex items-center gap-1 ${badgeClass}`}>
              {catIcon} {place.category}
            </span>
          </div>
          {(place.duration || place.admissionFee) && (
            <div className="flex gap-2 shrink-0">
              {place.duration    && <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Clock className="w-3 h-3" /> {place.duration}</span>}
              {place.admissionFee && <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Ticket className="w-3 h-3" /> {place.admissionFee}</span>}
            </div>
          )}
        </div>

        <p className="text-xs text-white/30 mb-1">{place.nameEn}</p>
        <p className="text-xs text-white/45 mb-3 flex items-start gap-1">
          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />{place.address}
        </p>

        {/* 운영 정보 */}
        {(place.openingHours || (place.closedDays && place.closedDays !== 'None' && place.closedDays !== 'none')) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mb-3">
            {place.openingHours && <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Clock className="w-3 h-3" /> {place.openingHours}</span>}
            {place.closedDays && place.closedDays !== 'None' && place.closedDays !== 'none' &&
              <span className="text-[11px] text-white/35 inline-flex items-center gap-0.5"><Ban className="w-3 h-3" /> {p.placeClosed}: {place.closedDays}</span>}
          </div>
        )}

        {/* 태그 pills */}
        {(place.reservationRequired === 'yes' || place.reservationRequired === 'recommended' || place.cashOnly === 'yes') && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {place.reservationRequired === 'yes' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/12 border border-red-500/25 text-red-300/80 font-medium inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {p.placeReservationRequired}</span>
            )}
            {place.reservationRequired === 'recommended' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/12 border border-yellow-500/25 text-yellow-300/80 font-medium inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" /> {p.placeReservationRecommended}</span>
            )}
            {place.cashOnly === 'yes' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 border border-white/15 text-white/50 font-medium inline-flex items-center gap-0.5"><Banknote className="w-2.5 h-2.5" /> {p.placeCashOnly}</span>
            )}
          </div>
        )}

        {/* 팁 */}
        {place.tips && (
          <div className="border-l-2 border-[rgba(196,149,106,.5)] bg-[rgba(196,149,106,.06)] rounded-r-xl px-3 py-2 mb-3">
            <p className="text-xs text-white/65 leading-relaxed">{place.tips}</p>
          </div>
        )}

        {/* 네이버지도 링크 */}
        <a href={mapUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#03C75A]/30 bg-[#03C75A]/8 text-[#03C75A] text-xs font-medium hover:bg-[#03C75A]/18 transition-colors">
          <Map className="w-3 h-3" /> {p.placeNaverMap}
        </a>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 식사 섹션 (3열 그리드)
// ────────────────────────────────────────
function MealsSection({ meals, p, enriching }: { meals?: Meal[]; p: any; enriching?: boolean }) {
  if (!meals?.length) {
    if (!enriching) return null;
    return (
      <div className="mt-6">
        <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5" /> {p.mealsLabel}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['breakfast', 'lunch', 'dinner'].map((type) => (
            <div key={type} className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-4 animate-pulse">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{MEAL_ICON_MAP[type] ?? <UtensilsCrossed className="w-5 h-5" />}</span>
                <div className="h-3 bg-white/10 rounded w-12" />
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-white/10 rounded w-28" />
                <div className="h-3 bg-white/6 rounded w-20" />
                <div className="h-3 bg-white/6 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5" /> {p.mealsLabel}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {meals.map((meal, i) => {
          const mapUrl = meal.naverMapUrl
            || (meal.address ? `https://map.naver.com/v5/search/${encodeURIComponent(meal.address)}` : null);
          return (
            <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0">{MEAL_ICON_MAP[meal.type] ?? <UtensilsCrossed className="w-5 h-5" />}</span>
                <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">{meal.type}</span>
              </div>
              <p className="text-sm font-bold text-white leading-snug">{meal.restaurantName}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/40">
                <span>{meal.cuisine}</span>
                <span className="inline-flex items-center gap-0.5"><CreditCard className="w-3 h-3" /> {meal.costPerPerson}</span>
                {meal.waitTime && <span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" /> {meal.waitTime}</span>}
              </div>
              {meal.tip && <p className="text-xs text-white/45 leading-relaxed flex-1">{meal.tip}</p>}
              {mapUrl && (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#03C75A]/30 bg-[#03C75A]/8 text-[#03C75A] text-xs font-medium hover:bg-[#03C75A]/18 transition-colors mt-auto w-fit">
                  <Map className="w-3 h-3" /> {p.placeNaverMap}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 숙소 카드
// ────────────────────────────────────────
function AccommodationCard({ acc, p, region }: { acc: Accommodation; p: any; region?: string }) {
  const links = buildAccommodationLinks(acc.name, region ?? acc.area ?? '');
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3 flex items-center gap-1"><Hotel className="w-3.5 h-3.5" /> {p.accommodationLabel}</p>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Hotel className="w-5 h-5 text-emerald-300" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base mb-0.5">{acc.name}</p>
          <p className="text-xs text-white/40 mb-2 flex items-center gap-0.5"><MapPin className="w-3 h-3 shrink-0" /> {acc.area} · {acc.address}</p>
          <div className="bg-emerald-500/10 border-l-2 border-emerald-400/50 rounded-r-xl px-3 py-2 mb-2">
            <p className="text-xs text-emerald-200/80 leading-relaxed">{acc.reason}</p>
          </div>
          <p className="text-xs text-white/50 mb-3 flex items-center gap-0.5"><CreditCard className="w-3 h-3" /> {acc.priceRange}</p>
          {links.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">{p.online_booking}</p>
              <div className="flex flex-wrap gap-2">
                {links.map((lk: any) => (
                  <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90 active:scale-95"
                    style={{ background: lk.color || '#0073E6', color: '#fff' }}>
                    {lk.label} →
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-white/25 leading-relaxed">{p.affiliate_note}</p>
            </div>
          )}
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

  // 사용자가 선택한 지역에 맞는 스폿만 필터링
  const userRegions = result.meta?.regions ?? [];
  const REGION_KEYWORDS: Record<string, string[]> = {
    '서울': ['서울'],
    '경기': ['경기', '가평', '수원', '인천'],
    '인천': ['인천', '영종'],
    '강원': ['강원', '속초', '강릉', '평창', '춘천', '태백', '철원'],
    '부산': ['부산'],
    '경주': ['경주', '경북'],
    '전주': ['전주', '전북', '정읍'],
    '제주': ['제주'],
    '경남': ['경남', '창원', '진해', '하동', '남해', '함양'],
    '충남': ['충남', '보령'],
    '대구': ['대구'],
    '광주': ['광주', '전남', '구례'],
  };

  const filteredSpots = data.spots.filter(spot => {
    if (userRegions.length === 0) return true;
    return userRegions.some(region => {
      const keywords = REGION_KEYWORDS[region] ?? [region];
      return keywords.some(kw => spot.location.includes(kw) || spot.locationEn.toLowerCase().includes(kw.toLowerCase()));
    });
  });

  // 해당 지역에 시즌 스폿이 없으면 배너 숨김
  if (filteredSpots.length === 0) return null;

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
        {filteredSpots.map((spot, i) => {
          const name = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.nameEn : spot.name;
          const location = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.locationEn : spot.location;
          const highlight = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.highlightEn : spot.highlight;
          const period = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.periodEn : spot.period;
          const tip = lang === 'en' || lang === 'ja' || lang === 'zh' ? spot.tipEn : spot.tip;
          return (
            <div key={i} className="shrink-0 w-64 bg-white/5 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2">
              <div>
                <p className="font-semibold text-white text-sm leading-snug">{name}</p>
                <p className="text-[11px] text-white/40 mt-0.5 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5 shrink-0" /> {location}</p>
              </div>
              <p className="text-xs text-emerald-200/80 leading-relaxed flex-1">{highlight}</p>
              <div className="space-y-1">
                <p className="text-[11px] text-white/40 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> {p.seasonalSpotsPeriod}: <span className="text-white/60">{period}</span></p>
                <p className="text-[11px] text-amber-200/70 flex items-center gap-0.5"><Lightbulb className="w-2.5 h-2.5" /> {p.seasonalSpotsTip}: {tip}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ K-pop 셔틀 배너 — REMOVED: shuttle bookings moved to /charter page
// ────────────────────────────────────────
// function KpopShuttleBanner({ p, lang }: { p: any; lang: string }) { ... }

// ────────────────────────────────────────
// ★ 전세차량 배너 컴포넌트
// ────────────────────────────────────────
function CharterBanner({ result, p, lang, vehicleType }: { result: PlannerResponse; p: any; lang: string; vehicleType?: string }) {
  const [expanded, setExpanded] = useState(false);

  const allPlaces = result.itinerary.flatMap((d) => d.places);
  const detection = detectCharterRecommendation(allPlaces);

  if (!detection.recommended || !detection.pricing) return null;

  const { pricing } = detection;
  const days = result.itinerary.length;
  const isBus = vehicleType === 'bus';
  const needsGuide = vehicleType === 'sprinter' || vehicleType === 'bus';
  const guideFeeTotal = needsGuide ? 300000 * days : 0;
  const totalKRW = isBus ? null : pricing.priceKRW + guideFeeTotal;
  const perPersonKRW = totalKRW ? Math.round(totalKRW / 4) : null;
  const perPersonUSD = Math.round(pricing.priceUSD / 4);
  const warning = detection.tourType === 'seoul-city' ? p.charterWarningSeoul : p.charterWarningSuburb;

  return (
    <div className="mt-6 rounded-2xl overflow-hidden border border-blue-500/30"
      style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(6,182,212,0.08))' }}>

      <div className="px-5 py-4 border-b border-blue-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Car className="w-6 h-6 text-blue-300" />
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
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
          {warning}
        </p>
      </div>

      <div className="px-5 py-4">
        {needsGuide && (
          <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
            <p className="text-xs text-amber-200/80">
              <AlertTriangle className="w-3 h-3 inline text-amber-400" /> {p.vehicleGuideNote}
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterBasePrice}</p>
            {isBus ? (
              <p className="text-sm font-bold text-white">{p.vehicleCustomQuote}</p>
            ) : (
              <>
                <p className="text-sm font-bold text-white">₩{pricing.priceKRW.toLocaleString()}</p>
                {needsGuide && <p className="text-[10px] text-amber-300/70">+₩{guideFeeTotal.toLocaleString()} {p.vehicleGuideRequired}</p>}
              </>
            )}
            <p className="text-[10px] text-white/30">{pricing.hours}{p.charterHourUnit}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <p className="text-xs text-white/40 mb-1">{p.charterPerPerson}</p>
            {isBus ? (
              <p className="text-sm font-bold text-white">-</p>
            ) : (
              <>
                <p className="text-sm font-bold text-cyan-300">₩{perPersonKRW!.toLocaleString()}</p>
                <p className="text-[10px] text-white/30">≈ ${perPersonUSD}</p>
              </>
            )}
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
              <Check className="w-3 h-3 inline" /> {feat}
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
            <p className="flex items-center gap-1"><Moon className="w-3.5 h-3.5" /> {p.charterNight}</p>
            <p className="flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> {p.charterRoundTrip}</p>
            <p className="flex items-center gap-1"><StarIcon className="w-3.5 h-3.5" /> {p.charterPeakSeason}</p>
            <p className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {p.charterGuide}</p>
            <p className="flex items-center gap-1"><RectangleHorizontal className="w-3.5 h-3.5" /> {p.charterPicket}</p>
            <p className="flex items-center gap-1"><Baby className="w-3.5 h-3.5" /> {p.charterChildSeat}</p>
            <p className="flex items-center gap-1"><Navigation className="w-3.5 h-3.5" /> {p.charterToll}</p>
          </div>
        )}

        {isBus ? (
          <a
            href="https://wa.me/821099339020"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all duration-300 hover:opacity-90 hover:scale-[1.01]"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', boxShadow: '0 4px 20px rgba(59,130,246,0.35)' }}>
            <BusIcon className="w-4 h-4 inline" /> {p.vehicleCustomQuote}
          </a>
        ) : (
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
            priceKRW={totalKRW ?? (detection.pricing?.priceKRW ?? 330000)}
            p={p}
            lang={lang}
            pickupLocation={result.meta?.regions?.[0] ?? ''}
            dropoffLocation={detection.pricing?.ko ?? detection.tourType ?? ''}
            vehicleType={vehicleType ?? 'staria'}
            memo={`AI Planner: ${result.meta?.regions?.join(', ') ?? ''}`}
            itineraryData={result.itinerary}
          />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 예산 요약 카드
// ────────────────────────────────────────
function BudgetCard({ budget, p }: { budget: BudgetSummary; p: any }) {
  const items = [
    { label: p.budgetTransport,     value: budget.transport,     icon: <BusIcon className="w-4 h-4" /> },
    { label: p.budgetFood,          value: budget.food,          icon: <UtensilsCrossed className="w-4 h-4" /> },
    { label: p.budgetAdmission,     value: budget.admission,     icon: <Ticket className="w-4 h-4" /> },
    { label: p.budgetAccommodation, value: budget.accommodation, icon: <Hotel className="w-4 h-4" /> },
  ];
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4 flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> {p.budgetLabel}</p>
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
      <p className="text-xs font-semibold text-yellow-400/70 uppercase tracking-widest mb-2 flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> {p.dailyTipsLabel}</p>
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
// ★ 우천 대안 아코디언
// ────────────────────────────────────────
function RainyDaySection({ places, p }: { places: Place[]; p: any }) {
  const [open, setOpen] = useState(false);
  const alts = places.filter(pl => pl.rainyAlternative);
  if (!alts.length) return null;
  return (
    <div className="mt-4 rounded-2xl border border-blue-500/15 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-blue-500/[0.06] hover:bg-blue-500/[0.10] transition-colors">
        <span className="text-sm text-blue-300/65 font-medium flex items-center gap-1"><CloudRain className="w-4 h-4" /> {p.result_rainy}</span>
        <span className="text-white/25 text-xs">{open ? '▲' : '▶'}</span>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-blue-500/10">
          {alts.map((place, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-blue-400/50 shrink-0 mt-0.5 text-sm">·</span>
              <div>
                <p className="text-xs font-semibold text-blue-200/60">{place.name}</p>
                <p className="text-xs text-blue-200/40 mt-0.5 leading-relaxed">{place.rainyAlternative}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// ★ Enriching 배너
// ────────────────────────────────────────
function EnrichingBanner({ visible, p }: { visible: boolean; p: any }) {
  if (!visible) return null;
  return (
    <div className="rounded-2xl border border-[rgba(196,149,106,.25)] overflow-hidden mb-6"
      style={{ background: 'rgba(196,149,106,0.06)', opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease' }}>
      <div className="relative h-0.5 bg-white/8 overflow-hidden">
        <div className="absolute h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #C4956A, #D4915C)', animation: 'indeterminate 2.1s cubic-bezier(.65,.815,.735,.395) infinite' }} />
        <div className="absolute h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #C4956A, #D4915C)', animation: 'indeterminate2 2.1s cubic-bezier(.5,.3,.1,.7) infinite 1.15s' }} />
      </div>
      <p className="text-xs text-[#C4956A]/80 text-center py-3 font-medium">
        <UtensilsCrossed className="w-3.5 h-3.5 inline" /> {p.enriching_message}
      </p>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 공항 픽업 유도 카드
// ────────────────────────────────────────
function AirportPickupCard({ arrivalAirport, p, lang }: { arrivalAirport?: string; p: any; lang: string }) {
  const code = arrivalAirport ?? 'ICN';
  const prices: { destination: string; price: string }[] = PICKUP_PRICES[code] ?? PICKUP_PRICES['ICN'];
  const [selectedDest, setSelectedDest] = useState<string | null>(null);

  const selectedPrice = selectedDest
    ? prices.find(r => r.destination === selectedDest)
    : null;
  const priceKRW = selectedPrice
    ? parseInt(selectedPrice.price.replace(/[^\d]/g, ''), 10)
    : 0;

  return (
    <div className="rounded-2xl border border-[rgba(196,149,106,.3)] p-5 mt-6"
      style={{ background: 'linear-gradient(135deg, rgba(196,149,106,0.08) 0%, rgba(10,16,32,0.95) 100%)' }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[rgba(196,149,106,.15)] border border-[rgba(196,149,106,.3)] flex items-center justify-center shrink-0">
          <Plane className="w-6 h-6 text-[#C4956A]" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight mb-0.5">{p.airport_pickup_title}</p>
          <p className="text-xs text-[#D4A574]/80 font-medium">{p.airport_pickup_desc}</p>
          <p className="text-[11px] text-white/40 mt-1">{p.airport_pickup_driver}</p>
        </div>
        <span className="shrink-0 text-[10px] text-[#C4956A] border border-[rgba(196,149,106,.35)] rounded-full px-2.5 py-1 font-semibold">{code}</span>
      </div>

      <p className="text-xs text-white/40 mb-2">{p.airport_pickup_select}</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {prices.map((row, i) => (
          <button key={i} type="button" onClick={() => setSelectedDest(row.destination)}
            className={`rounded-xl px-3 py-2 flex items-center gap-2 border transition-all duration-200 ${
              selectedDest === row.destination
                ? 'border-[#C4956A] bg-[rgba(196,149,106,.12)] text-[#D4A574]'
                : 'bg-white/[0.04] border-white/10 hover:border-white/25'
            }`}>
            <span className="text-xs text-white/50">{row.destination}</span>
            <span className={`text-xs font-bold ${selectedDest === row.destination ? 'text-[#C4956A]' : 'text-[#D4A574]'}`}>{row.price}</span>
          </button>
        ))}
      </div>

      {selectedDest && priceKRW > 0 ? (
        <PayPalBookingButton
          productType={`airport_${code.toLowerCase()}_${selectedDest.replace(/[^a-zA-Z가-힣]/g, '_').toLowerCase()}`}
          passengers={1}
          dateStart=""
          dateEnd=""
          priceKRW={priceKRW}
          p={p}
          lang={lang}
          pickupLocation={code}
          dropoffLocation={selectedDest}
          vehicleType="staria"
          memo={`Airport Pickup: ${code} → ${selectedDest}`}
        />
      ) : (
        <p className="text-xs text-white/30 text-center py-2">{p.airport_pickup_select_hint}</p>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// ★ 추천 투어·티켓 섹션
// ────────────────────────────────────────
const TOUR_CATS = new Set(['관광', '문화', '체험', '자연', '문화/역사', '액티비티']);

function TourRecommendationsSection({ result, p }: { result: PlannerResponse; p: any }) {
  const region = result.meta.regions[0] ?? '';
  const tourPlaces = result.itinerary
    .flatMap(d => d.places)
    .filter(pl => TOUR_CATS.has(pl.category ?? ''))
    .slice(0, 6);

  if (!tourPlaces.length) return null;
  const firstLinks = buildTourLinks(tourPlaces[0].name, region);
  if (!firstLinks.length) return null;

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1"><Palette className="w-3.5 h-3.5" /> {p.tour_section_title}</p>
      <p className="text-[11px] text-white/35 mb-4">{p.tour_section_desc}</p>
      <div className="space-y-3">
        {tourPlaces.map((pl, i) => {
          const links = buildTourLinks(pl.name, region);
          if (!links.length) return null;
          return (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-white/[0.06] last:border-0">
              <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center shrink-0 text-sm">
                {CAT_ICON[pl.category ?? ''] ?? <MapPin className="w-3.5 h-3.5" />}
              </div>
              <span className="flex-1 text-sm text-white/65 font-medium truncate">{pl.name}</span>
              <div className="flex gap-1.5 shrink-0">
                {links.map((lk: any) => (
                  <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all hover:opacity-90 ${
                      lk.provider === 'klook'
                        ? 'bg-[#FF5722] text-white'
                        : 'bg-[#1A3C6E] text-white'
                    }`}>
                    {lk.label}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-white/20 mt-3 leading-relaxed">{p.affiliate_note}</p>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 항공편 검색 섹션
// ────────────────────────────────────────
function FlightSearchSection({ arrivalAirport, p }: { arrivalAirport?: string; p: any }) {
  const link = buildFlightLink(arrivalAirport ?? 'ICN');
  if (!link) return null;
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 mt-6">
      <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1"><Plane className="w-3.5 h-3.5" /> {p.flight_section_title}</p>
      <p className="text-[11px] text-white/35 mb-4">{p.flight_section_desc}</p>
      <a href={link.url} target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
        style={{ background: '#FBCE04', color: '#000' }}>
        <Search className="w-4 h-4" /> {link.label}
      </a>
      <p className="text-[10px] text-white/20 mt-2 text-center">{p.affiliate_note}</p>
    </div>
  );
}

// ────────────────────────────────────────
// ★ eSIM 추천 섹션
// ────────────────────────────────────────
function EsimSection({ p, isMobile }: { p: any; isMobile: boolean }) {
  const esimLinks = [
    { name: 'Airalo', url: 'https://www.airalo.com/south-korea', color: '#FF6B35' },
    { name: 'Yesim', url: 'https://yesim.app/', color: '#4CAF50' },
  ];
  return (
    <div className={`rounded-2xl overflow-hidden border mt-6 ${isMobile ? 'border-[#B668FC]/25' : 'border-cyan-500/25'}`}
      style={{ background: isMobile
        ? 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.05))'
        : 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.05))'
      }}>
      <div className="px-5 py-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isMobile ? 'bg-[#B668FC]/20 border border-[#B668FC]/30' : 'bg-cyan-500/20 border border-cyan-500/30'}`}>
          <Phone className={`w-5 h-5 ${isMobile ? 'text-[#B668FC]' : 'text-cyan-300'}`} />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight">{p.esimTitle || 'Got your Korea eSIM ready?'}</p>
          <p className="text-xs text-white/50 mt-0.5">{p.esimDesc || 'Buy an eSIM before landing and stay connected.'}</p>
        </div>
      </div>
      <div className="px-5 pb-4 flex gap-2">
        {esimLinks.map((link) => (
          <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95"
            style={{ background: link.color, boxShadow: `0 4px 16px ${link.color}40` }}>
            {link.name} →
          </a>
        ))}
      </div>
      <p className="text-[10px] text-white/20 text-center pb-3 px-5">{p.esimNote || 'Purchasing via these links helps support CocoTrip.'}</p>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 고객지원 & 결제 정책 (CSAgent)
// ────────────────────────────────────────
function CustomerSupportSection({ cs, p }: { cs?: CustomerSupport; p: any }) {
  if (!cs) return null;
  return (
    <div className="bg-[#1A233A]/80 border border-[#C4956A]/30 rounded-2xl p-6 mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-white text-lg flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-[#C4956A]" /> {p.csSectionTitle}
        </h3>
      </div>
      
      <p className="text-sm text-white/80 leading-relaxed mb-6 italic border-l-2 border-[#C4956A] pl-3">"{cs.greetingMessage}"</p>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white/[0.04] rounded-xl p-4 border border-white/5">
          <p className="text-xs text-[#C4956A] uppercase tracking-wider font-bold mb-2 flex items-center gap-1"><CreditCard className="w-4 h-4"/> {p.csPaymentPolicy}</p>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{cs.paymentPolicy}</p>
        </div>
        <div className="bg-white/[0.04] rounded-xl p-4 border border-white/5">
          <p className="text-xs text-[#C4956A] uppercase tracking-wider font-bold mb-2 flex items-center gap-1"><Ban className="w-4 h-4"/> {p.csCancelPolicy}</p>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{cs.cancellationPolicy}</p>
        </div>
      </div>

      <div className="bg-[rgba(3,199,90,0.05)] border border-[#03C75A]/20 rounded-xl p-4 mb-6">
        <p className="text-xs text-[#03C75A] font-bold mb-2 flex items-center gap-1"><MessageSquare className="w-4 h-4" /> {p.csBotTitle}</p>
        <p className="text-[11px] text-white/60 mb-3 block">{p.csBotDesc}</p>
        
        {cs.chatbotResponses && (
          <div className="mb-3 p-3 bg-white/5 rounded-lg border border-white/10">
            <p className="text-xs text-white/40 mb-1">{p.csBotWelcome}</p>
            <p className="text-sm text-[#03C75A]/90">{cs.chatbotResponses.welcome}</p>
          </div>
        )}

        <div className="space-y-2">
          {cs.chatbotResponses?.faqs?.map((faq, i) => (
            <div key={i} className="pl-3 border-l text-sm">
              <p className="font-semibold text-white/80">Q: {faq.q}</p>
              <p className="text-white/60 mt-1">A: {faq.a}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs text-white/40 p-3 bg-black/20 rounded-xl">
        <p className="flex items-center gap-1 font-semibold text-white/50"><Phone className="w-3.5 h-3.5" /> {p.csEmergencyContact}</p>
        <p>{cs.contactInfo}</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 프리미엄 콤보 할인 배너
// ────────────────────────────────────────
function ComboPackageBanner({ p }: { p: any }) {
  return (
    <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/30 rounded-2xl p-6 mt-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg shadow-lg">{p.comboSaveBadge}</div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
          <Ticket className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h3 className="font-bold text-white text-base">{p.comboTitle}</h3>
          <p className="text-xs text-amber-200/80 mt-0.5">{p.comboSubtitle}</p>
        </div>
      </div>
      
      <div className="bg-black/30 rounded-xl p-4 mb-4 border border-white/5">
        <div className="flex justify-between text-xs text-white/50 mb-2">
          <span>{p.comboCompareLabel}</span>
          <span className="line-through">₩450,000</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-white">{p.comboDirectLabel}</span>
          <span className="text-lg font-bold text-amber-400">₩380,000</span>
        </div>
      </div>
      
      <div className="flex flex-col gap-2">
        <a href="https://wa.me/821087140611?text=Hi!%20I'm%20interested%20in%20the%20Premium%20Combo%20Package.%20Please%20send%20me%20details." target="_blank" rel="noopener noreferrer"
          className="flex flex-col items-center justify-center gap-0.5 w-full py-3.5 rounded-xl text-sm font-bold shadow-2xl transition-all hover:scale-[1.02] cursor-pointer no-underline"
          style={{ background: '#FFC439', color: '#003087', boxShadow: '0 8px 30px rgba(255,196,57,0.3)' }}>
          <span className="flex items-center gap-2">{p.comboCta}</span>
        </a>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-1 text-[11px] text-white/70 font-medium">
          <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> {p.checkoutSafe}</span>
          <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> {p.checkoutTip1}</span>
          <span className="flex items-center gap-1"><Ban className="w-3 h-3 text-red-400" /> {p.checkoutTip2}</span>
        </div>
        <div className="text-center mt-3">
          <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer" className="text-[11px] text-white/30 hover:text-white/50 transition-colors underline">
            {p.comboHelp}
          </a>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// ★ 전체 결과 뷰
// ────────────────────────────────────────
// REMOVED: KpopShuttleBanner logic moved to /charter page
// const KPOP_VENUE_KEYWORDS = [...];
// function shouldShowKpopBanner(result) { ... }

export function ItineraryResult({ result, onReset, p, lang, transport, enriching, arrivalAirport }: {
  result: PlannerResponse; onReset: () => void; p: any; lang: string; transport?: string; enriching?: boolean; arrivalAirport?: string;
}) {
  const isMobile = useIsMobile();
  const [activeDay, setActiveDay] = useState(0);
  const current = result.itinerary[activeDay];

  const nights = Math.round(
    (new Date(result.meta.endDate).getTime() - new Date(result.meta.startDate).getTime()) / 86400000
  );
  const tripTitle = (p.tripTitleFormat || '')
    .replace('{nights}', String(nights))
    .replace('{days}', String(nights + 1))
    .replace('{regions}', result.meta.regions.join('·'));

  return (
    <div style={{ animation: 'fade-slide-up 0.5s ease forwards' }}>
      {/* ── Hero 영역 ── */}
      <div className={`rounded-2xl border p-6 mb-5 relative overflow-hidden ${isMobile ? 'border-[#B668FC]/20 m-appear' : 'border-white/10'}`}
        style={{ background: isMobile
          ? 'linear-gradient(135deg, rgba(182,104,252,0.10) 0%, rgba(10,4,18,0.95) 60%)'
          : 'linear-gradient(135deg, rgba(196,149,106,0.10) 0%, rgba(12,18,32,0.95) 60%)' }}>
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
          style={{ background: isMobile ? 'linear-gradient(90deg, #B668FC, #FF6B9D)' : 'linear-gradient(90deg, #C4956A, #D4915C)' }} />
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className={`font-bold text-xl leading-tight ${isMobile ? 'm-shimmer-text' : 'text-white'}`}>{tripTitle}</h2>
          <button onClick={onReset}
            className={`shrink-0 text-xs transition-colors border rounded-lg px-3 py-1.5 ${isMobile ? 'text-white/35 hover:text-[#B668FC] border-white/12 hover:border-[#B668FC]/40' : 'text-white/35 hover:text-[#C4956A] border-white/12 hover:border-[rgba(196,149,106,.4)]'}`}>
            {p.resetBtn}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { icon: <Calendar className="w-3.5 h-3.5" />, text: `${formatDate(result.meta.startDate, lang)} – ${formatDate(result.meta.endDate, lang)}` },
            { icon: <Globe className="w-3.5 h-3.5" />, text: result.meta.regions.join(' · ') },
            ...result.meta.categories.map(c => ({ icon: CAT_ICON[c] ?? <Target className="w-3.5 h-3.5" />, text: c })),
          ].map((chip, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-white/50 bg-white/[0.06] border border-white/[0.08] px-2.5 py-1 rounded-full">
              {chip.icon} {chip.text}
            </span>
          ))}
        </div>
      </div>

      {/* ── Enriching 배너 ── */}
      <EnrichingBanner visible={!!enriching} p={p} />

      {/* ── Day 탭 ── */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        {result.itinerary.map((day, idx) => (
          <button key={day.day} onClick={() => setActiveDay(idx)}
            className={`shrink-0 flex flex-col items-center px-4 py-2.5 rounded-2xl border text-sm font-semibold transition-all duration-300 min-w-[72px] ${
              activeDay === idx
                ? (isMobile ? 'border-[#B668FC]/50 text-[#B668FC]' : 'border-[rgba(196,149,106,.5)] text-[#D4A574]')
                : 'border-white/10 bg-white/[0.04] text-white/40 hover:border-white/22 hover:text-white/60'
            }`}
            style={activeDay === idx ? (isMobile
              ? { background: 'rgba(182,104,252,0.10)', boxShadow: '0 0 16px rgba(182,104,252,.2)' }
              : { background: 'rgba(196,149,106,0.10)', boxShadow: '0 0 16px rgba(196,149,106,.2)' }
            ) : {}}>
            <span className="text-xs font-bold">{p.dayLabel ?? 'Day'} {day.day}</span>
            <span className="text-[10px] font-normal opacity-70 mt-0.5">{day.date?.slice(5)}</span>
          </button>
        ))}
      </div>

      {/* ── 현재 Day 콘텐츠 ── */}
      {current && (
        <div key={activeDay} className="relative" style={{ animation: 'day-fade-in 0.3s ease forwards' }}>
          <div className={`transition-all duration-500 ${activeDay > 0 ? 'blur-md pointer-events-none opacity-40' : ''}`}>
            {/* 날짜 헤더 */}
            <p className="text-sm text-white/35 mb-4 flex items-center gap-2">
              <span>{formatDate(current.date, lang)}</span>
              <span className="text-white/15">·</span>
              <span>{current.places.length} {p.placesUnit}</span>
            </p>

            {/* 하루 팁 */}
            <DailyTipsSection tips={current.dailyTips} p={p} />

            {/* 타임라인 */}
            <div className="space-y-0.5 mb-2">
              {current.places.map((place, idx) => (
                <div key={idx}>
                  <TimelineCard place={place} index={idx} p={p} />
                  {idx < current.places.length - 1 && place.transportToNext && (
                    <TransportBadge transport={place.transportToNext} p={p} />
                  )}
                </div>
              ))}
            </div>
        {/* 우천 대안 */}
            <RainyDaySection places={current.places} p={p} />

            {/* 식사 */}
            <MealsSection meals={current.meals} p={p} enriching={enriching} />
          </div>

          {/* 자물쇠 오버레이 (페이월) */}
          {activeDay > 0 && (
            <div className="absolute inset-0 flex flex-col items-center pt-24 text-center z-10 px-4">
              <div className={`rounded-3xl p-6 sm:p-8 max-w-sm backdrop-blur-xl w-full ${isMobile ? 'bg-[#0a0412]/95 border border-[#B668FC]/40 shadow-[0_0_40px_rgba(182,104,252,0.15)]' : 'bg-[#121826]/95 border border-[#C4956A]/40 shadow-[0_0_40px_rgba(196,149,106,0.15)]'}`}>
                <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-5 shadow-lg ${isMobile ? 'bg-gradient-to-br from-[#B668FC] to-[#FF6B9D] shadow-[#B668FC]/20' : 'bg-gradient-to-br from-[#C4956A] to-[#D4A574] shadow-[#C4956A]/20'}`}>
                  <Lock className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-[17px] font-bold text-white mb-2 leading-tight">{p.paywallTitle}</h3>
                <p className="text-[13px] text-white/70 mb-5 leading-relaxed">
                  {p.paywallDesc}<br/>
                  <b>{p.paywallOffer}</b><br/>
                  <span className={`font-medium mt-1.5 block ${isMobile ? 'text-[#B668FC]' : 'text-[#C4956A]'}`}>{p.paywallGuarantee}</span>
                </p>
                <div className="flex flex-col gap-2.5">
                  <button onClick={() => document.getElementById('airport-pickup-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-400 text-black text-[13px] font-extrabold shadow-lg hover:scale-[1.02] transition-transform">
                    {p.paywallComboBtn}
                  </button>
                  <button onClick={() => document.getElementById('charter-banner-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="w-full py-3 rounded-xl bg-white/10 border border-white/20 text-white text-[13px] font-bold hover:bg-white/20 transition-all">
                    {p.paywallSingleBtn}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Prev / Next */}
          <div className="flex gap-3 mt-7">
            <button onClick={() => setActiveDay(d => Math.max(0, d - 1))} disabled={activeDay === 0}
              className="flex-1 py-3 rounded-xl border border-white/12 text-sm font-medium text-white/50 hover:border-white/25 hover:bg-white/[0.04] disabled:opacity-20 disabled:cursor-not-allowed transition-all min-h-[44px]">
              {p.prevDay}
            </button>
            <button onClick={() => setActiveDay(d => Math.min(result.itinerary.length - 1, d + 1))} disabled={activeDay === result.itinerary.length - 1}
              className="flex-1 py-3 rounded-xl border border-white/12 text-sm font-medium text-white/50 hover:border-white/25 hover:bg-white/[0.04] disabled:opacity-20 disabled:cursor-not-allowed transition-all min-h-[44px]">
              {p.nextDay}
            </button>
          </div>
        </div>
      )}

      {/* ── 숙소 카드 ── */}
      {result.accommodation
        ? <AccommodationCard acc={result.accommodation} p={p} region={result.meta.regions[0]} />
        : enriching && (
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 mt-6 animate-pulse">
            <div className="h-3 bg-white/10 rounded w-28 mb-4" />
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-white/10 shrink-0" />
              <div className="flex-1 space-y-2.5">
                <div className="h-4 bg-white/10 rounded w-40" />
                <div className="h-3 bg-white/6 rounded w-52" />
                <div className="h-12 bg-white/6 rounded" />
              </div>
            </div>
          </div>
        )
      }

      {/* ── 예산 요약 ── */}
      {result.budgetSummary
        ? <BudgetCard budget={result.budgetSummary} p={p} />
        : enriching && (
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 mt-6 animate-pulse">
            <div className="h-3 bg-white/10 rounded w-24 mb-4" />
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[1,2,3,4].map(i => <div key={i} className="h-12 bg-white/6 rounded-xl" />)}
            </div>
            <div className="h-12 bg-white/8 rounded-xl" />
          </div>
        )
      }

      <SeasonalSpotsBanner result={result} lang={lang} p={p} />

      {/* ── 추천 투어·티켓 ── */}
      <TourRecommendationsSection result={result} p={p} />

      {/* ── 항공편 검색 ── */}
      <FlightSearchSection arrivalAirport={arrivalAirport} p={p} />

      {/* ── eSIM 추천 ── */}
      <EsimSection p={p} isMobile={isMobile} />

      {/* ── 고객지원 및 환불 규정 ── */}
      {!enriching && <CustomerSupportSection cs={result.customerSupport} p={p} />}

      {/* ── 예약 섹션 (맨 아래) ── */}
      {!enriching && <ComboPackageBanner p={p} />}
      {!enriching && <div id="charter-banner-section"><CharterBanner result={result} p={p} lang={lang} vehicleType={transport} /></div>}
      <div id="airport-pickup-section"><AirportPickupCard arrivalAirport={arrivalAirport} p={p} lang={lang} /></div>
    </div>
  );
}

// ────────────────────────────────────────
// 메인 페이지 (기존 구조 유지)
// ────────────────────────────────────────
// 도시 이름 → API area key 변환
function cityNameToAreaKey(cityName: string): string {
  const name = (cityName || '').toLowerCase().trim();
  if (name.includes('seoul')) return 'seoul_city';
  if (name.includes('busan')) return 'busan';
  if (name.includes('jeju')) return 'jeju';
  if (name.includes('gyeongju')) return 'gyeongju';
  if (name.includes('incheon')) return 'incheon';
  if (name.includes('suwon')) return 'suwon';
  if (name.includes('jeonju')) return 'jeonju';
  if (name.includes('gangneung') || name.includes('강릉')) return 'gangneung';
  if (name.includes('yeosu')) return 'yeosu';
  if (name.includes('daegu')) return 'daegu';
  if (name.includes('daejeon')) return 'daejeon';
  if (name.includes('gwangju')) return 'gwangju';
  return name || 'seoul_city';
}

export default function PlannerPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const p = t.planner;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const preset = searchParams.get('preset') ?? undefined;
  const revisionMode = searchParams.get('revision') === 'true';
  const revisionPlanId = searchParams.get('planId') ?? null;
  const revisionToken = searchParams.get('token') ?? null;

  usePageMeta({
    title: 'AI Travel Planner — Custom Korea Itinerary',
    description: 'Create your personalized Korea travel itinerary with AI. Free, instant, multi-language support. Seoul, Busan, Jeju and more.',
    ogImage: '/hero-seoul-real.webp',
  });

  type Status = 'idle' | 'loadingQuick' | 'quickSuccess' | 'loadingFull' | 'fullSuccess' | 'error';
  const [status, setStatus] = useState<Status>('idle');
  const [resultQuick, setResultQuick] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, setStreamStep] = useState<number>(0);
  const [, setStreamAgent] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const lastValues = useRef<PlannerFormValues | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<'A' | 'B'>('A');
  const [optionBStep, setOptionBStep] = useState<1 | 2 | 3>(1);

  // 1단계: Quick preview (무료) — ai-planner-quick 호출 (자동 재시도 포함)
  async function handleSubmit(values: PlannerFormValues) {
    lastValues.current = values;
    setStatus('loadingQuick');
    setResultQuick(null);
    setErrorMsg(null);
    setStreamStep(1);
    setStreamAgent('gemini');
    
    const MAX_RETRIES = 2;
    const payload = JSON.stringify({ 
      destination: (values.regions || []).join(', ') || 'Seoul',
      preferences: (values.categories || []).join(', ') || '',
      categories: values.categories || ['culture'],
      durationDays: values.durationDays || 3,
      pax: values.pax || 2,
      language,
      regions: values.regions || ['Seoul'],
      dietPrefs: values.dietPrefs || [],
      allergies: values.allergies || [],
      priceRange: values.priceRange || 'Any',
      special_request: (values as any).freeText || '',
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch('/api/ai-planner-quick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg = errBody.details || errBody.error || `Server error (${res.status})`;
          // 404/502/503은 Vercel cold start 가능성 → 재시도
          if ((res.status === 404 || res.status >= 500) && attempt < MAX_RETRIES) {
            console.warn(`[Planner] Attempt ${attempt + 1} got ${res.status}, retrying in 1.5s...`);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          throw new Error(msg);
        }

        const data = await res.json();
        setResultQuick(data);
        setStatus('quickSuccess');
        setTimeout(() => {
          document.getElementById('planner-quick-result')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        return; // 성공 시 함수 종료
      } catch (err) {
        if (attempt < MAX_RETRIES && err instanceof TypeError) {
          // 네트워크 에러 (fetch 자체 실패) → 재시도
          console.warn(`[Planner] Network error on attempt ${attempt + 1}, retrying...`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        setErrorMsg(err instanceof Error ? err.message : 'Unknown error.');
        setStatus('error');
        return;
      }
    }
  }

  // 2단계: PayPal 결제 성공 후 → Full AI 플랜 생성 (유료)
  async function handlePaymentSuccess(paypalOrderId: string) {
    setIsGeneratingPlan(true);
    setPlanError(null);
    setStreamStep(1);
    setStreamAgent('gemini');

    const values = lastValues.current;
    if (!values) {
      setPlanError('Form data missing. Please try again.');
      setIsGeneratingPlan(false);
      return;
    }

    try {
      // 120초 타임아웃 — Vercel 함수 실패 시 무한 스피너 방지
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          paypalOrderId,
          guestName: 'Guest',
          email: userEmail,
          startDate: values.startDate,
          endDate: values.endDate,
          destination: (values.regions || []).join(', ') || 'Seoul',
          area: cityNameToAreaKey((values.regions || ['Seoul'])[0]),
          preferences: (values.categories || []).join(', ') || '',
          styles: values.categories || ['culture'],
          durationDays: values.durationDays || 3,
          pax: values.pax || 2,
          language,
          arrival_airport: (values as any).arrival_airport || '',
          departure_airport: (values as any).departure_airport || '',
          hotel_address: (values as any).hotel_address || '',
          mobility: (values as any).mobility || 'ok',
          uid: (values as any).uid || null,
          dietPrefs: values.dietPrefs || [],
          allergies: values.allergies || [],
          priceRange: values.priceRange || 'Any',
          special_request: (values as any).freeText || '',
        }),
      });

      clearTimeout(timeoutId);

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server returned invalid response (${res.status}). Please contact us via WhatsApp.`);
      }

      if (!res.ok) {
        throw new Error(data.details || data.error || `Server error (${res.status})`);
      }

      setStreamStep(4);
      setStreamAgent('done');

      if (data.planUrl) {
        navigate(data.planUrl);
      } else if (data.planId) {
        navigate(`/my-plans/${data.planId}`);
      } else {
        throw new Error('Plan created but no URL returned');
      }
    } catch (err: any) {
      console.error('[PlannerPage] Plan generation failed:', err);
      const msg = err.name === 'AbortError'
        ? 'Server took too long (120s). Your payment is safe — please contact us via WhatsApp to get your plan.'
        : (err.message || 'Something went wrong. Please contact us via WhatsApp.');
      setPlanError(msg);
      setIsGeneratingPlan(false);
    }
  }

  // 3단계: 무료 재생성 (revisionCredits 소비)
  async function handleRevisionRegenerate(values: PlannerFormValues) {
    if (!revisionPlanId) return;
    setIsGeneratingPlan(true);
    setPlanError(null);
    setStreamStep(1);
    setStreamAgent('gemini');

    try {
      const res = await fetch('/api/ai-planner-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revisionOf: revisionPlanId,
          revisionToken: revisionToken,
          guestName: 'Guest',
          email: userEmail,
          startDate: values.startDate,
          endDate: values.endDate,
          destination: (values.regions || []).join(', ') || 'Seoul',
          area: cityNameToAreaKey((values.regions || ['Seoul'])[0]),
          preferences: (values.categories || []).join(', ') || '',
          styles: values.categories || ['culture'],
          durationDays: values.durationDays || 3,
          pax: values.pax || 2,
          language,
          arrival_airport: (values as any).arrival_airport || '',
          departure_airport: (values as any).departure_airport || '',
          hotel_address: (values as any).hotel_address || '',
          mobility: (values as any).mobility || 'ok',
          uid: (values as any).uid || null,
          dietPrefs: values.dietPrefs || [],
          allergies: values.allergies || [],
          priceRange: values.priceRange || 'Any',
          special_request: (values as any).freeText || '',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || `Server error (${res.status})`);

      setStreamStep(4);
      setStreamAgent('done');

      if (data.planUrl) navigate(data.planUrl);
      else if (data.planId) navigate(`/my-plans/${data.planId}`);
      else throw new Error('Plan created but no URL returned');
    } catch (err: any) {
      console.error('[PlannerPage] Revision failed:', err);
      setPlanError(err.message || 'Revision failed. Please contact us via WhatsApp.');
      setIsGeneratingPlan(false);
    }
  }


  function handleReset() {
    setStatus('idle');
    setResultQuick(null);
    setErrorMsg(null);
    setUserEmail('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen'} style={isMobile ? undefined : { background: '#080b14' }}>
      <style>{PAGE_STYLE}</style>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      {/* Hero */}
      <section className="text-white py-16 px-4"
        style={{ background: isMobile
          ? 'linear-gradient(160deg, #0a0412 0%, #1a0a2e 60%, #0d0618 100%)'
          : 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}>
        <div className="max-w-2xl mx-auto text-center">
          <div className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[11px] font-semibold tracking-wider uppercase mb-5 ${
            isMobile
              ? 'border-[#B668FC]/35 bg-[#B668FC]/08 text-[#B668FC]'
              : 'border-[rgba(196,149,106,.35)] bg-[rgba(196,149,106,.08)] text-[#D4A574]'
          }`}
            style={{ animation: 'fade-slide-up 0.5s ease forwards' }}>
            <Sparkles className="w-3 h-3" />{p.badgeLabel}
          </div>
          <h1 className={`text-3xl sm:text-4xl font-bold leading-tight mb-4 whitespace-pre-line ${isMobile ? 'm-shimmer-text' : 'text-white'}`}
            style={{ animation: 'fade-slide-up 0.6s ease forwards', animationDelay: '0.1s', opacity: 0 }}>{p.heroTitle}</h1>
          <p className="text-white/50 text-sm sm:text-base whitespace-pre-line"
            style={{ animation: 'fade-slide-up 0.6s ease forwards', animationDelay: '0.2s', opacity: 0 }}>{p.heroSubtitle}</p>
        </div>
      </section>

      <main className={`max-w-3xl mx-auto px-4 space-y-8 ${isMobile ? 'py-6' : 'py-12'}`}>
        {/* Wizard form — visible when idle/error/loading */}
        {(status === 'idle' || status === 'error' || status === 'loadingQuick') && (
          <div className={isMobile ? 'm-card m-appear p-5 shadow-2xl' : 'bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 sm:p-9 shadow-2xl'}>
            <WizardForm onSubmit={handleSubmit} isLoading={status === 'loadingQuick'} t={t} lang={language} preset={preset} />
          </div>
        )}

        {/* Phase 1 Loading */}
        {status === 'loadingQuick' && (
          <div className="mt-8">
            <TriviaLoadingAnimation p={{ loading_tips: [p.loadingAnalyzing], loading_step1: p.loadingDay1Extract }} streamStep={1} streamAgent="planner" />
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 text-center mt-8">
            <p className="text-3xl mb-3"><AlertTriangle className="w-10 h-10 text-red-400 mx-auto" /></p>
            <p className="font-semibold text-red-300 mb-1">{p.errorTitle}</p>
            <p className="text-sm text-red-400/70 mb-5">{errorMsg}</p>
            <button onClick={handleReset}
              className="px-6 py-2.5 rounded-xl border border-red-400/40 text-red-300 text-sm font-bold hover:bg-red-500/20 transition-colors">
              {p.retry}
            </button>
          </div>
        )}

        {/* Phase 1 Success: Quick Summary & Email Capture */}
        {status === 'quickSuccess' && resultQuick && (
          <div id="planner-quick-result" className="space-y-6">
            <div className={isMobile
              ? 'm-card m-appear p-5 border-[#B668FC]/30 shadow-[0_0_20px_rgba(182,104,252,0.2)]'
              : 'bg-gradient-to-br from-[#1a0f14] to-[#0a1628] rounded-2xl p-6 border border-[#7C5CFC]/30 shadow-[0_0_20px_rgba(124,92,252,0.2)]'
            }>
              <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2"><Sparkles className={`w-5 h-5 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />{p.quickPreviewTitle}</h2>
              <p className={`font-bold text-sm mb-4 ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}>{p.quickPreviewTheme}: {resultQuick.themes?.join(', ') || 'Healing, Luxury'}</p>
              
              <div className="text-sm text-white/80 leading-relaxed mb-6 bg-white/5 p-4 rounded-xl border border-white/10">
                <strong className="text-white block mb-1">{p.quickPreviewNarrative}:</strong>
                {(() => {
                  // 안전한 마케팅 서사 추출
                  let narrative = resultQuick.marketingNarrative;
                  if (!narrative) return '여행 일정을 생성했습니다.';
                  // 객체인 경우 full_narrative 또는 첫번째 문자열 필드 추출
                  if (typeof narrative === 'object') {
                    narrative = narrative.full_narrative || narrative.text || narrative.content || narrative.summary || Object.values(narrative).find(v => typeof v === 'string' && v.length > 20) || JSON.stringify(narrative);
                  }
                  // 문자열이지만 JSON으로 시작하면 파싱 시도
                  if (typeof narrative === 'string' && narrative.trim().startsWith('{')) {
                    try {
                      const parsed = JSON.parse(narrative);
                      narrative = parsed.full_narrative || parsed.text || parsed.content || narrative;
                    } catch {}
                  }
                  // 남은 JSON 잔해물 제거
                  if (typeof narrative === 'string') {
                    narrative = narrative.replace(/^\{[^}]*"(themes|marketingNarrative)"[^}]*$/g, '');
                    narrative = narrative.replace(/[{}"\[\]]/g, '').replace(/\s*,\s*/g, ', ').trim();
                  }
                  return String(narrative || '여행 일정을 생성했습니다.').slice(0, 500);
                })()}
              </div>

              {(() => {
                // 안전한 Day 1 테이블 추출
                let table = resultQuick.day1MarkdownTable;
                if (!table) return null;
                if (typeof table === 'object') {
                  table = table.content || table.table || JSON.stringify(table, null, 2);
                }
                // JSON 잔해물 정리
                if (typeof table === 'string') {
                  table = table.replace(/\\n/g, '\n');
                  // JSON 문자열이면 파싱
                  if (table.trim().startsWith('{') || table.trim().startsWith('[')) {
                    try {
                      const parsed = JSON.parse(table);
                      table = parsed.content || parsed.table || JSON.stringify(parsed, null, 2);
                    } catch {}
                  }
                }
                if (!table || (typeof table === 'string' && table.trim().length < 10)) return null;
                // Parse markdown table → styled HTML table
                const tableStr = String(table);
                const tableLines = tableStr.split('\n').filter((l: string) => l.trim().startsWith('|'));
                const dataLines = tableLines.filter((l: string) => !l.match(/^\|[\s:\-]+\|$/));
                if (dataLines.length < 2) {
                  return (
                    <div className="bg-black/40 rounded-xl p-4 overflow-x-auto text-sm text-white/80">
                      <pre style={{ whiteSpace: 'pre-wrap' }} className="font-mono text-[11px] opacity-80">{tableStr}</pre>
                    </div>
                  );
                }
                const tHeaders = dataLines[0].split('|').filter((c: string) => c.trim()).map((c: string) => c.trim());
                const tRows = dataLines.slice(1).map((r: string) => r.split('|').filter((c: string) => c.trim()).map((c: string) => c.trim()));
                return (
                  <div className="bg-black/30 rounded-xl overflow-hidden border border-white/[0.08]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className={isMobile ? 'bg-[#B668FC]/15' : 'bg-[#7C5CFC]/15'}>
                          {tHeaders.map((h: string, hi: number) => (
                            <th key={hi} className="px-3 py-2.5 text-left text-[11px] font-bold text-white/70 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tRows.map((row: string[], ri: number) => (
                          <tr key={ri} className={`border-t border-white/[0.06] ${ri % 2 === 0 ? 'bg-white/[0.02]' : 'bg-white/[0.04]'} hover:bg-white/[0.07] transition-colors`}>
                            {row.map((cell: string, ci: number) => (
                              <td key={ci} className={`px-3 py-2.5 text-[13px] ${ci === 0 ? (isMobile ? 'font-bold text-[#FF6B9D]' : 'font-bold text-[#C4956A]') : 'text-white/70'}`}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Premium Full Plan Purchase — Phase 1 + Phase 3 */}
            <div className={isMobile
              ? 'm-card m-appear p-6 text-center relative overflow-hidden'
              : 'bg-gradient-to-br from-[#0f111a] to-[#1a0f18] rounded-2xl p-8 border border-[#7C5CFC]/20 text-center shadow-xl relative overflow-hidden'
            }
              style={isMobile ? { background: 'linear-gradient(135deg, rgba(182,104,252,0.06), rgba(255,107,157,0.03), rgba(10,4,18,0.95))' } : undefined}
            >
              {/* Decorative glow */}
              <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl ${isMobile ? 'bg-[#B668FC]/10' : 'bg-[#7C5CFC]/10'}`} />

              {/* ── Phase 1: Enhanced Price Display ── */}
              <div className="relative text-center py-4 mb-4">
                <div className="text-white/40 text-sm mb-1">
                  <span className="line-through">$19.90</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wider">{p.originalPrice}</span>
                </div>
                <div className="flex items-baseline justify-center gap-2 mb-2">
                  <span className="text-5xl font-black text-white" style={{ textShadow: isMobile ? '0 0 20px rgba(182,104,252,0.3)' : '0 0 20px rgba(124,92,252,0.3)' }}>$9.90</span>
                  <span className="text-white/35 text-sm">/ ₩13,300</span>
                </div>
                <div className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border ${isMobile ? 'bg-gradient-to-r from-[#FF6B9D]/15 to-[#B668FC]/15 border-[#FF6B9D]/40' : 'bg-gradient-to-r from-[#EA537E]/15 to-[#7C5CFC]/15 border-[#EA537E]/40'}`}>
                  <span className={`text-xs font-bold ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}>50% OFF</span>
                  <span className="text-white/20">·</span>
                  <span className="text-white/60 text-xs">{p.launchPrice}</span>
                </div>
                <p className="text-amber-400/80 text-[11px] mt-3 font-medium">{p.limitedTimeOffer}</p>
              </div>

              <h3 className="text-xl font-bold text-white mb-2 relative">{p.fullPlanTitle}</h3>
              <p className="text-white/50 text-sm mb-5 max-w-lg mx-auto leading-relaxed">{p.fullPlanDesc}</p>

              {/* Feature checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md mx-auto mb-6 text-left">
                {([
                  { icon: <Briefcase className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureItinerary },
                  { icon: <UtensilsCrossed className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureRestaurant },
                  { icon: <Camera className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featurePhoto },
                  { icon: <Train className={`w-4 h-4 ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`} />, text: p.featureTransit },
                ] as { icon: ReactNode; text: string }[]).map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-white/70 py-1.5">
                    {item.icon}
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>

              {/* ── Phase 3: Option A / B Selection ── */}
              <div className="max-w-md mx-auto space-y-3 mb-5">
                {/* Option A: Pay Now */}
                <button
                  onClick={() => setSelectedOption('A')}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-300 ${
                    selectedOption === 'A'
                      ? (isMobile ? 'border-[#B668FC] bg-[#B668FC]/10 shadow-[0_0_15px_rgba(182,104,252,0.15)]' : 'border-[#7C5CFC] bg-[#7C5CFC]/10 shadow-[0_0_15px_rgba(124,92,252,0.15)]')
                      : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                  }`}
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <h4 className="text-white font-bold text-[15px]">{p.optionAtitle}</h4>
                    <div className="text-right shrink-0">
                      <div className="text-white/30 text-[10px] line-through">$19.90</div>
                      <div className={`font-bold text-sm ${isMobile ? 'text-[#B668FC]' : 'text-[#7C5CFC]'}`}>$9.90</div>
                    </div>
                  </div>
                  <p className="text-white/45 text-xs mb-2">{p.optionAdesc}</p>
                  <ul className="text-white/60 text-[11px] space-y-0.5">
                    <li>{p.optionAfeature1}</li>
                    <li>{p.optionAfeature2}</li>
                    <li>{p.optionAfeature3}</li>
                    <li className={`font-semibold ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}>🎁 {p.optionAfeatureRevision || '1 Free Revision included'}</li>
                  </ul>
                </button>

                {/* Option B: Book Flight + Hotel */}
                <button
                  onClick={() => setSelectedOption('B')}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-300 ${
                    selectedOption === 'B'
                      ? (isMobile ? 'border-[#FF6B9D] bg-[#FF6B9D]/10 shadow-[0_0_15px_rgba(255,107,157,0.15)]' : 'border-[#EA537E] bg-[#EA537E]/10 shadow-[0_0_15px_rgba(234,83,126,0.15)]')
                      : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                  }`}
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <h4 className="text-white font-bold text-[15px]">{p.optionBtitle}</h4>
                    <span className={`font-bold text-sm shrink-0 ${isMobile ? 'text-[#FF6B9D]' : 'text-[#EA537E]'}`}>FREE</span>
                  </div>
                  <p className="text-white/45 text-xs mb-1.5">{p.optionBdesc}</p>
                  <p className="text-amber-400/70 text-[11px] font-medium">{p.optionBcondition}</p>
                </button>
              </div>

              {/* ── Conditional Action Area ── */}
              <div className="max-w-md mx-auto flex flex-col gap-3">
                {selectedOption === 'A' && (
                  <>
                    <input 
                      type="email" 
                      value={userEmail}
                      onChange={e => setUserEmail(e.target.value)}
                      placeholder={p.emailPlaceholder}
                      className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/40 transition-all outline-none ${isMobile ? 'focus:border-[#B668FC] focus:ring-1 focus:ring-[#B668FC]' : 'focus:border-[#7C5CFC] focus:ring-1 focus:ring-[#7C5CFC]'}`}
                      required 
                    />
                    
                    {isGeneratingPlan ? (
                      <div className="text-center py-6">
                        <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-3" />
                        <p className="text-white font-semibold">{p.creatingItinerary || 'Creating your itinerary...'}</p>
                        <p className="text-white/40 text-sm mt-1">{p.takesAbout15Sec || 'Takes about 15 seconds'}</p>
                      </div>
                    ) : revisionMode && revisionPlanId ? (
                      <button
                        onClick={() => {
                          const values = lastValues.current;
                          if (values) handleRevisionRegenerate(values);
                        }}
                        disabled={!lastValues.current}
                        className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg, #f59e0b, #B668FC)', boxShadow: '0 4px 20px rgba(245,158,11,0.3)' }}
                      >
                        🎁 Free Regeneration — Create New Plan
                      </button>
                    ) : (
                      <PayPalBookingButton
                        productType="ai-planner-full"
                        passengers={1}
                        dateStart=""
                        dateEnd=""
                        priceKRW={13300}
                        p={p}
                        lang={language}
                        memo={`Full itinerary for: ${userEmail}`}
                        itineraryData={resultQuick}
                        onPaymentSuccess={handlePaymentSuccess}
                        userEmail={userEmail}
                      />
                    )}

                    {planError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                        <p className="text-red-400 text-sm mb-1">{planError}</p>
                        <a 
                          href="https://wa.me/821087140611" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-purple-400 text-xs underline"
                        >
                          {p.contactWhatsApp || 'Contact us on WhatsApp'}
                        </a>
                      </div>
                    )}
                  </>
                )}

                {selectedOption === 'B' && (
                  <div className="space-y-5 pt-2">
                    {/* Step indicator */}
                    <div className="flex items-center justify-center gap-3 mb-4">
                      {[1, 2, 3].map(s => (
                        <div key={s} className={`flex items-center gap-2 ${ s <= optionBStep ? 'opacity-100' : 'opacity-30'}`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            s < optionBStep ? (isMobile ? 'bg-[#B668FC] text-white' : 'bg-[#7C5CFC] text-white')
                              : s === optionBStep ? 'border-2 border-white/60 text-white' : 'border border-white/20 text-white/30'
                          }`}>{s < optionBStep ? '✓' : s}</div>
                          {s < 3 && <div className={`w-8 h-0.5 ${s < optionBStep ? (isMobile ? 'bg-[#B668FC]/60' : 'bg-[#7C5CFC]/60') : 'bg-white/10'}`} />}
                        </div>
                      ))}
                    </div>

                    {/* Step 1: Flight */}
                    {optionBStep === 1 && (
                      <div className="animate-fadeIn">
                        <p className="text-white font-bold text-sm mb-4 flex items-center gap-2">
                          <Plane className="w-4 h-4" /> {p.optionBFlightTitle || 'Step 1: Book your flight'}
                        </p>
                        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
                          <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1"><Plane className="w-3.5 h-3.5" /> {p.flight_section_title}</p>
                          <p className="text-[11px] text-white/35 mb-4">{p.flight_section_desc}</p>
                          <a
                            href={`https://www.trip.com/flights/?dcity=&acity=${encodeURIComponent(lastValues.current?.regions?.[0] || 'Seoul')}&Allianceid=4831212&SID=76964637&trip_sub1=cocotrip`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-95"
                            style={{ background: '#0073E6', color: '#fff' }}
                          >
                            <Search className="w-4 h-4" /> Trip.com Flights →
                          </a>
                          <p className="text-[10px] text-white/20 mt-2 text-center">{p.affiliate_note}</p>
                        </div>
                        <button
                          onClick={() => setOptionBStep(2)}
                          className="w-full mt-4 py-3.5 rounded-xl border border-white/15 text-white/60 text-sm font-medium hover:bg-white/5 transition-all"
                        >
                          {p.alreadyBookedFlight || '✈️ Already booked → Skip to hotel'}
                        </button>
                      </div>
                    )}

                    {/* Step 2: Hotel */}
                    {optionBStep === 2 && (
                      <div className="animate-fadeIn">
                        <p className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                          <Hotel className="w-4 h-4" /> {p.optionBHotelTitle || 'Step 2: Book your hotel'}
                        </p>
                        {(() => {
                          const region = (lastValues.current?.regions?.[0]) || 'Seoul';
                          const links = buildAccommodationLinks(region, region);
                          return (
                            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
                              <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-1 flex items-center gap-1">
                                <Hotel className="w-3.5 h-3.5" /> {p.slimHotelLowest}
                              </p>
                              <p className="text-[11px] text-white/35 mb-4">{p.optionBHotelDesc || 'Find the best hotel deals for your trip'}</p>
                              <div className="flex flex-wrap gap-2">
                                {links.map((lk: any) => (
                                  <a key={lk.provider} href={lk.url} target="_blank" rel="noopener noreferrer"
                                    className="flex-1 min-w-[100px] text-center py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
                                    style={{ background: lk.color || '#0073E6', color: '#fff' }}>
                                    {lk.label} →
                                  </a>
                                ))}
                              </div>
                              <p className="text-[10px] text-white/20 mt-2 text-center">{p.affiliate_note}</p>
                            </div>
                          );
                        })()}
                        <button
                          onClick={() => setOptionBStep(3)}
                          className="w-full mt-3 py-3 rounded-xl border border-white/15 text-white/60 text-sm font-medium hover:bg-white/5 transition-all"
                        >
                          {p.alreadyBookedHotel || '🏨 Already booked → Get free plan'}
                        </button>
                        <button
                          onClick={() => setOptionBStep(1)}
                          className="w-full mt-1 text-white/30 text-xs hover:text-white/50"
                        >
                          ← {p.planner_prev}
                        </button>
                      </div>
                    )}

                    {/* Step 3: Claim free plan */}
                    {optionBStep === 3 && (
                      <div className="animate-fadeIn text-center">
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${isMobile ? 'bg-[#B668FC]/20' : 'bg-[#7C5CFC]/20'}`}>
                          <Check className="w-7 h-7 text-emerald-400" />
                        </div>
                        <p className="text-white font-bold text-base mb-2">{p.optionBClaimTitle || 'Almost there!'}</p>
                        <p className="text-white/50 text-sm mb-4 max-w-xs mx-auto">{p.optionBClaimDesc || 'Send us your booking confirmations via WhatsApp and we\'ll unlock your full plan for free.'}</p>
                        <a
                          href={`https://wa.me/821087140611?text=${encodeURIComponent('Hi! I booked my flight and hotel through CocoTrip. Please send me my free AI plan. Email: ' + userEmail)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center justify-center gap-2 w-full py-4 rounded-2xl text-white font-bold text-[15px] transition-all hover:scale-[1.02] ${
                            isMobile
                              ? 'bg-gradient-to-r from-[#25D366] to-[#128C7E] shadow-[0_4px_20px_rgba(37,211,102,0.25)]'
                              : 'bg-gradient-to-r from-[#25D366] to-[#128C7E] shadow-[0_4px_20px_rgba(37,211,102,0.25)]'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.637-1.467A11.932 11.932 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-2.168 0-4.183-.655-5.863-1.776l-.42-.265-2.754.872.878-2.69-.288-.44A9.776 9.776 0 012.182 12c0-5.414 4.404-9.818 9.818-9.818S21.818 6.586 21.818 12 17.414 21.818 12 21.818z"/></svg>
                          {p.optionBWhatsAppCta || 'Send booking proof via WhatsApp'}
                        </a>
                        <input 
                          type="email" 
                          value={userEmail}
                          onChange={e => setUserEmail(e.target.value)}
                          placeholder={p.emailPlaceholder}
                          className={`w-full mt-3 px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/40 transition-all outline-none ${isMobile ? 'focus:border-[#B668FC] focus:ring-1 focus:ring-[#B668FC]' : 'focus:border-[#7C5CFC] focus:ring-1 focus:ring-[#7C5CFC]'}`}
                        />
                        <button
                          onClick={() => setOptionBStep(2)}
                          className="w-full mt-2 text-white/30 text-xs hover:text-white/50"
                        >
                          ← {p.planner_prev}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Satisfaction guarantee */}
                <div className="flex items-center justify-center gap-2 text-[11px] text-white/30 mt-1">
                  <Check className="w-3 h-3" />
                  <span>{p.upgradeNotice}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Phase 2: 결제 후 navigate(planUrl)로 바로 이동하므로 별도 성공 UI 불필요 */}
      </main>
      {!isMobile && <Footer t={t} />}
    </div>
  );
}
