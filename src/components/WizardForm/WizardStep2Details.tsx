// Step 2: travel dates, pax, airport, hotel address, accommodation opt-in.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import type { Locale } from 'date-fns';
import type { AirportOption } from './data';
import type { WizardDict } from './types';

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
  wantAccom: boolean;
  setWantAccom: (v: boolean) => void;
  accomBudget: string;
  setAccomBudget: (v: string) => void;
  canGoStep3: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function WizardStep2Details(props: Step2Props) {
  const {
    p, isMobile, calendarLocale, dateRange, setDateRange, nights,
    paxInput, setPaxInput, mainCity, airportOptions,
    arrivalTerminal, setArrivalTerminal, hotelAddress, setHotelAddress,
    wantAccom, setWantAccom, accomBudget, setAccomBudget,
    canGoStep3, onPrev, onNext,
  } = props;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">{p.planner_step2_date || 'Travel Details'}</h2>
        <p className="text-sm text-white/40">{p.wizardDetailsSub || "When, who, and how you're arriving"}</p>
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

      {/* Airport Dropdown */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">
          {p.wizardWhichAirport || 'Which airport are you arriving at?'}
          {mainCity && <span className="text-white/25 ml-1">({mainCity})</span>}
        </p>
        <select
          value={arrivalTerminal}
          onChange={e => setArrivalTerminal(e.target.value)}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors appearance-none [color-scheme:dark]"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          <option value="" disabled className="bg-[#1a1a2e] text-white/50">
            {p.wizardSelectAirport || '-- Select airport --'}
          </option>
          {airportOptions.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#1a1a2e] text-white">
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Hotel */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.hotel_address_title || 'Where are you staying?'} <span className="text-white/25">({p.wizardOptional || 'optional'})</span></p>
        <input type="text" value={hotelAddress} onChange={e => setHotelAddress(e.target.value)}
          placeholder={p.hotel_placeholder || 'e.g. Lotte Hotel Myeongdong...'}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors" />
      </div>

      {/* Accommodation Recommendation Opt-in */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={wantAccom} onChange={e => setWantAccom(e.target.checked)}
            className="w-5 h-5 rounded border-white/20 bg-white/[0.06] accent-[#7C5CFC]" />
          <div>
            <p className="text-sm font-semibold text-white">{p.accomOptIn || 'Get AI hotel recommendations'}</p>
            <p className="text-[11px] text-white/35">{p.accomOptInSub || 'AI will suggest accommodations based on your itinerary'}</p>
          </div>
        </label>
        {wantAccom && (
          <div className="mt-3 pl-8">
            <p className="text-xs text-white/40 mb-2">{p.accomBudgetLabel || 'Accommodation budget'}</p>
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
      <div className="flex gap-3 pt-2">
        <button onClick={onPrev}
          className="px-4 py-3 rounded-xl border border-white/[0.12] text-white/50 hover:text-white text-sm font-semibold flex items-center gap-1 transition-all">
          <ChevronLeft className="w-4 h-4" /> {p.wizardFoodTitle || 'Back'}
        </button>
        <button onClick={onNext} disabled={!canGoStep3}
          className="flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] transition-all"
          style={{ background: canGoStep3 ? (isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)') : 'rgba(255,255,255,.1)' }}>
          {p.wizardNextGenerate || 'Next: Generate'} <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
