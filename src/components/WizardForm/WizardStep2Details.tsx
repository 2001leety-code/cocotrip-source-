// Step 2: travel dates, pax, airport, hotel address, arrival/departure time, luggage, accom opt-in.
import { Plane, Briefcase, Minus, Plus, Pencil } from 'lucide-react';
import { WizardNav } from './WizardNav';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import type { Locale } from 'date-fns';
import type { AirportOption } from './data';
import type { WizardDict } from './types';
import { MobileSelectDrawer } from '@/components/MobileSelectDrawer';
import { useLanguage } from '@/hooks/useLanguage';

interface Step2Props {
  p: WizardDict;
  isMobile: boolean;
  calendarLocale: Locale;
  dateRange: DateRange | undefined;
  setDateRange: (r: DateRange | undefined) => void;
  nights: number;
  paxInput: string;
  setPaxInput: (v: string) => void;
  mainCity: string;
  airportOptions: AirportOption[];
  arrivalTerminal: string;
  setArrivalTerminal: (v: string) => void;
  hotelAddress: string;
  setHotelAddress: (v: string) => void;
  arrivalTime: string;
  setArrivalTime: (v: string) => void;
  departureTime: string;
  setDepartureTime: (v: string) => void;
  luggageSmall: number;
  setLuggageSmall: (v: number) => void;
  luggageMedium: number;
  setLuggageMedium: (v: number) => void;
  luggageLarge: number;
  setLuggageLarge: (v: number) => void;
  wantAccom: boolean;
  setWantAccom: (v: boolean) => void;
  accomBudget: string;
  setAccomBudget: (v: string) => void;
  // P7 (2026-04-24): daily tour pace — controls Gemini's hours-per-day budget.
  tourPace: TourPace;
  setTourPace: (v: TourPace) => void;
  canGoStep3: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** P0 dedup: Step0(Reservation)에서 입력한 항공편 정보가 있으면 입력칸 대신 칩으로 보여주고
   *  이 콜백으로 Step0으로 점프해 수정하게 함. 미지정 시 기존 동작 유지 (입력칸 항상 노출). */
  onEditFlightInfo?: () => void;
}

export type TourPace = 'half' | 'short' | 'full' | 'action';
const TOUR_PACE_KEYS: TourPace[] = ['half', 'short', 'full', 'action'];
// Authoritative hours mapping lives in api/_food_helper.js (_PACE_HOURS).
// UI shows hours via the sub-label fallback below.
const TOUR_PACE_FALLBACK: Record<TourPace, { label: string; sub: string }> = {
  half:   { label: 'Half-day',   sub: '4h · 1-2 stops · easy pace' },
  short:  { label: 'Short tour', sub: '6h · 3-4 stops · breezy' },
  full:   { label: 'Full day',   sub: '8h · 5-6 stops · standard' },
  action: { label: 'Action-pack', sub: '10h+ · 7+ stops · intense' },
};

