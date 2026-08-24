// Step 3: canonical-intent review + the free day-one preview.
//
// 2026-08-24 (planner-trust-course): rewritten from a 4-card summary into a
// full review of every answer the traveler gave across steps 0-3. No medical
// allergy UI/copy anywhere — the wizard only ever collected Halal/Vegan/
// Vegetarian (religious/ethical restrictions with a real trust chain, see
// .claude/rules/dietary-safety.md), never allergens. Every group below is a
// real <button> that routes to the exact step that owns those fields, so
// "Tap any card to edit" (kept below) is now literally true instead of
// aspirational copy.
//
// 2026-08-10 follow-up (still true): the action block used to be a price
// card. It printed the full-plan amount, said "Generate AI Itinerary" and
// closed with "Takes about 15 seconds after payment" — above a button that
// calls `/api/ai-planner-quick`, which is free and returns day one only.
// Pressing it charges nothing, so this card quotes nothing: it names the
// free preview, says the full itinerary is a separate paid step, and leaves
// the amount where money is actually asked for (`AiPlannerPricingNote`
// before the brief, `PurchaseSection` after the preview). Locked by
// `tests/unit/planner-free-preview-truthfulness.test.ts`.
import type { ReactNode } from 'react';
import { MapPin, ChevronLeft, Plane, Sparkles, Check, UtensilsCrossed, Compass } from 'lucide-react';
import { AIRPORT_DISPLAY } from './data';
import { parseDateOnly } from './dateOnly';
import type { WizardDict } from './types';
import type { ReservationStatus } from './WizardStep0Reservation';
import type { TourPace } from './WizardStep2Details';
import { pickPlannerCopy } from '@/pages/PlannerPage/plannerCopy';

// 2026-08-04: helpers.tsx 에서 옮겨 왔다 (마크업 그대로). 소비처가 이 파일 하나뿐인데
// 순수 함수 모듈에 섞여 있어 fast-refresh 가 위저드를 통째로 리마운트하게 만들고 있었다.
// export 하지 않는다 — 다시 공유 모듈로 빼면 같은 문제가 돌아온다.
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[12px] text-ec-ink-3">{label}</span>
      <span className="min-w-0 flex-1 text-right text-[13px] text-ec-ink-2">{value}</span>
    </div>
  );
}

// Whole-group button — every field in the group routes to the one step that
// owns it, so the group itself (not each row) is the keyboard-accessible
// edit target. aria-label spells out the group name + "Edit" for screen
// readers, since the visible content is several stacked rows, not one line.
function EditGroup({ icon, title, ariaLabel, onClick, children }: { icon: ReactNode; title: string; ariaLabel: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel}
      className="w-full rounded-ec-md border border-ec-line px-3.5 py-3 text-left transition-colors duration-ec-base ease-ec-standard hover:bg-ec-sunken hover:border-ec-line-3">
      <span className="flex items-center gap-2 text-[13px] font-bold text-ec-ink mb-1.5">
        {icon} {title}
      </span>
      <div className="space-y-0.5">{children}</div>
    </button>
  );
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const RES_STATUS_LABELS: Record<string, { key: string; fb: string }> = {
  nothing: { key: 'resNothingTitle', fb: 'Nothing booked yet' },
  flight: { key: 'resFlightTitle', fb: 'Flight booked' },
  flight_hotel: { key: 'resFlightHotelTitle', fb: 'Flight + hotel booked' },
  all_done: { key: 'resAllDoneTitle', fb: 'All booked through CocoTrip' },
};

const ACCOM_BUDGET_INDEX: Record<string, string> = { budget: '1', moderate: '2', luxury: '3' };

interface Step3Props {
  p: WizardDict;
  language?: string;

  // Step 0: reservation
  reservationStatus?: ReservationStatus | null;
  arrivalTerminal?: string;
  arrivalTime?: string;

  // Step 1: destinations
  allCities?: string[];
  cityKeys?: string[];
  arrivalCityKey?: string;
  departureCityKey?: string;
  selectedActivities?: string[];
  freeText?: string;

