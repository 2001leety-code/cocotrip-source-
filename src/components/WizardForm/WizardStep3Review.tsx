// Step 3: summary review + generate button.
import { MapPin, Users, Calendar, ChevronLeft, Plane, Sparkles, Check, Wallet, Shield, Hotel, Navigation } from 'lucide-react';
import { AIRPORT_DISPLAY } from './data';
import { SummaryCard, formatDateShort } from './helpers';
import { formatPrice } from '@/lib/exchange-rate';
import type { WizardDict } from './types';

interface Step3Props {
  p: WizardDict;
  allCities: string[];
  startDate: string;
  endDate: string;
  arrivalTerminal: string;
  pax: number;
  selectedActivities: string[];
  hotelAddress: string;
  // 2026-05-21 (P134 분기 #34/#35 fix): 다도시 + 호텔 anchor 미리보기 props.
  // mainCityKey: 단도시면 그 도시, 다도시면 entry city.
  // hotelByCity: 다도시 시 도시별 호텔 Record (cityKey → address).
  // recommendedZones: 호텔 미입력 시 zone 중심 fallback (cityKey → zoneKey).
  // 운영자 의도 (P134): 호텔 입력 여부와 무관하게 매일 동선 구조 (호텔→이동→장소→...→복귀) 유지.
  // Review step 에서 사용자가 "왜 호텔 입력하면 디테일 ↑" 인지 + 다도시 plan 도 한눈에.
  mainCityKey?: string;
  hotelByCity?: Record<string, string>;
  recommendedZones?: Record<string, string>;
  isMultiCity?: boolean;
  isLoading: boolean;
  errorMsg: string;
  // 사용자 언어 — 가격 secondary 환산 표시용 (en→KRW / ko→KRW / ja→JPY / zh→CNY).
  language?: string;
  onEditStep: (step: number) => void;
  onGenerate: () => void;
}

