import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  MapPin, Users, Calendar, Wand2,
  ArrowRight, ChevronDown,
  ChevronRight, ChevronLeft, Check,
  Music2, Sparkles, Shirt, UtensilsCrossed, Moon, Camera, ShoppingBag,
  Film, Landmark, Mountain, Building2, Car, Hotel, Train, Accessibility, Plane,
} from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';
import { PICKUP_PRICES } from '@/config/affiliateLinks';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';

/* ═══════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════ */
const AIRPORT_GROUPS_DATA = [
  { labelKey: 'airportGroupCapital' as const, airports: [
    { code: 'ICN', name: 'ICN – Incheon Intl' },
    { code: 'GMP', name: 'GMP – Gimpo Intl' },
  ]},
  { labelKey: 'airportGroupGyeongsang' as const, airports: [
    { code: 'PUS', name: 'PUS – Gimhae Intl' },
    { code: 'TAE', name: 'TAE – Daegu Intl' },
  ]},
  { labelKey: 'airportGroupJeolla' as const, airports: [
    { code: 'KWJ', name: 'KWJ – Gwangju' },
    { code: 'MWX', name: 'MWX – Muan Intl' },
  ]},
  { labelKey: 'airportGroupGangwon' as const, airports: [
    { code: 'YNY', name: 'YNY – Yangyang Intl' },
  ]},
  { labelKey: 'airportGroupJeju' as const, airports: [
    { code: 'CJU', name: 'CJU – Jeju Intl' },
  ]},
];

const CITY_KEYS = ['seoul','busan','gyeongju','jeonju','jeju','gangneung','incheon','yeosu','suwon','daegu'] as const;

const ACTIVITY_ICON_MAP: Record<string, ReactNode> = {
  Kpop:     <Music2 className="w-5 h-5" />,
  Kbeauty:  <Sparkles className="w-5 h-5" />,
  Hanbok:   <Shirt className="w-5 h-5" />,
  Food:     <UtensilsCrossed className="w-5 h-5" />,
  Night:    <Moon className="w-5 h-5" />,
  Photo:    <Camera className="w-5 h-5" />,
  Shopping: <ShoppingBag className="w-5 h-5" />,
  Drama:    <Film className="w-5 h-5" />,
  Temple:   <Landmark className="w-5 h-5" />,
  Dmz:      <Mountain className="w-5 h-5" />,
};

const ACTIVITY_KEYS = [
  'Kpop', 'Kbeauty', 'Hanbok', 'Food', 'Night',
  'Photo', 'Shopping', 'Drama', 'Temple', 'Dmz',
] as const;

