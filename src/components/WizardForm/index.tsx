// WizardForm container: holds shared wizard state + routes between steps.
// Previously src/components/WizardForm.tsx (798L) — split into step components
// under src/components/WizardForm/* for P3 Lock release.
import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MapPin, Calendar, Wand2, UtensilsCrossed, Check, Plane,
} from 'lucide-react';

import type { DateRange } from 'react-day-picker';
import { differenceInCalendarDays, format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-day-picker/style.css';
import type { PlannerFormValues } from '../PlannerForm';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';
import { haptic } from '@/lib/haptic';
import { requestNotifyPermission } from '@/lib/notify';

import { CITY_CHIPS, LOCALE_MAP } from './data';
import { getAirportOptions } from './helpers';
import { getZonesForCity } from './zoneData';
import { WizardStep0Reservation, type ReservationStatus } from './WizardStep0Reservation';
import { WizardStep0Destination } from './WizardStep0Destination';
import { WizardStep1Food } from './WizardStep1Food';
import { WizardStep2Details, type TourPace } from './WizardStep2Details';
import { WizardStep3Review } from './WizardStep3Review';

import type { WizardDict } from './types';

export function WizardForm({ onSubmit, isLoading }: { onSubmit: (values: PlannerFormValues) => Promise<{ ok: boolean; data?: Record<string, string> } | void>; isLoading: boolean }) {
  const { t, language } = useLanguage();
  const p = t.planner as unknown as WizardDict;
  const [step, setStep] = useState(0);
  const { user } = useAuth();
  const [errorMsg, setErrorMsg] = useState('');

  // P6 Step 0 (NEW): reservation status — captures arrival airport/time up
  // front so RouteAgent has real data instead of guessing during preview gen.
  const [reservationStatus, setReservationStatus] = useState<ReservationStatus | null>(null);

  // Step 1 (was 0): destinations
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
  // Sprint 2 #5: when user has no booked hotel, they can pick a Seoul zone
  // and the AI hubs stops near it. Empty string = no recommendation chosen.
  const [recommendedZone, setRecommendedZone] = useState('');
  // 2026-05-03 fix: 사용자가 Step 3 자체 input에서 공항을 만진 적 있으면
  // "from Step 1" chip으로 swap 안 함 (한 글자 칠 때마다 input이 chip으로 바뀌고
  // Edit 버튼이 Step 0으로 점프시키던 버그). reservationStatus가 바뀌면 reset.
  // 2026-05-05: 호텔 chip 분기 제거 (free-claim funnel 폐기) — airport touch만 추적.
  const [airportTouchedInStep3, setAirportTouchedInStep3] = useState(false);
  useEffect(() => {
    setAirportTouchedInStep3(false);
  }, [reservationStatus]);
  // P7: daily tour pace ('half'|'short'|'full'|'action') — defaults to full day.
  const [tourPace, setTourPace]               = useState<TourPace>('full');
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
    haptic('select');
    setSelectedActivities(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function toggleCity(cityName: string, chipKey?: string) {
    haptic('select');
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
    haptic('select');
    setDietPrefs(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function toggleAllergy(key: string) {
    haptic('select');
    if (key === 'None') { setAllergies([]); return; }
    setAllergies(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev.filter(k => k !== 'None'), key]);
  }

  async function handleGenerate() {
    haptic('select');
    setErrorMsg('');
    // Ask for notification permission at submit time — generation runs 30-90s
    // and users often switch tabs. Permission is fire-and-forget; if denied
    // or unsupported the rest of the flow is unaffected.
    void requestNotifyPermission();
    try { if (mainCity) localStorage.setItem('cocotrip_last_region', mainCity); } catch { /* silent */ }
    const sd = startDate || new Date().toISOString().split('T')[0];
    const ed = endDate || new Date(Date.now() + durationDays * 86400000).toISOString().split('T')[0];

    try {
      const totalLuggage = luggageSmall + luggageMedium + luggageLarge;
      // 2026-05-03: 사용자가 호텔 안 정하고 zone만 골랐을 때, zone의 anchorAddress
      // (대표 주소)를 백엔드에 같이 전달 → RouteAgent가 공항↔zone 단계별 환승
      // 경로 계산 가능. hotel_address는 그대로 빈 문자열 유지 (Firestore 저장 시
      // "호텔 안 정함" 의미).
      const zoneAnchor = (!hotelAddress && recommendedZone)
        ? getZonesForCity(mainCityKey || 'seoul').find(z => z.key === recommendedZone)?.anchorAddress
        : undefined;
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
        tourPace: tourPace !== 'full' ? tourPace : undefined,
        // New: airport-transport context (all optional)
        arrival_time: arrivalTime || undefined,
        departure_time: departureTime || undefined,
        luggage: totalLuggage > 0 ? { small: luggageSmall, medium: luggageMedium, large: luggageLarge } : undefined,
        // Sprint 2 #5: zone hint when no hotel typed (string key like 'myeongdong').
        recommended_zone: !hotelAddress && recommendedZone ? recommendedZone : undefined,
        // 2026-05-03: zone의 대표 주소 (RouteAgent가 공항↔zone 환승 경로 계산용).
        recommended_zone_address: zoneAnchor,
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

  // P6: 5-step layout starts with reservation check.
  // 2026-05-05: free-claim funnel(`all_done`) 제거에 따라 isClaimFlow 분기 삭제.
  const STEPS = [
    { label: p.resTitle || 'Reservation', icon: <Plane className="w-3.5 h-3.5" /> },
    { label: p.wizardTitle || 'Destinations', icon: <MapPin className="w-3.5 h-3.5" /> },
    { label: p.wizardFoodTitle || 'Food', icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
    { label: p.planner_step2_date || 'Details', icon: <Calendar className="w-3.5 h-3.5" /> },
    { label: p.planner_generate_cta || 'Generate', icon: <Wand2 className="w-3.5 h-3.5" /> },
  ];

  // Build the list of currently-selected city chip keys for P9 dynamic chips.
  const selectedCityKeys: string[] = [];
  if (mainCityKey) selectedCityKeys.push(mainCityKey);
  for (const en of extraCities) {
    const k = CITY_CHIPS.find(c => getCityName(c.key) === en)?.key;
    if (k && !selectedCityKeys.includes(k)) selectedCityKeys.push(k);
  }

  function goToStep(i: number) {
    haptic('tap');
    setStep(i);
  }

  return (
    <>
      <div className="w-full">
        {/* Step Indicator — mobile mb 32px -> 20px, tighter spacing while preserving tap target */}
        <div className="flex items-center justify-center gap-1 mb-5 sm:mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center">
              <button onClick={() => { if (i <= step) goToStep(i); }}
                className={`flex items-center gap-1.5 sm:gap-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-full text-xs font-semibold transition-all ${
                  i === step ? 'text-white' : i < step ? 'text-[#7C5CFC] cursor-pointer hover:text-white' : 'text-white/55 cursor-default'
                }`}>
                <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] sm:text-[11px] font-bold transition-all ${
                  i === step ? 'text-white shadow-lg' : i < step ? 'bg-[#7C5CFC]/25 text-[#7C5CFC]' : 'bg-white/[0.06] text-white/55'
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
          {/* AnimatePresence + motion.div로 step 전환 시 슬라이드/페이드.
              key={step}로 React가 unmount/mount 인식 → exit 애니 발동. */}
          <AnimatePresence initial={false}>
            <motion.div
              key={`step-${step}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              {/* Step 0: reservation status (P6) */}
              {step === 0 && (
                <WizardStep0Reservation
                  p={p} isMobile={isMobile}
                  status={reservationStatus} setStatus={setReservationStatus}
                  arrivalAirport={arrivalTerminal} setArrivalAirport={setArrivalTerminal}
                  arrivalTime={arrivalTime} setArrivalTime={setArrivalTime}
                  hotelAddress={hotelAddress} setHotelAddress={setHotelAddress}
                  mainCityKey={mainCityKey || 'seoul'}
                  onNext={() => goToStep(1)}
                />
              )}
              {/* Step 1: destinations */}
              {step === 1 && (
                <WizardStep0Destination
                  p={p} isMobile={isMobile}
                  mainCity={mainCity} mainCityKey={mainCityKey}
                  extraCities={extraCities}
                  selectedCityKeys={selectedCityKeys}
                  selectedActivities={selectedActivities} freeText={freeText}
                  setMainCity={setMainCity} setMainCityKey={setMainCityKey}
                  setExtraCities={setExtraCities} setSelectedActivities={setSelectedActivities} setFreeText={setFreeText}
                  allCities={allCities} canGoStep1={canGoStep1}
                  getCityName={getCityName} toggleActivity={toggleActivity}
                  toggleCity={toggleCity} isCitySelected={isCitySelected}
                  onPrev={() => goToStep(0)} onNext={() => goToStep(2)}
                />
              )}
              {step === 2 && (
                <WizardStep1Food
                  p={p} isMobile={isMobile}
                  dietPrefs={dietPrefs} allergies={allergies} priceRange={priceRange}
                  spiceLevel={spiceLevel} bucketDishes={bucketDishes}
                  toggleDiet={toggleDiet} toggleAllergy={toggleAllergy} setPriceRange={setPriceRange}
                  setSpiceLevel={setSpiceLevel}
                  toggleBucketDish={(k: string) => setBucketDishes(prev => prev.includes(k) ? prev.filter(d => d !== k) : [...prev, k])}
                  onPrev={() => goToStep(1)} onNext={() => goToStep(3)}
                />
              )}
              {step === 3 && (
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
                  tourPace={tourPace} setTourPace={setTourPace}
                  recommendedZone={recommendedZone} setRecommendedZone={setRecommendedZone}
                  mainCityKey={mainCityKey || 'seoul'}
                  canGoStep3={canGoStep3}
                  onPrev={() => goToStep(2)} onNext={() => goToStep(4)}
                  onEditStep0={() => goToStep(0)}
                  reservationStatus={reservationStatus}
                  airportTouchedInStep3={airportTouchedInStep3}
                  setAirportTouchedInStep3={setAirportTouchedInStep3}
                />
              )}
              {step === 4 && (
                <WizardStep3Review
                  p={p}
                  allCities={allCities} startDate={startDate} endDate={endDate}
                  arrivalTerminal={arrivalTerminal} pax={pax}
                  selectedActivities={selectedActivities} hotelAddress={hotelAddress}
                  isLoading={isLoading} errorMsg={errorMsg}
                  onEditStep={(s) => goToStep(s)} onGenerate={handleGenerate}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