  // Step 2: food
  dietPrefs?: string[];
  dietaryRestrictions?: string[];
  /** Distinguishes "user tapped None" (explicit) from "never touched this group" —
   *  both leave dietaryRestrictions === []. See index.tsx toggleDietaryRestriction. */
  dietaryRestrictionsTouched?: boolean;
  priceRange?: string;
  spiceLevel?: string;
  bucketDishes?: string[];

  // Step 3: details
  startDate?: string;
  endDate?: string;
  pax?: number;
  departureTerminal?: string;
  departureTime?: string;
  hotelAddress?: string;
  mainCityKey?: string;
  hotelByCity?: Record<string, string>;
  recommendedZones?: Record<string, string>;
  isMultiCity?: boolean;
  tourPace?: TourPace;
  tourStartTime?: string;
  tourEndTime?: string;
  companions?: '' | 'solo' | 'couple' | 'family' | 'friends';
  luggageSmall?: number;
  luggageMedium?: number;
  luggageLarge?: number;
  wantAccom?: boolean;
  accomBudget?: string;

  isLoading?: boolean;
  errorMsg?: string;
  onEditStep?: (step: number) => void;
  onGenerate?: () => void;
}

export function WizardStep3Review(props: Step3Props) {
  const {
    p, language,
    reservationStatus = null, arrivalTerminal = '', arrivalTime = '',
    allCities = [], cityKeys = [], arrivalCityKey = '', departureCityKey = '', selectedActivities = [], freeText = '',
    dietPrefs = [], dietaryRestrictions = [], dietaryRestrictionsTouched = false, priceRange = '', spiceLevel = '', bucketDishes = [],
    startDate = '', endDate = '', pax = 0, departureTerminal = '', departureTime = '', hotelAddress = '',
    mainCityKey = '', hotelByCity, recommendedZones, isMultiCity = false,
    tourPace = 'moderate', tourStartTime = '', tourEndTime = '', companions = '',
    luggageSmall = 0, luggageMedium = 0, luggageLarge = 0, wantAccom = false, accomBudget = '',
    isLoading = false, errorMsg = '', onEditStep = () => {}, onGenerate = () => {},
  } = props;

  const c = pickPlannerCopy(language || 'en');
  const notSelected = p.wizardNotSelected || 'Not selected';
  const editLabel = p.editLabel || 'Edit';

  // Review dates use Intl + the local-calendar parser, never a fixed English
  // month-name table — a ko/ja/zh traveler sees their own month names.
  const localeTag = language === 'ko' ? 'ko-KR' : language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : 'en-US';
  function formatReviewDate(dateStr: string): string {
    const d = parseDateOnly(dateStr);
    if (!d) return '';
    return d.toLocaleDateString(localeTag, { month: 'short', day: 'numeric' });
  }

  // --- Group 1: Reservation & flight ---
  const resStatusMeta = reservationStatus ? RES_STATUS_LABELS[reservationStatus] : null;
  const reservationValue = resStatusMeta ? (p[resStatusMeta.key] || resStatusMeta.fb) : notSelected;
  const showArrivalDetail = reservationStatus === 'flight' || reservationStatus === 'flight_hotel';
  const arrivalAirportValue = (AIRPORT_DISPLAY[arrivalTerminal] || arrivalTerminal || '-') + (arrivalTime ? ` · ${arrivalTime}` : '');

  // --- Group 2: Destination & activities ---
  const citiesDisplay = allCities.length > 0
    ? allCities.map((name, i) => {
        const key = cityKeys[i] || '';
        if (!isMultiCity || !key) return name;
        const role = key === arrivalCityKey ? (p.wizardArrivalBadge || 'Arrival')
          : key === departureCityKey ? (p.wizardDepartureBadge || 'Departure')
          : '';
        return role ? `${name} (${role})` : name;
      }).join(' → ')
    : '-';
  const activitiesValue = selectedActivities.map(a => p[`act${a}`] || a).join(', ') || notSelected;
  const specialRequestValue = freeText.trim() ? freeText.trim() : notSelected;

  // --- Group 3: Food & dietary ---
  const foodStylesValue = dietPrefs.map(k => p[`food${k}`] || k).join(', ') || notSelected;
  let dietaryValue: string;
  if (dietaryRestrictions.length > 0) {
    dietaryValue = dietaryRestrictions.map(k => p[`dietaryRestriction${k}`] || k).join(', ');
  } else if (dietaryRestrictionsTouched) {
    dietaryValue = p.dietaryRestrictionNone || 'None';
  } else {
    dietaryValue = notSelected;
  }
  const priceValue = p[`price${priceRange}`] || priceRange || notSelected;
  const spiceValue = p[`spice${cap(spiceLevel)}`] || spiceLevel || notSelected;
  const bucketValue = bucketDishes.map(k => p[`bucket${cap(k)}`] || k).join(', ') || notSelected;

  // --- Group 4: Trip details ---
  // startDate/endDate both inclusive (last travel day shown, not the day after) —
  // same repo-wide convention as src/components/charter/Step5DateOptions.tsx.
  const datesValue = startDate && endDate ? `${formatReviewDate(startDate)} - ${formatReviewDate(endDate)}` : notSelected;
  const paxValue = `${pax} ${p.wizardPaxUnit || 'pax'}`;
  const departureAirportValue = (departureTerminal ? (AIRPORT_DISPLAY[departureTerminal] || departureTerminal) : (p.wizardDepartureSameAsArrival || 'Same as arrival airport'))
    + (departureTime ? ` · ${departureTime}` : '');
  const tourPaceValue = p[`tourPace${cap(tourPace)}`] || tourPace;
  const tourWindowValue = `${tourStartTime || '09:00'} - ${tourEndTime || '21:00'}`;
  const companionsValue = companions ? (p[`companions${cap(companions)}`] || companions) : notSelected;
  const luggageParts: string[] = [];
  if (luggageSmall > 0) luggageParts.push(`${luggageSmall} ${p.luggageSmall || 'Carry-on'}`);
  if (luggageMedium > 0) luggageParts.push(`${luggageMedium} ${p.luggageMedium || 'Medium'}`);
  if (luggageLarge > 0) luggageParts.push(`${luggageLarge} ${p.luggageLarge || 'Large'}`);
  const luggageValue = luggageParts.length > 0 ? luggageParts.join(' · ') : notSelected;
  const accomValue = wantAccom
    ? `${p.accomOptIn || 'Suggest hotels for me'} — ${p[`accomBudget${ACCOM_BUDGET_INDEX[accomBudget] || '2'}`] || accomBudget}`
    : notSelected;

  // 2026-05-21 (P134 분기 #34/#35 fix): 호텔 anchor 효과 미리보기.
  // 호텔 입력 도시 = "🏨 도시: 주소" / 호텔 없는 도시 = "📍 도시: zone".
  const hotelEntries: Array<{ city: string; address: string }> = [];
  const zoneEntries: Array<{ city: string; zone: string }> = [];
  if (isMultiCity && allCities.length > 1) {
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
    if (hotelAddress) hotelEntries.push({ city: allCities[0] || '', address: hotelAddress });
    else if (mainCityKey && recommendedZones && recommendedZones[mainCityKey]) {
      zoneEntries.push({ city: allCities[0] || '', zone: recommendedZones[mainCityKey] });
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="ec-question">{p.wizardReviewTitle || 'Review Your Trip'}</h2>

      <div className="ec-panel space-y-2.5 sm:space-y-3">
        <EditGroup
          icon={<Plane className="w-4 h-4 text-ec-brand" />}
          title={p.wizardReviewGroupReservation || 'Reservation & flight'}
          ariaLabel={`${p.wizardReviewGroupReservation || 'Reservation & flight'} — ${editLabel}`}
          onClick={() => onEditStep(0)}
        >
          <ReviewRow label={p.resTitle || 'Reservation status'} value={reservationValue} />
          {showArrivalDetail && (
            <ReviewRow label={p.wizardAirport || 'Airport'} value={arrivalAirportValue} />
          )}
        </EditGroup>

        <EditGroup
          icon={<MapPin className="w-4 h-4 text-ec-brand" />}
          title={p.wizardReviewGroupDestination || 'Destination & activities'}
          ariaLabel={`${p.wizardReviewGroupDestination || 'Destination & activities'} — ${editLabel}`}
          onClick={() => onEditStep(1)}
        >
          <ReviewRow label={p.wizardDestination || 'Destination'} value={citiesDisplay} />
          <ReviewRow label={p.wizardActivitiesLabel || 'Activities'} value={activitiesValue} />
          <ReviewRow label={p.wizardFreeInput || 'Special request'} value={specialRequestValue} />
        </EditGroup>

        <EditGroup
          icon={<UtensilsCrossed className="w-4 h-4 text-ec-brand" />}
          title={p.wizardReviewGroupFood || 'Food & dietary'}
          ariaLabel={`${p.wizardReviewGroupFood || 'Food & dietary'} — ${editLabel}`}
          onClick={() => onEditStep(2)}
        >
          <ReviewRow label={p.wizardFoodStyleLabel || 'Food styles'} value={foodStylesValue} />
          <ReviewRow label={p.wizardFoodDietaryRestrictionLabel || 'Dietary restrictions'} value={dietaryValue} />
          <ReviewRow label={p.wizardFoodPriceLabel || 'Meal budget'} value={priceValue} />
          <ReviewRow label={p.wizardFoodSpiceLabel || 'Spice tolerance'} value={spiceValue} />
          <ReviewRow label={p.wizardFoodBucketLabel || 'Korean bucket list'} value={bucketValue} />
        </EditGroup>

        <EditGroup
          icon={<Compass className="w-4 h-4 text-ec-brand" />}
          title={p.wizardReviewGroupDetails || 'Trip details'}
          ariaLabel={`${p.wizardReviewGroupDetails || 'Trip details'} — ${editLabel}`}
          onClick={() => onEditStep(3)}
        >
          <ReviewRow label={p.wizardDates || 'Dates'} value={datesValue} />
          <ReviewRow label={p.wizardTravelers || 'Travelers'} value={paxValue} />
          <ReviewRow label={p.wizardAirport || 'Arrival airport'} value={arrivalAirportValue} />
          <ReviewRow label={(p as Record<string, string>).wizardWhichDepartureAirport || 'Departure airport'} value={departureAirportValue} />
          {hotelEntries.map((e, i) => (
            <ReviewRow key={`hotel-${i}`}
              label={hotelEntries.length > 1 || zoneEntries.length > 0 ? e.city : (p.wizardHotelLabel || 'Hotel')}
              value={e.address} />
          ))}
          {zoneEntries.map((e, i) => (
            <ReviewRow key={`zone-${i}`}
              label={hotelEntries.length > 0 || zoneEntries.length > 1 ? e.city : (p.wizardZoneCenterLabel || 'Zone center')}
              value={e.zone} />
          ))}
          {hotelEntries.length === 0 && zoneEntries.length === 0 && (
            <ReviewRow label={p.wizardHotelLabel || 'Hotel'}
              value={p.wizardNoAnchorHint || 'Each day gets a practical starting point, set from the cities and dates above.'} />
          )}
          <ReviewRow label={p.tourPaceLabel || 'Daily tour pace'} value={tourPaceValue} />
          <ReviewRow label={`${(p as Record<string, string>).tourStartTimeLabel || 'Tour start'} – ${(p as Record<string, string>).tourEndTimeLabel || 'Tour end'}`} value={tourWindowValue} />
          <ReviewRow label={p.companionsLabel || 'Companions'} value={companionsValue} />
          <ReviewRow label={p.luggageTitle || 'Luggage'} value={luggageValue} />
          <ReviewRow label={p.accomOptIn || 'Accommodation recommendation'} value={accomValue} />
        </EditGroup>

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
      <button onClick={() => onEditStep(3)}
        aria-label={p.planner_prev || 'Back'}
        className="ec-btn ec-btn-secondary w-full">
        <ChevronLeft className="w-4 h-4" /> {p.planner_prev || 'Back'}
      </button>
    </div>
  );
}
