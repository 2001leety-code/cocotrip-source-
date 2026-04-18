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

export function WizardForm({ onSubmit, isLoading }: any) {
  const { t, language } = useLanguage();
  const p: any = t.planner;
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

  // Step 2: travel details
  const [dateRange, setDateRange]             = useState<DateRange | undefined>();
  const [paxInput, setPaxInput]               = useState('2');
  const [arrivalTerminal, setArrivalTerminal] = useState('');
  const [hotelAddress, setHotelAddress]       = useState('');
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
  const durationDays = nights > 0 ? nights + 1 : 3;
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
    const existing = (p as any)[`city_${key}`];
    if (existing) return existing;
    const fallback = (p as any)[`city${key.charAt(0).toUpperCase()}${key.slice(1)}`];
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
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center">
              <button onClick={() => { if (i <= step) setStep(i); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  i === step ? 'text-white' : i < step ? 'text-[#7C5CFC] cursor-pointer hover:text-white' : 'text-white/20 cursor-default'
                }`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                  i === step ? 'text-white shadow-lg' : i < step ? 'bg-[#7C5CFC]/25 text-[#7C5CFC]' : 'bg-white/[0.06] text-white/20'
                }`} style={i === step ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 0 12px rgba(124,92,252,.5)' } : {}}>
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`w-8 sm:w-14 h-0.5 rounded-full mx-1 transition-colors ${i < step ? 'bg-[#7C5CFC]/50' : 'bg-white/[0.06]'}`} />
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
              toggleDiet={toggleDiet} toggleAllergy={toggleAllergy} setPriceRange={setPriceRange}
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
