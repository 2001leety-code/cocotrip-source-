// Step 3: summary review + the free day-one preview.
//
// 2026-08-10 follow-up: the action block used to be a price card. It printed
// the full-plan amount, said "Generate AI Itinerary" and closed with "Takes
// about 15 seconds after payment" — above a button that calls
// `/api/ai-planner-quick`, which is free and returns day one only. Pressing it
// charges nothing, so this card now quotes nothing: it names the free preview,
// says the full itinerary is a separate paid step, and leaves the amount where
// money is actually asked for (`AiPlannerPricingNote` before the brief,
// `PurchaseSection` after the preview). Locked by
// `tests/unit/planner-free-preview-truthfulness.test.ts`.
import type { ReactNode } from 'react';
import { MapPin, Users, Calendar, ChevronLeft, Plane, Sparkles, Check, Hotel, Navigation } from 'lucide-react';
import { AIRPORT_DISPLAY } from './data';
import { formatDateShort } from './helpers';
import type { WizardDict } from './types';
import { pickPlannerCopy } from '@/pages/PlannerPage/plannerCopy';

// 2026-08-04: helpers.tsx 에서 옮겨 왔다 (마크업 그대로). 소비처가 이 파일 하나뿐인데
// 순수 함수 모듈에 섞여 있어 fast-refresh 가 위저드를 통째로 리마운트하게 만들고 있었다.
// export 하지 않는다 — 다시 공유 모듈로 빼면 같은 문제가 돌아온다.
function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-ec-ink-3">{icon} {label}</span>
      <span className="ec-figure min-w-0 flex-1 truncate text-right text-[14px]">{value}</span>
    </div>
  );
}

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

  const c = pickPlannerCopy(language || 'en');
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
      <h2 className="ec-question">{p.wizardReviewTitle || 'Review Your Trip'}</h2>

      {/* Summary cards */}
      <div className="ec-panel space-y-3 sm:space-y-4">
        <div className="divide-y divide-ec-line">
          <button onClick={() => onEditStep(0)} className="flex min-h-[44px] w-full items-center rounded-ec-sm px-1 py-2.5 text-left transition-colors duration-ec-base ease-ec-standard hover:bg-ec-sunken">
            <SummaryCard icon={<MapPin className="w-4 h-4" />} label={p.wizardDestination || 'Destination'} value={destinationValue} />
          </button>
          <button onClick={() => onEditStep(2)} className="flex min-h-[44px] w-full items-center rounded-ec-sm px-1 py-2.5 text-left transition-colors duration-ec-base ease-ec-standard hover:bg-ec-sunken">
            <SummaryCard icon={<Calendar className="w-4 h-4" />} label={p.wizardDates || 'Dates'} value={startDate && endDate ? `${formatDateShort(startDate)} - ${formatDateShort(endDate)}` : 'TBD'} />
          </button>
          <button onClick={() => onEditStep(2)} className="flex min-h-[44px] w-full items-center rounded-ec-sm px-1 py-2.5 text-left transition-colors duration-ec-base ease-ec-standard hover:bg-ec-sunken">
            <SummaryCard icon={<Plane className="w-4 h-4" />} label={p.wizardAirport || 'Airport'} value={airportLabel} />
          </button>
          <button onClick={() => onEditStep(2)} className="flex min-h-[44px] w-full items-center rounded-ec-sm px-1 py-2.5 text-left transition-colors duration-ec-base ease-ec-standard hover:bg-ec-sunken">
            <SummaryCard icon={<Users className="w-4 h-4" />} label={p.wizardTravelers || 'Travelers'} value={`${pax} ${p.wizardPaxUnit || 'pax'}`} />
          </button>
        </div>

        <div className="text-xs text-ec-ink-3 space-y-1 border-t border-ec-line pt-3">
          <p><span className="text-ec-ink-3">{p.wizardActivitiesLabel || 'Activities'}:</span> <span className="text-ec-ink-2">{selectedActivities.map(a => p[`act${a}`] || a).join(', ') || '-'}</span></p>

          {/* 2026-05-21 (P134 분기 #34 fix): 호텔 입력 도시 anchor */}
          {hotelEntries.map((e, i) => (
            <p key={`hotel-${i}`} className="flex items-start gap-1.5">
              <Hotel className="w-3 h-3 mt-0.5 text-ec-brand" />
              <span className="text-ec-ink-3">
                {hotelEntries.length > 1 || zoneEntries.length > 0 ? `${e.city}: ` : `${p.wizardHotelLabel || 'Hotel'}: `}
              </span>
              <span className="text-ec-ink-2">{e.address}</span>
            </p>
          ))}

          {/* 2026-05-21 (P134 분기 #34 fix): zone 중심 fallback — 호텔 없는 도시 */}
          {zoneEntries.map((e, i) => (
            <p key={`zone-${i}`} className="flex items-start gap-1.5">
              <Navigation className="w-3 h-3 mt-0.5 text-ec-ink-3" />
              <span className="text-ec-ink-3">
                {hotelEntries.length > 0 || zoneEntries.length > 1 ? `${e.city}: ` : `${p.wizardZoneCenterLabel || 'Zone center'}: `}
              </span>
              <span className="text-ec-ink-2">{e.zone}</span>
            </p>
          ))}

          {/* 호텔도 zone 도 없는 경우 — backend 가 default fallback */}
          {hotelEntries.length === 0 && zoneEntries.length === 0 && (
            <p className="text-ec-ink-3 italic">
              {p.wizardNoAnchorHint || 'AI will pick optimal start points per day'}
            </p>
          )}
        </div>

        <p className="text-[10px] text-ec-ink-3 text-center">{p.wizardTapToEdit || 'Tap any card to edit'}</p>
      </div>

      {/* What the purchase contains — not what the button below hands over. */}
      <div className="ec-panel">
        <h3 className="ec-h3 text-sm mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-ec-brand" /> {p.wizardWhatYouGet || 'The full itinerary includes'}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {([p.wizardGetItem1, p.wizardGetItem2, p.wizardGetItem3, p.wizardGetItem4, p.wizardGetItem5, p.wizardGetItem6, p.wizardGetItem7, p.wizardGetItem8].filter(Boolean) as string[]).map((item: string, i: number) => (
            <div key={i} className="flex items-start gap-2 text-xs text-ec-ink-3">
              <Check className="w-3.5 h-3.5 text-ec-success shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* The free day-one preview — the action, described as what it is.
          Left-aligned rather than centred: a centred amount was the anchor of
          the old card, and with the amount gone a centred column of three short
          lines reads as an advert. Set as a paragraph, the eyebrow leads and the
          button is the only heavy element. */}
      <div className="rounded-ec-md border border-ec-line bg-ec-brand-wash p-3.5 sm:p-5">
        <p className="ec-eyebrow">{c.wizard.previewEyebrow}</p>
        <p className="ec-body-sm ec-measure mt-1.5 text-ec-ink-2">{c.wizard.previewLede}</p>

        {errorMsg && (
          <p className="ec-error-note mt-3" role="alert">
            {errorMsg}
          </p>
        )}

        <button onClick={onGenerate} disabled={isLoading} type="button"
          aria-busy={isLoading}
          className="ec-btn ec-btn-primary mt-4 w-full">
          {isLoading ? c.wizard.previewBusy : c.wizard.previewCta}
        </button>

        <p className="ec-body-sm ec-measure mt-2 text-ec-ink-3">{c.wizard.previewNote}</p>
      </div>

      {/* Back */}
      <button onClick={() => onEditStep(2)}
        aria-label={p.planner_prev || 'Back'}
        className="ec-btn ec-btn-secondary w-full">
        <ChevronLeft className="w-4 h-4" /> {p.planner_prev || 'Back'}
      </button>
    </div>
  );
}