export function WizardStep3Review(props: Step3Props) {
  const {
    p, allCities, startDate, endDate, arrivalTerminal, pax, selectedActivities, hotelAddress,
    mainCityKey, hotelByCity, recommendedZones, isMultiCity,
    isLoading, errorMsg, language, onEditStep, onGenerate,
  } = props;

  const airportLabel = AIRPORT_DISPLAY[arrivalTerminal] || arrivalTerminal || '-';

  // 2026-05-21 (P134 분기 #34/#35 fix): destination 다도시 시 "Seoul → Busan" 형식.
  const destinationValue = isMultiCity && allCities.length > 1
    ? allCities.join(' → ')
    : (allCities[0] || '-');

  // 2026-05-21 (P134 분기 #34/#35 fix): 호텔 anchor 효과 미리보기.
  // 호텔 입력 도시 = "🏨 도시: 주소" / 호텔 없는 도시 = "📍 도시: zone".
  const hotelEntries: Array<{ city: string; address: string }> = [];
  const zoneEntries: Array<{ city: string; zone: string }> = [];
  if (isMultiCity && allCities.length > 1) {
    // 다도시: mainCity 의 entry hotel + hotelByCity 의 모든 키
    if (mainCityKey) {
      const mainAddr = (hotelByCity && hotelByCity[mainCityKey]) || hotelAddress;
      if (mainAddr) hotelEntries.push({ city: allCities[0], address: mainAddr });
      else if (recommendedZones && recommendedZones[mainCityKey]) {
        zoneEntries.push({ city: allCities[0], zone: recommendedZones[mainCityKey] });
      }
    }
    if (hotelByCity) {
      for (const [cityKey, addr] of Object.entries(hotelByCity)) {
        if (cityKey === mainCityKey) continue;
        if (addr) hotelEntries.push({ city: cityKey, address: addr });
      }
    }
    if (recommendedZones) {
      for (const [cityKey, zone] of Object.entries(recommendedZones)) {
        if (cityKey === mainCityKey) continue;
        if (zone && !hotelByCity?.[cityKey]) zoneEntries.push({ city: cityKey, zone });
      }
    }
  } else {
    // 단도시
    if (hotelAddress) hotelEntries.push({ city: allCities[0] || '', address: hotelAddress });
    else if (mainCityKey && recommendedZones && recommendedZones[mainCityKey]) {
      zoneEntries.push({ city: allCities[0] || '', zone: recommendedZones[mainCityKey] });
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-[17px] sm:text-lg font-bold text-white">{p.wizardReviewTitle || 'Review Your Trip'}</h2>

      {/* Summary cards */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3.5 sm:p-5 space-y-3 sm:space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button onClick={() => onEditStep(0)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<MapPin className="w-4 h-4" />} label={p.wizardDestination || 'Destination'} value={destinationValue} />
          </button>
          <button onClick={() => onEditStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Calendar className="w-4 h-4" />} label={p.wizardDates || 'Dates'} value={startDate && endDate ? `${formatDateShort(startDate)} - ${formatDateShort(endDate)}` : 'TBD'} />
          </button>
          <button onClick={() => onEditStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Plane className="w-4 h-4" />} label={p.wizardAirport || 'Airport'} value={airportLabel} />
          </button>
          <button onClick={() => onEditStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Users className="w-4 h-4" />} label={p.wizardTravelers || 'Travelers'} value={`${pax} ${p.wizardPaxUnit || 'pax'}`} />
          </button>
        </div>

        <div className="text-xs text-white/55 space-y-1 border-t border-white/[0.06] pt-3">
          <p><span className="text-white/55">{p.wizardActivitiesLabel || 'Activities'}:</span> <span className="text-white/60">{selectedActivities.map(a => p[`act${a}`] || a).join(', ') || '-'}</span></p>

          {/* 2026-05-21 (P134 분기 #34 fix): 호텔 입력 도시 anchor */}
          {hotelEntries.map((e, i) => (
            <p key={`hotel-${i}`} className="flex items-start gap-1.5">
              <Hotel className="w-3 h-3 mt-0.5 text-[#7C5CFC]" />
              <span className="text-white/55">
                {hotelEntries.length > 1 || zoneEntries.length > 0 ? `${e.city}: ` : `${p.wizardHotelLabel || 'Hotel'}: `}
              </span>
              <span className="text-white/60">{e.address}</span>
            </p>
          ))}

          {/* 2026-05-21 (P134 분기 #34 fix): zone 중심 fallback — 호텔 없는 도시 */}
          {zoneEntries.map((e, i) => (
            <p key={`zone-${i}`} className="flex items-start gap-1.5">
              <Navigation className="w-3 h-3 mt-0.5 text-[#7C5CFC]/60" />
              <span className="text-white/55">
                {hotelEntries.length > 0 || zoneEntries.length > 1 ? `${e.city}: ` : `${p.wizardZoneCenterLabel || 'Zone center'}: `}
              </span>
              <span className="text-white/60">{e.zone}</span>
            </p>
          ))}

          {/* 호텔도 zone 도 없는 경우 — backend 가 default fallback */}
          {hotelEntries.length === 0 && zoneEntries.length === 0 && (
            <p className="text-white/45 italic">
              {p.wizardNoAnchorHint || 'AI will pick optimal start points per day'}
            </p>
          )}
        </div>

        <p className="text-[10px] text-white/55 text-center">{p.wizardTapToEdit || 'Tap any card to edit'}</p>
      </div>

      {/* What You'll Get */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 sm:p-5">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#7C5CFC]" /> {p.wizardWhatYouGet || "What You'll Get"}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {([p.wizardGetItem1, p.wizardGetItem2, p.wizardGetItem3, p.wizardGetItem4, p.wizardGetItem5, p.wizardGetItem6, p.wizardGetItem7, p.wizardGetItem8].filter(Boolean) as string[]).map((item: string, i: number) => (
            <div key={i} className="flex items-start gap-2 text-xs text-white/50">
              <Check className="w-3.5 h-3.5 text-green-400/70 shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Price + Generate */}
      <div className="bg-gradient-to-br from-[#7C5CFC]/10 to-[#EA537E]/10 border border-[#7C5CFC]/20 rounded-xl p-3.5 space-y-3 sm:rounded-2xl sm:p-5 sm:space-y-4 text-center">
        <div>
          <p className="text-sm text-white/50 mb-1">{p.wizardAiPlan || 'AI Travel Plan'}</p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold text-white">$9.90</span>
            {/* 사용자 언어 기반 보조 통화 — en/ko 는 ₩13,300, ja→¥JPY, zh→¥CNY. 결제는 PayPal USD $9.90. */}
            <span className="text-sm text-white/55">
              / {language === 'ja' || language === 'zh' ? formatPrice(13300, language) : '₩13,300'}
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        <button onClick={onGenerate} disabled={isLoading}
          className="w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl text-sm sm:text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.03] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 4px 28px rgba(124,92,252,.4)' }}>
          <Shield className="w-5 h-5" />
          {isLoading ? (p.generating || 'Creating your itinerary...') : (p.wizardGenerateBtn || 'Generate AI Itinerary')}
        </button>

        <p className="text-[10px] text-white/55 flex items-center justify-center gap-1">
          <Wallet className="w-3 h-3" /> {p.wizardPaymentNote || 'Takes about 15 seconds after payment'}
        </p>
      </div>

      {/* Back */}
      <button onClick={() => onEditStep(2)}
        aria-label={p.planner_prev || 'Back'}
        className="w-full py-3 rounded-2xl border border-white/[0.1] text-white/55 hover:text-white text-sm font-semibold flex items-center justify-center gap-1 transition-all whitespace-nowrap">
        <ChevronLeft className="w-4 h-4" /> {p.planner_prev || 'Back'}
      </button>
    </div>
  );
}
