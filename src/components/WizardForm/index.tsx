// WizardForm container: holds shared wizard state + routes between steps.
// Previously src/components/WizardForm.tsx (798L) — split into step components
// under src/components/WizardForm/* for P3 Lock release.
import { useState, useEffect } from 'react';
import {
  MapPin, Calendar, Wand2, UtensilsCrossed, Check,
} from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { differenceInCalendarDays, format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-day-picker/style.css';
import type { PlannerFormValues } from '../PlannerForm';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';

import { CITY_CHIPS, LOCALE_MAP } from './data';
import { getAirportOptions } from './helpers';
import { WizardStep0Destination } from './WizardStep0Destination';
import { WizardStep1Food } from './WizardStep1Food';
import { WizardStep2Details } from './WizardStep2Details';
import { WizardStep3Review } from './WizardStep3Review';

import type { WizardDict } from './types';

export function WizardForm({ onSubmit, isLoading }: { onSubmit: (values: PlannerFormValues) => Promise<{ ok: boolean; data?: Record<string, string> } | void>; isLoading: boolean }) {
  const { t, language } = useLanguage();
  const p = t.planner as unknown as WizardDict;
  const [step, setStep] = useState(0);
  const { user } = useAuth();
  const [errorMsg, setErrorMsg] = useState('');

  // Step 0: destinations
  const [mainCity, setMainCity]               = useState('');
  const [mainCityKey, setMainCityKey]         = useState('');
  const [extraCities, setExtraCities]         = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [freeText, setFreeText]               = useState('');

  // Step 1: food preferences
  const [dietPrefs, setDietPrefs]   = useState<string[]>([]);
  const [allergies, setAllergies]   = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState('Any');
  // P10: spice tolerance + Korean dish bucket list (separate from style chips).
  const [spiceLevel, setSpiceLevel] = useState<string>('medium');
  const [bucketDishes, setBucketDishes] = useState<string[]>([]);

  // Step 2: travel details
  const [dateRange, setDateRange]             = useState<DateRange | undefined>();
  const [paxInput, setPaxInput]               = useState('2');
  const [arrivalTerminal, setArrivalTerminal] = useState('');
  const [hotelAddress, setHotelAddress]       = useState('');
  // Klook/Trip.com pattern: collect arrival time + luggage so backend can
  // recommend the right airport-to-hotel transport (late night → limousine,
  // heavy bags → taxi, otherwise AREX). All optional but improves accuracy.
  const [arrivalTime, setArrivalTime]         = useState('');     // "HH:MM" 24h
  const [departureTime, setDepartureTime]     = useState('');     // "HH:MM" 24h
  const [luggageSmall, setLuggageSmall]       = useState(0);
  const [luggageMedium, setLuggageMedium]     = useState(0);
  const [luggageLarge, setLuggageLarge]       = useState(0);
  const [wantAccom, setWantAccom]             = useState(false);
  const [accomBudget, setAccomBudget]         = useState('moderate');
  const mobility = 'ok' as const;

  // Responsive — mobile vs desktop for calendar
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 640 : true);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // derived
  const allCities = mainCity ? [mainCity, ...extraCities.filter(c => c !== mainCity)] : [];
  const startDate = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
  const endDate = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';
  const nights = dateRange?.from && dateRange?.to ? differenceInCalendarDays(dateRange.to, dateRange.from) : 0;
  // P8 (2026-04-24): allow 1-day plans. Same-day pick (nights=0 with both
  // dates set) → 1 day, not the previous 3-day forced default.
  // Only fall back to 3 when no dates picked at all.
  const datesPicked = !!(dateRange?.from && dateRange?.to);
  const durationDays = datesPicked ? Math.max(1, nights + 1) : 3;
  const pax = parseInt(paxInput) || 2;
  const departureAirport = arrivalTerminal;

  const airportOptions = getAirportOptions(mainCityKey || 'seoul');

  // Reset airport when mainCity changes
  useEffect(() => {
    const validValues = airportOptions.map(o => o.value);
    if (arrivalTerminal && !validValues.includes(arrivalTerminal)) {
      setArrivalTerminal('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainCityKey]);

  const calendarLocale = LOCALE_MAP[language] || enUS;

  // validation
  const canGoStep1 = mainCity !== '' && selectedActivities.length > 0;
  const canGoStep3 = startDate !== '' && endDate !== '' && pax >= 1 && arrivalTerminal !== '';

  // helpers local to the container
  function getCityName(key: string) {
    const existing = p[`city_${key}`];
    if (existing) return existing;
    const fallback = p[`city${key.charAt(0).toUpperCase()}${key.slice(1)}`];
    return fallback || key.charAt(0).toUpperCase() + key.slice(1);
  }

  function toggleActivity(key: string) {
    setSelectedActivities(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function toggleCity(cityName: string, chipKey?: string) {
    if (mainCity === cityName) {
      const next = extraCities[0] || '';
      setMainCity(next);
      setMainCityKey(next ? (CITY_CHIPS.find(c => getCityName(c.key) === next)?.key || '') : '');
      setExtraCities(prev => prev.slice(1));
    } else if (extraCities.includes(cityName)) {
      setExtraCities(prev => prev.filter(c => c !== cityName));
    } else if (!mainCity) {
      setMainCity(cityName);
      setMainCityKey(chipKey || '');
    } else {
      setExtraCities(prev => [...prev, cityName]);
    }
  }

  function isCitySelected(cityName: string) {
    return mainCity === cityName || extraCities.includes(cityName);
  }

  function toggleDiet(key: string) {
    setDietPrefs(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function toggleAllergy(key: string) {
    if (key === 'None') { setAllergies([]); return; }
    setAllergies(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev.filter(k => k !== 'None'), key]);
  }

  async function handleGenerate() {
    setErrorMsg('');
    try { if (mainCity) localStorage.setItem('cocotrip_last_region', mainCity); } catch { /* silent */ }
    const sd = startDate || new Date().toISOString().split('T')[0];
    const ed = endDate || new Date(Date.now() + durationDays * 86400000).toISOString().split('T')[0];

    try {
      const totalLuggage = luggageSmall + luggageMedium + luggageLarge;
      const res = await onSubmit({
        startDate: sd, endDate: ed,
        regions: allCities.length > 0 ? allCities : ['Seoul'],
        categories: selectedActivities, transport: 'staria', pax, durationDays,
        freeText: freeText || '',
        arrival_airport: arrivalTerminal,
        departure_airport: departureAirport,
        hotel_address: hotelAddress,
        mobility,
        uid: user?.uid || null,
        wantAccom: wantAccom || undefined,
        accomBudget: wantAccom ? accomBudget : undefined,
        dietPrefs: dietPrefs.length > 0 ? dietPrefs : undefined,
        allergies: allergies.length > 0 ? allergies : undefined,
        priceRange: priceRange !== 'Any' ? priceRange : undefined,
        spiceLevel: spiceLevel !== 'medium' ? spiceLevel : undefined,
        bucketDishes: bucketDishes.length > 0 ? bucketDishes : undefined,
        // New: airport-transport context (all optional)
        arrival_time: arrivalTime || undefined,
        departure_time: departureTime || undefined,
        luggage: totalLuggage > 0 ? { small: luggageSmall, medium: luggageMedium, large: luggageLarge } : undefined,
      } as PlannerFormValues);

      if (res && !res.ok) {
        const data = res.data || {};
        if (data.code === 'GEMINI_TIMEOUT') {
          setErrorMsg('AI is taking too long. Please try again in a moment.');
        } else {
          setErrorMsg(data.error || 'Something went wrong. Please try again.');
        }
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.');
    }
  }

  const STEPS = [
    { label: p.wizardTitle || 'Destinations', icon: <MapPin className="w-3.5 h-3.5" /> },
    { label: p.wizardFoodTitle || 'Food', icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
    { label: p.planner_step2_date || 'Details', icon: <Calendar className="w-3.5 h-3.5" /> },
    { label: p.planner_generate_cta || 'Generate', icon: <Wand2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <>
      <div className="w-full">
        {/* Step Indicator — mobile mb 32px -> 20px, tighter spacing while preserving tap target */}
        <div className="flex items-center justify-center gap-1 mb-5 sm:mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center">
              <button onClick={() => { if (i <= step) setStep(i); }}
                className={`flex items-center gap-1.5 sm:gap-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-full text-xs font-semibold transition-all ${
                  i === step ? 'text-white' : i < step ? 'text-[#7C5CFC] cursor-pointer hover:text-white' : 'text-white/20 cursor-default'
                }`}>
                <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] sm:text-[11px] font-bold transition-all ${
                  i === step ? 'text-white shadow-lg' : i < step ? 'bg-[#7C5CFC]/25 text-[#7C5CFC]' : 'bg-white/[0.06] text-white/20'
                }`} style={i === step ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 0 12px rgba(124,92,252,.5)' } : {}}>
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`w-6 sm:w-14 h-0.5 rounded-full mx-1 transition-colors ${i < step ? 'bg-[#7C5CFC]/50' : 'bg-white/[0.06]'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          {step === 0 && (
            <WizardStep0Destination
              p={p} isMobile={isMobile}
              mainCity={mainCity} mainCityKey={mainCityKey}
              extraCities={extraCities} selectedActivities={selectedActivities} freeText={freeText}
              setMainCity={setMainCity} setMainCityKey={setMainCityKey}
              setExtraCities={setExtraCities} setSelectedActivities={setSelectedActivities} setFreeText={setFreeText}
              allCities={allCities} canGoStep1={canGoStep1}
              getCityName={getCityName} toggleActivity={toggleActivity}
              toggleCity={toggleCity} isCitySelected={isCitySelected}
              onNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <WizardStep1Food
              p={p} isMobile={isMobile}
              dietPrefs={dietPrefs} allergies={allergies} priceRange={priceRange}
              spiceLevel={spiceLevel} bucketDishes={bucketDishes}
              toggleDiet={toggleDiet} toggleAllergy={toggleAllergy} setPriceRange={setPriceRange}
              setSpiceLevel={setSpiceLevel}
              toggleBucketDish={(k: string) => setBucketDishes(prev => prev.includes(k) ? prev.filter(d => d !== k) : [...prev, k])}
              onPrev={() => setStep(0)} onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <WizardStep2Details
              p={p} isMobile={isMobile} calendarLocale={calendarLocale}
              dateRange={dateRange} setDateRange={setDateRange} nights={nights}
              paxInput={paxInput} setPaxInput={setPaxInput}
              mainCity={mainCity} airportOptions={airportOptions}
              arrivalTerminal={arrivalTerminal} setArrivalTerminal={setArrivalTerminal}
              hotelAddress={hotelAddress} setHotelAddress={setHotelAddress}
              arrivalTime={arrivalTime} setArrivalTime={setArrivalTime}
              departureTime={departureTime} setDepartureTime={setDepartureTime}
              luggageSmall={luggageSmall} setLuggageSmall={setLuggageSmall}
              luggageMedium={luggageMedium} setLuggageMedium={setLuggageMedium}
              luggageLarge={luggageLarge} setLuggageLarge={setLuggageLarge}
              wantAccom={wantAccom} setWantAccom={setWantAccom}
              accomBudget={accomBudget} setAccomBudget={setAccomBudget}
              canGoStep3={canGoStep3}
              onPrev={() => setStep(1)} onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <WizardStep3Review
              p={p}
              allCities={allCities} startDate={startDate} endDate={endDate}
              arrivalTerminal={arrivalTerminal} pax={pax}
              selectedActivities={selectedActivities} hotelAddress={hotelAddress}
              isLoading={isLoading} errorMsg={errorMsg}
              onEditStep={(s) => setStep(s)} onGenerate={handleGenerate}
            />
          )}
        </div>
      </div>
    </>
  );
}