function buildSlimCards(code: string, cities: string[], p: any) {
  const city = cities[0] || 'Seoul';
  const q = encodeURIComponent(city);
  const cards: { icon: ReactNode; text: string; cta: string; url: string }[] = [];
  const pickup = (PICKUP_PRICES[code] || [])[0];
  if (pickup) cards.push({ icon: <Car className="w-4 h-4" />, text: `${code} ${p.slimAirportPickup} · ${pickup.price}`, cta: p.slimBook, url: 'https://cocotripkr.com/charter' });
  cards.push({ icon: <Hotel className="w-4 h-4" />, text: `${city} ${p.slimHotelLowest}`, cta: p.slimCompare, url: `https://www.booking.com/searchresults.html?ss=${q}&no_rooms=1&group_adults=2` });
  if (['ICN', 'GMP'].includes(code) && cities.length > 1)
    cards.push({ icon: <Train className="w-4 h-4" />, text: `${cities[0]} → ${cities[cities.length - 1]} ${p.slimKTX}`, cta: p.slimBookKTX, url: 'https://www.letskorail.com/ebizbf/EbizBfKrbs020a.do' });
  else if (cities.length > 0)
    cards.push({ icon: <Car className="w-4 h-4" />, text: `${city} ${p.slimRentCar}`, cta: p.slimSearch, url: `https://www.rentalcars.com/en/search/Korea/${q}/` });
  return cards;
}

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */
export function WizardForm({ onSubmit, isLoading }: any) {
  const { t } = useLanguage();
  const p: any = t.planner;
  const [step, setStep] = useState(0);

  const { user } = useAuth();

  // data
  const [airportCode, setAirportCode]         = useState('');
  const [showCustom, setShowCustom]           = useState(false);
  const [customAirport, setCustomAirport]     = useState('');
  const [mainCity, setMainCity]               = useState('');
  const [areaType, setAreaType]               = useState<'seoul_city' | 'seoul_day' | 'provincial' | ''>('');
  const [extraCities, setExtraCities]         = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [freeText, setFreeText]               = useState('');
  const [startDate, setStartDate]             = useState('');
  const [endDate, setEndDate]                 = useState('');
  const [paxInput, setPaxInput]               = useState('2');

  // v2 fields
  const [arrivalTerminal, setArrivalTerminal] = useState<'ICN_T1'|'ICN_T2'|'GMP'|'already_in_korea'|''>('');
  const [departureAirport, setDepartureAirport] = useState<'same'|'ICN_T1'|'ICN_T2'|'GMP'|''>('same');
  const [hotelAddress, setHotelAddress]       = useState('');
  const [mobility, setMobility]              = useState<'ok'|'limited'>('ok');


  const effectiveAirport = airportCode || (showCustom && customAirport ? customAirport : '');
  const allCities = mainCity ? [mainCity, ...extraCities.filter(c => c !== mainCity)] : [];
  const slimCards = effectiveAirport ? buildSlimCards(airportCode || customAirport, allCities, p) : [];

  const durationDays = (startDate && endDate) ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)) : 3;
  const pax = parseInt(paxInput) || 2;

  // city name helper using existing city_* keys in i18n
  function getCityName(key: string) {
    // 기존 i18n 키: city_seoul, city_busan 등 사용
    const existing = (p as any)[`city_${key}`];
    if (existing) return existing;
    // 없는 도시는 새 키 사용 (incheon, yeosu, suwon, daegu)
    const fallback = (p as any)[`city${key.charAt(0).toUpperCase()}${key.slice(1)}`];
    return fallback || key;
  }

  function handleAirportChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === '__custom__') { setShowCustom(true); setAirportCode(''); }
    else { setShowCustom(false); setAirportCode(v); setCustomAirport(''); }
  }

  function toggleActivity(key: string) {
    setSelectedActivities(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function handleGenerate() {
    const sd = startDate || new Date().toISOString().split('T')[0];
    const ed = endDate || new Date(Date.now() + durationDays * 86400000).toISOString().split('T')[0];
    onSubmit({
      startDate: sd, endDate: ed,
      regions: allCities.length > 0 ? allCities : ['Seoul'],
      categories: selectedActivities, transport: 'staria', pax, durationDays,
      freeText: freeText || '',
      // v2 fields
      arrival_airport: arrivalTerminal,
      departure_airport: departureAirport === 'same' ? arrivalTerminal : departureAirport,
      hotel_address: hotelAddress,
      mobility,
      uid: user?.uid || null,
    } as PlannerFormValues);
  }


  const STEP_TITLES = [p.wizardAirportTitle?.split('?')[0]?.split('？')[0] || p.planner_step1_airport, p.wizardTitle?.split('?')[0]?.split('？')[0] || p.planner_step1_cities, p.planner_step2_date, p.planner_generate_cta?.split(' ')[0] || 'Generate'];

  /* ═══════════════════════════════════════════════════════
     STEP 0: 공항 드롭다운
  ═══════════════════════════════════════════════════════ */
  const renderStepAirport = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">{p.wizardAirportTitle}</h2>
      <p className="text-sm text-white/40">{p.wizardAirportHint}</p>

      <div className="relative">
        <select value={showCustom ? '__custom__' : airportCode} onChange={handleAirportChange}
          className="w-full appearance-none bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl pl-5 pr-12 py-4 text-base cursor-pointer focus:outline-none focus:border-[#7C5CFC]/70 transition-colors">
          <option value="" disabled className="bg-[#0f111a]">{p.wizardAirportPh}</option>
          {AIRPORT_GROUPS_DATA.map(g => (
            <optgroup key={g.labelKey} label={`── ${(p as any)[g.labelKey] || g.labelKey} ──`} className="bg-[#0f111a]">
              {g.airports.map(a => <option key={a.code} value={a.code} className="bg-[#0f111a]">{a.name}</option>)}
            </optgroup>
          ))}
          <optgroup label={`── ${p.airportGroupOther} ──`} className="bg-[#0f111a]">
            <option value="__custom__" className="bg-[#0f111a]">{p.wizardAirportCustom}</option>
          </optgroup>
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 pointer-events-none" />
      </div>

      {showCustom && (
        <input type="text" value={customAirport} onChange={e => setCustomAirport(e.target.value)}
          placeholder={p.wizardAirportCustomPh} autoFocus
          className="w-full bg-white/[0.06] border border-[#7C5CFC]/40 text-white placeholder-white/30 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-[#7C5CFC]/70" />
      )}

      {effectiveAirport && (PICKUP_PRICES[airportCode] || []).length > 0 && (
        <a href="https://cocotripkr.com/charter" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-4 px-5 py-4 rounded-2xl border border-[#7C5CFC]/25 hover:border-[#7C5CFC]/50 transition-all group"
          style={{ background: 'rgba(124,92,252,.08)' }}>
          <Car className="w-6 h-6 text-[#7C5CFC] shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-white">{effectiveAirport} {p.wizardAirportTitle?.split('?')[0] || 'Airport Pickup'} — Staria Private</p>
            <p className="text-xs text-[#7C5CFC] mt-0.5">{(PICKUP_PRICES[airportCode] || [])[0]?.price ?? '₩124,800~'} · No Hidden Fee</p>
          </div>
          <span className="text-xs font-bold text-white/50 group-hover:text-[#7C5CFC] shrink-0">{p.paypalBookBtn?.split(' ')[0] || 'Book'} →</span>
        </a>
      )}

      <button onClick={() => setStep(1)} disabled={!effectiveAirport}
        className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] transition-all"
        style={{ background: effectiveAirport ? 'linear-gradient(135deg,#7C5CFC,#EA537E)' : 'rgba(255,255,255,.1)' }}>
        {p.planner_next || 'Next'}: {p.planner_step1_cities || 'Select Cities'} <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     STEP 1: 도시 + 카테고리 + 자유입력
  ═══════════════════════════════════════════════════════ */
  const renderStepCities = () => (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-white">{p.wizardTitle}</h2>

      {/* 0. Quick Area Type (TourInputSheet-inspired) */}
      <div>
        <p className="text-sm text-white/40 mb-2">{p.tripAreaLabel}</p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: 'seoul_city' as const, icon: <Building2 className="w-5 h-5" />, label: p.tripAreaSeoulCity, city: 'seoul', dayTrip: false },
            { id: 'seoul_day'  as const, icon: <Car className="w-5 h-5" />,       label: p.tripAreaSeoulDay,  city: 'seoul', dayTrip: true  },
            { id: 'provincial' as const, icon: <Mountain className="w-5 h-5" />,  label: p.tripAreaProvincial, city: 'busan', dayTrip: false },
          ]).map(area => {
            const isSelected = areaType === area.id;
            return (
              <button key={area.id} onClick={() => {
                setAreaType(area.id);
                setMainCity(getCityName(area.city));
                // seoul_day: 서울 + 수원(근교) 자동 추가
                if (area.dayTrip) {
                  const daytripCity = getCityName('suwon');
                  setExtraCities(prev => prev.includes(daytripCity) ? prev : [daytripCity]);
                } else {
                  setExtraCities([]);
                }
              }}
                className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-center transition-all ${
                  isSelected ? 'border-[#7C5CFC] bg-[#7C5CFC]/10 text-white shadow-[0_0_10px_rgba(124,92,252,0.15)]' : 'border-white/[0.1] bg-white/[0.04] text-white/55 hover:border-[#7C5CFC]/50 hover:text-white/80'
                }`}>
                {area.icon}
                <span className="text-xs font-semibold">{area.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. 메인 도시 드롭다운 */}
      <div>
        <p className="text-sm text-white/40 mb-2">1. {p.wizardMainCity}</p>
        <div className="relative">
          <select value={mainCity} onChange={e => setMainCity(e.target.value)}
            className="w-full appearance-none bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl pl-5 pr-12 py-4 text-base cursor-pointer focus:outline-none focus:border-[#7C5CFC]/70 transition-colors">
            <option value="" disabled className="bg-[#0f111a]">{p.wizardMainCityPh}</option>
            {CITY_KEYS.map(key => <option key={key} value={getCityName(key)} className="bg-[#0f111a]">{getCityName(key)}</option>)}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 pointer-events-none" />
        </div>
      </div>

      {/* 2. 추가 도시 드롭다운 (멀티) */}
      <div>
        <p className="text-sm text-white/40 mb-2">2. {p.wizardExtraCities} <span className="text-white/25">({p.wizardExtraOptional})</span></p>
        <div className="relative">
          <select value="" onChange={e => {
            const v = e.target.value;
            if (v && !extraCities.includes(v) && v !== mainCity) setExtraCities(prev => [...prev, v]);
          }}
            className="w-full appearance-none bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl pl-5 pr-12 py-4 text-base cursor-pointer focus:outline-none focus:border-[#7C5CFC]/70 transition-colors">
            <option value="" className="bg-[#0f111a]">{p.wizardExtraCitiesPh}</option>
            {CITY_KEYS.filter(key => getCityName(key) !== mainCity && !extraCities.includes(getCityName(key)))
              .map(key => <option key={key} value={getCityName(key)} className="bg-[#0f111a]">{getCityName(key)}</option>)}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 pointer-events-none" />
        </div>
        {extraCities.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {extraCities.map(city => (
              <button key={city} onClick={() => setExtraCities(prev => prev.filter(c => c !== city))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white border border-[#EA537E]/40 bg-[#EA537E]/12 hover:bg-[#EA537E]/25 transition-all">
                {city} <span className="text-white/40 hover:text-white">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. 하고 싶은 것들 — 카테고리 칩 */}
      <div>
        <p className="text-sm text-white/40 mb-1">{`3. ${p.wizardActivities}`}</p>
        <p className="text-xs text-white/25 mb-3">{p.wizardActivitiesHint}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ACTIVITY_KEYS.map((key) => {
            const nameKey = `act${key}` as keyof typeof p;
            const subKey = `act${key}Sub` as keyof typeof p;
            const sel = selectedActivities.includes(key);
            return (
              <button key={key} onClick={() => toggleActivity(key)}
                className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-left transition-all ${
                  sel
                    ? 'border-transparent text-white shadow-lg'
                    : 'border-white/[0.1] bg-white/[0.04] text-white/60 hover:border-white/25 hover:text-white'
                }`}
                style={sel ? { background: 'linear-gradient(135deg,rgba(124,92,252,.35),rgba(234,83,126,.35))', borderColor: 'rgba(124,92,252,.5)' } : {}}>
                <span className="shrink-0">{ACTIVITY_ICON_MAP[key]}</span>
                <div className="overflow-hidden">
                  <p className="text-sm font-bold truncate">{(p as any)[nameKey]}</p>
                  <p className="text-[10px] text-white/40 truncate">{(p as any)[subKey]}</p>
                </div>
                {sel && <Check className="w-4 h-4 ml-auto text-[#7C5CFC] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. 가고 싶은 곳 직접 입력 */}
      <div>
        <p className="text-sm text-white/40 mb-2">4. {p.wizardFreeInput} <span className="text-white/25">({p.wizardOptional})</span></p>
        <textarea value={freeText} onChange={e => setFreeText(e.target.value)}
          placeholder={p.wizardFreeInputPh}
          rows={3}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 resize-none transition-colors" />
      </div>

      {/* 동선 표시 */}
      {allCities.length > 0 && (
        <div className="flex items-center gap-2 text-sm flex-wrap bg-white/[0.04] border border-white/[0.08] rounded-2xl px-4 py-3">
          <MapPin className="w-4 h-4 text-[#7C5CFC] shrink-0" />
          {allCities.map((c, i) => (
            <span key={c} className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>{i + 1}</span>
              <span className="font-bold text-white">{c}</span>
              {i < allCities.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-white/25" />}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => setStep(0)}
          className="px-5 py-3.5 rounded-2xl border border-white/[0.12] text-white/50 hover:text-white text-sm font-semibold flex items-center gap-1 transition-all">
          <ChevronLeft className="w-4 h-4" /> {p.planner_prev || 'Back'}
        </button>
        <button onClick={() => setStep(2)} disabled={!mainCity}
          className="flex-1 py-3.5 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] transition-all"
          style={{ background: mainCity ? 'linear-gradient(135deg,#7C5CFC,#EA537E)' : 'rgba(255,255,255,.1)' }}>
          {p.planner_next || 'Next'}: {p.planner_step2_date || 'Dates & Group'} <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     STEP 2: 캘린더 날짜 + 인원 직접입력
  ═══════════════════════════════════════════════════════ */
  const renderStepDetails = () => (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-white">{p.planner_step2_date || 'Travel Dates & Group Size'}</h2>

      {/* 캘린더 날짜 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-white/40 mb-2 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {p.startDate || 'Start Date'}</p>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            placeholder="YYYY-MM-DD"
            className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl px-5 py-3 sm:py-4 text-sm sm:text-base focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
        </div>
        <div>
          <p className="text-sm text-white/40 mb-2 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {p.endDate || 'End Date'}</p>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate || new Date().toISOString().split('T')[0]}
            placeholder="YYYY-MM-DD"
            className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl px-5 py-3 sm:py-4 text-sm sm:text-base focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
        </div>
      </div>
      {startDate && endDate && (
        <p className="text-sm text-[#7C5CFC] font-semibold">{durationDays}{p.dayCountSuffix || ' days'} {p.tripSuffix || 'trip'}</p>
      )}

      {/* 인원 직접 입력 */}
      <div>
        <p className="text-sm text-white/40 mb-2 flex items-center gap-1.5"><Users className="w-4 h-4" /> {p.planner_step2_adults || 'Group Size'}</p>
        <input type="number" value={paxInput} onChange={e => setPaxInput(e.target.value)} min={1} max={50}
          placeholder={p.planner_step2_adults || 'Enter number of people'}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/30 rounded-2xl px-5 py-4 text-base focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
      </div>

      {/* ── v2: 도착 공항 터미널 칩 ── */}
      <div>
        <p className="text-sm text-white/40 mb-2 flex items-center gap-1.5"><Plane className="w-4 h-4" /> {p.arrival_airport_title || 'Arrival Airport'}</p>
        <div className="grid grid-cols-2 gap-2">
          {([['ICN_T1','ICN Terminal 1'],['ICN_T2','ICN Terminal 2'],['GMP','Gimpo Airport'],['already_in_korea','Already in Seoul']] as const).map(([val,label]) => (
            <button key={val} onClick={() => setArrivalTerminal(arrivalTerminal === val ? '' : val as any)}
              className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${arrivalTerminal === val ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'}`}>
              {(p as any)[val.toLowerCase()] || label}
            </button>
          ))}
        </div>
      </div>

      {/* ── v2: 호텔/숙소 주소 (optional) ── */}
      <div>
        <p className="text-sm text-white/40 mb-2 flex items-center gap-1.5"><Hotel className="w-4 h-4" /> {p.hotel_address_title || 'Hotel / Accommodation'}</p>
        <input type="text" value={hotelAddress} onChange={e => setHotelAddress(e.target.value)}
          placeholder={p.hotel_placeholder || 'e.g. Lotte Hotel Myeongdong, Shilla Stay Gangnam...'}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/30 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors" />
      </div>

      {/* ── v2: 이동 편의성 토글 ── */}
      <div>
        <p className="text-sm text-white/40 mb-2 flex items-center gap-1.5"><Accessibility className="w-4 h-4" /> {p.mobility_title || 'Mobility'}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMobility('ok')}
            className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${mobility === 'ok' ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'}`}>
            {p.stairs_ok || 'Stairs & hills OK'}
          </button>
          <button onClick={() => setMobility('limited')}
            className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${mobility === 'limited' ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'}`}>
            {p.stairs_limited || 'Minimize stairs'}
          </button>
        </div>
      </div>

      {/* 슬림 광고 카드 */}
      {slimCards.length > 0 && (
        <div className="space-y-2 pt-2">
          {slimCards.map((c, i) => (
            <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.08] hover:border-white/20 transition-all group"
              style={{ background: 'rgba(255,255,255,.03)' }}>
              <span className="text-white/50 shrink-0">{c.icon}</span>
              <span className="text-xs text-white/55 flex-1 group-hover:text-white/80 transition-colors">{c.text}</span>
              <span className="text-[11px] font-bold text-[#7C5CFC] shrink-0 group-hover:text-white transition-colors">{c.cta} →</span>
            </a>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => setStep(1)}
          className="px-5 py-3.5 rounded-2xl border border-white/[0.12] text-white/50 hover:text-white text-sm font-semibold flex items-center gap-1 transition-all">
          <ChevronLeft className="w-4 h-4" /> {p.planner_prev || 'Back'}
        </button>
        <button onClick={() => setStep(3)}
          className="flex-1 py-3.5 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 hover:scale-[1.01] transition-all"
          style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
          {p.planner_next || 'Next'}: {p.planner_generate_cta || 'Generate'} <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     STEP 3: 생성 & 이메일
  ═══════════════════════════════════════════════════════ */
  const renderStepGenerate = () => (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-white">{p.planner_generate_cta || 'Generate Your Plan'}</h2>

      {/* 요약 — 탭하면 해당 스텝으로 이동 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <button onClick={() => setStep(0)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
          <SummaryItem icon={<MapPin className="w-4 h-4" />} label={p.planner_step1_airport || 'Airport'} value={effectiveAirport} />
        </button>
        <button onClick={() => setStep(1)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
          <SummaryItem icon={<ArrowRight className="w-4 h-4" />} label={p.planner_step1_cities?.split(' ')[0] || 'Route'} value={allCities.join(' → ') || '-'} />
        </button>
        <button onClick={() => setStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
          <SummaryItem icon={<Calendar className="w-4 h-4" />} label={p.planner_step2_date?.split(' ')[0] || 'Duration'} value={startDate && endDate ? `${durationDays}${p.dayCountSuffix || ' days'}` : (p.calSelectDate || 'TBD')} />
        </button>
        <button onClick={() => setStep(2)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
          <SummaryItem icon={<Users className="w-4 h-4" />} label={p.planner_step2_adults || 'People'} value={`${pax}${p.kpopPassengers ? '' : ' pax'}`} />
        </button>
      </div>
      <p className="text-[10px] text-white/25 text-center -mt-1">↑ Tap to edit</p>

      <button onClick={handleGenerate} disabled={isLoading}
        className="w-full py-3.5 sm:py-4 rounded-2xl text-sm sm:text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 4px 28px rgba(124,92,252,.4)' }}>
        <Wand2 className="w-5 h-5" />
        {isLoading ? (p.generating || 'AI generating...') : (p.planner_generate_cta || 'Generate Preview')}
      </button>
      {!isLoading && <p className="text-[10px] text-white/25 text-center -mt-2">⚡ Takes about 15 seconds</p>}



      <button onClick={() => setStep(2)}
        className="w-full py-3 rounded-2xl border border-white/[0.1] text-white/40 hover:text-white text-sm font-semibold flex items-center justify-center gap-1 transition-all">
        <ChevronLeft className="w-4 h-4" /> {p.planner_prev || 'Back'}
      </button>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════ */
  return (
    <>
      <div className="w-full">
        {/* 스텝 인디케이터 */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {STEP_TITLES.map((title, i) => (
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
                <span className="hidden sm:inline">{title}</span>
              </button>
              {i < STEP_TITLES.length - 1 && (
                <div className={`w-8 sm:w-12 h-0.5 rounded-full mx-1 ${i < step ? 'bg-[#7C5CFC]/50' : 'bg-white/[0.06]'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          {step === 0 && renderStepAirport()}
          {step === 1 && renderStepCities()}
          {step === 2 && renderStepDetails()}
          {step === 3 && renderStepGenerate()}
        </div>
      </div>


    </>
  );
}

function SummaryItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
      <span className="flex items-center gap-1 text-[10px] text-white/35 mb-1">{icon} {label}</span>
      <p className="text-sm font-bold text-white truncate">{value}</p>
    </div>
  );
}