function LuggageCounter({ label, sub, value, setValue }: { label: string; sub: string; value: number; setValue: (v: number) => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
      <div>
        <p className="text-[13px] font-semibold text-white">{label}</p>
        <p className="text-[10px] text-white/55">{sub}</p>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setValue(Math.max(0, value - 1))}
          className="w-11 h-11 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/60 disabled:opacity-30"
          disabled={value === 0} aria-label={t.a11y?.decrease ||'Decrease'}>
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="w-6 text-center text-sm font-bold text-white">{value}</span>
        <button type="button" onClick={() => setValue(Math.min(20, value + 1))}
          className="w-11 h-11 rounded-full bg-[#7C5CFC]/30 hover:bg-[#7C5CFC]/50 flex items-center justify-center text-white" aria-label={t.a11y?.increase ||'Increase'}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function WizardStep2Details(props: Step2Props) {
  const {
    p, isMobile, calendarLocale, dateRange, setDateRange, nights,
    paxInput, setPaxInput, mainCity, airportOptions,
    arrivalTerminal, setArrivalTerminal, hotelAddress, setHotelAddress,
    arrivalTime, setArrivalTime, departureTime, setDepartureTime,
    luggageSmall, setLuggageSmall, luggageMedium, setLuggageMedium, luggageLarge, setLuggageLarge,
    wantAccom, setWantAccom, accomBudget, setAccomBudget,
    tourPace, setTourPace,
    canGoStep3, onPrev, onNext, onEditFlightInfo,
  } = props;

  // P0 dedup: 항공편 정보가 Step0에서 이미 채워져 있으면 입력칸 숨기고 칩으로 표시.
  const flightInfoFromStep0 = !!onEditFlightInfo && !!arrivalTerminal;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] sm:text-lg font-bold text-white mb-1">{p.planner_step2_date || 'Travel Details'}</h2>
        <p className="text-[13px] sm:text-sm text-white/55">{p.wizardDetailsSub || "When, who, and how you're arriving"}</p>
      </div>

      {/* Range Calendar */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardWhenVisit || 'When are you visiting?'}</p>
        <div className="cocotrip-calendar-wrap bg-white/[0.04] border border-white/[0.1] rounded-2xl p-3 sm:p-4">
          <DayPicker
            mode="range"
            selected={dateRange}
            onSelect={setDateRange}
            locale={calendarLocale}
            numberOfMonths={isMobile ? 1 : 2}
            disabled={{ before: new Date() }}
            showOutsideDays={false}
            classNames={{
              root: 'cocotrip-rdp',
            }}
          />
        </div>
        {nights > 0 && (
          <p className="text-sm text-[#7C5CFC] font-semibold mt-2">
            {(p.wizardNightsTrip || '{n} nights, {m} days trip').replace('{n}', String(nights)).replace('{m}', String(nights + 1))}
          </p>
        )}
      </div>

      {/* Travelers */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.planner_step2_adults || 'How many travelers?'}</p>
        <input type="number" value={paxInput} onChange={e => setPaxInput(e.target.value)} min={1} max={50}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
      </div>

      {/* P7: Daily tour pace — feeds Gemini hours-per-day budget */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.tourPaceLabel || 'Daily tour pace'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TOUR_PACE_KEYS.map((key) => {
            const fb = TOUR_PACE_FALLBACK[key];
            const cap = key.charAt(0).toUpperCase() + key.slice(1);
            const label = (p[`tourPace${cap}` as keyof typeof p] as string) || fb.label;
            const sub = (p[`tourPace${cap}Sub` as keyof typeof p] as string) || fb.sub;
            const sel = tourPace === key;
            return (
              <button key={key} type="button" onClick={() => setTourPace(key)}
                className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                  sel
                    ? (isMobile
                        ? 'bg-[#B668FC]/20 border-[#B668FC]/55 text-white'
                        : 'bg-[#7C5CFC]/20 border-[#7C5CFC]/55 text-white')
                    : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
                }`}>
                <span className="text-[13px] font-bold leading-tight">{label}</span>
                <span className="text-[10px] text-white/55 leading-tight">{sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Airport Dropdown — Step0에서 이미 입력한 경우 칩으로 대체 (P0 dedup) */}
      {flightInfoFromStep0 ? (
        <button
          type="button"
          onClick={onEditFlightInfo}
          className="w-full flex items-center justify-between bg-white/[0.04] border border-white/[0.10] hover:border-[#7C5CFC]/50 rounded-2xl px-4 py-3 transition-colors text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Plane className="w-4 h-4 text-[#7C5CFC] shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] text-white/50 font-medium">
                {p.flightInfoFromStep0Label || 'Flight info (from Step 1)'}
              </p>
              <p className="text-sm font-semibold text-white truncate">
                {airportOptions.find(o => o.value === arrivalTerminal)?.label || arrivalTerminal}
                {arrivalTime && <span className="text-white/55 font-normal ml-2">· {arrivalTime}</span>}
              </p>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-[#C99FFF] font-semibold shrink-0">
            <Pencil className="w-3 h-3" />
            {p.editLabel || 'Edit'}
          </span>
        </button>
      ) : (
        <div>
          <p className="text-sm text-white/50 mb-2.5 font-medium">
            {p.wizardWhichAirport || 'Which airport are you arriving at?'}
            {mainCity && <span className="text-white/55 ml-1">({mainCity})</span>}
          </p>
          <MobileSelectDrawer
            value={arrivalTerminal}
            onChange={setArrivalTerminal}
            title={p.wizardWhichAirport || 'Which airport?'}
            placeholder={p.wizardSelectAirport || '-- Select airport --'}
            options={airportOptions.map(opt => ({
              value: opt.value,
              label: opt.label,
            }))}
            icon={<Plane className="w-4 h-4 text-white/55" />}
          />
        </div>
      )}

      {/* Hotel */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">
          {p.hotel_address_title || 'Where are you staying?'}
          <span className="text-[#7C5CFC]/80 ml-1 text-[11px]">{p.hotelAccuracyHint || '(precise address = step-by-step transit guide)'}</span>
        </p>
        <input type="text" value={hotelAddress} onChange={e => setHotelAddress(e.target.value)}
          placeholder={p.hotel_placeholder || 'e.g. Lotte Hotel Myeongdong...'}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors" />
      </div>

      {/* Arrival / Departure flight time — used by RouteAgent to recommend the right transport
          (late-night arrival → limousine bus, otherwise AREX). Both optional.
          P0 dedup: 도착 시각이 Step0에서 이미 입력됐으면 입력칸 숨김 (위 칩에 같이 표시됨). */}
      <div className={flightInfoFromStep0 ? 'grid grid-cols-1 gap-2.5' : 'grid grid-cols-2 gap-2.5'}>
        {!flightInfoFromStep0 && (
          <div>
            <p className="text-sm text-white/50 mb-2 font-medium">{p.arrivalTime || 'Arrival time'} <span className="text-white/55 text-[11px]">({p.wizardOptional || 'optional'})</span></p>
            <input type="time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)}
              className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
          </div>
        )}
        <div>
          <p className="text-sm text-white/50 mb-2 font-medium">{p.departureTime || 'Departure time'} <span className="text-white/55 text-[11px]">({p.wizardOptional || 'optional'})</span></p>
          <input type="time" value={departureTime} onChange={e => setDepartureTime(e.target.value)}
            className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
        </div>
      </div>

      {/* Luggage counters — heavy bags trigger taxi recommendation in arrival_guide. */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <Briefcase className="w-4 h-4 text-[#7C5CFC]" />
          <p className="text-sm font-semibold text-white">{p.luggageTitle || 'Luggage'}</p>
          <span className="text-[11px] text-white/55 ml-auto">({p.wizardOptional || 'optional'})</span>
        </div>
        <div className="space-y-2">
          <LuggageCounter
            label={p.luggageSmall || 'Carry-on / Backpack'}
            sub={p.luggageSmallSub || 'Fits under seat'}
            value={luggageSmall} setValue={setLuggageSmall} />
          <LuggageCounter
            label={p.luggageMedium || 'Medium suitcase'}
            sub={p.luggageMediumSub || '24 inch'}
            value={luggageMedium} setValue={setLuggageMedium} />
          <LuggageCounter
            label={p.luggageLarge || 'Large suitcase'}
            sub={p.luggageLargeSub || '28 inch+'}
            value={luggageLarge} setValue={setLuggageLarge} />
        </div>
      </div>

      {/* Accommodation Recommendation Opt-in */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={wantAccom} onChange={e => setWantAccom(e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.06] accent-[#7C5CFC]" />
          <div>
            <p className="text-sm font-semibold text-white">{p.accomOptIn || 'Get AI hotel recommendations'}</p>
            <p className="text-[11px] text-white/55">{p.accomOptInSub || 'AI will suggest accommodations based on your itinerary'}</p>
          </div>
        </label>
        {wantAccom && (
          <div className="mt-3 pl-8">
            <p className="text-xs text-white/55 mb-2">{p.accomBudgetLabel || 'Accommodation budget'}</p>
            <div className="flex gap-2">
              {(['budget', 'moderate', 'luxury'] as const).map((lvl) => {
                const labels: Record<string, string> = {
                  budget: p.accomBudget1 || 'Budget',
                  moderate: p.accomBudget2 || 'Mid-range',
                  luxury: p.accomBudget3 || 'Luxury',
                };
                const sel = accomBudget === lvl;
                return (
                  <button key={lvl} onClick={() => setAccomBudget(lvl)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      sel ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'
                    }`}>
                    {labels[lvl]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <WizardNav
        onPrev={onPrev}
        onNext={onNext}
        prevLabel={p.planner_prev || 'Back'}
        nextLabel={p.wizardNextGenerate || 'Next: Generate'}
        disabled={!canGoStep3}
        isMobile={isMobile}
      />
    </div>
  );
}
