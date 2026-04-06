import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  MapPin, Users, Calendar, Wand2,
  ChevronDown, ChevronRight, ChevronLeft, Check,
  Music2, Sparkles, Shirt, UtensilsCrossed, Moon, Camera, ShoppingBag,
  Film, Landmark, Mountain, Building2, Car, Hotel, Accessibility, Plane,
  Download, MessageCircle, Wallet, Shield,
} from 'lucide-react';
import type { PlannerFormValues } from './PlannerForm';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';

/* ═══════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════ */
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

const WHAT_YOU_GET = [
  'Minute-by-minute daily itinerary',
  'Airport arrival guide (SIM, T-money, transport)',
  'Restaurant recommendations with menu & prices',
  'Subway directions with transfer instructions',
  'Naver Map links for every location',
  'Daily budget breakdown',
  'Departure guide with tax refund info',
  'PDF download',
];

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT — 3-Step Wizard
   ═══════════════════════════════════════════════════════ */
export function WizardForm({ onSubmit, isLoading }: any) {
  const { t } = useLanguage();
  const p: any = t.planner;
  const [step, setStep] = useState(0);
  const { user } = useAuth();

  // Step 0: destinations
  const [mainCity, setMainCity]               = useState('');
  const [areaType, setAreaType]               = useState<'seoul_city' | 'seoul_day' | 'provincial' | ''>('');
  const [extraCities, setExtraCities]         = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [freeText, setFreeText]               = useState('');

  // Step 1: details
  const [startDate, setStartDate]             = useState('');
  const [endDate, setEndDate]                 = useState('');
  const [paxInput, setPaxInput]               = useState('2');
  const [arrivalTerminal, setArrivalTerminal] = useState<'ICN_T1'|'ICN_T2'|'GMP'|'already_in_korea'|''>('');
  const [hotelAddress, setHotelAddress]       = useState('');
  const [mobility, setMobility]              = useState<'ok'|'limited'>('ok');

  // derived
  const allCities = mainCity ? [mainCity, ...extraCities.filter(c => c !== mainCity)] : [];
  const durationDays = (startDate && endDate) ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)) : 3;
  const pax = parseInt(paxInput) || 2;
  const departureAirport = arrivalTerminal;

  // validation
  const canGoStep1 = areaType !== '' && mainCity !== '' && selectedActivities.length > 0;
  const canGoStep2 = startDate !== '' && endDate !== '' && new Date(endDate) >= new Date(startDate) && pax >= 1 && arrivalTerminal !== '';

  // city name helper
  function getCityName(key: string) {
    const existing = (p as any)[`city_${key}`];
    if (existing) return existing;
    const fallback = (p as any)[`city${key.charAt(0).toUpperCase()}${key.slice(1)}`];
    return fallback || key.charAt(0).toUpperCase() + key.slice(1);
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
      arrival_airport: arrivalTerminal,
      departure_airport: departureAirport,
      hotel_address: hotelAddress,
      mobility,
      uid: user?.uid || null,
    } as PlannerFormValues);
  }

  const STEPS = [
    { label: 'Destinations', icon: <MapPin className="w-3.5 h-3.5" /> },
    { label: 'Details', icon: <Calendar className="w-3.5 h-3.5" /> },
    { label: 'Generate', icon: <Wand2 className="w-3.5 h-3.5" /> },
  ];

  /* ═══════════════════════════════════════════════════════
     STEP 0: Plan Your Trip — Destinations & Activities
     ═══════════════════════════════════════════════════════ */
  const renderStep0 = () => {
    const showValidation = false; // could track attempted next
    return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">{p.wizardTitle || 'Where would you like to visit?'}</h2>
        <p className="text-sm text-white/40">{p.wizardTitleSub || 'Select your destinations and interests'}</p>
      </div>

      {/* Trip Area */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.tripAreaLabel || 'Trip Area'}</p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: 'seoul_city' as const, icon: <Building2 className="w-5 h-5" />, label: p.tripAreaSeoulCity || 'Seoul City', city: 'seoul', dayTrip: false },
            { id: 'seoul_day'  as const, icon: <Car className="w-5 h-5" />,       label: p.tripAreaSeoulDay || 'Seoul Day Trip',  city: 'seoul', dayTrip: true  },
            { id: 'provincial' as const, icon: <Mountain className="w-5 h-5" />,  label: p.tripAreaProvincial || 'Provincial', city: 'busan', dayTrip: false },
          ]).map(area => {
            const isSelected = areaType === area.id;
            return (
              <button key={area.id} onClick={() => {
                setAreaType(area.id);
                setMainCity(getCityName(area.city));
                if (area.dayTrip) {
                  const daytripCity = getCityName('suwon');
                  setExtraCities(prev => prev.includes(daytripCity) ? prev : [daytripCity]);
                } else {
                  setExtraCities([]);
                }
              }}
                className={`flex flex-col items-center gap-1.5 py-3.5 px-2 rounded-xl border text-center transition-all ${
                  isSelected ? 'border-[#7C5CFC] bg-[#7C5CFC]/10 text-white shadow-[0_0_10px_rgba(124,92,252,0.15)]' : 'border-white/[0.1] bg-white/[0.04] text-white/55 hover:border-[#7C5CFC]/50 hover:text-white/80'
                }`}>
                {area.icon}
                <span className="text-xs font-semibold">{area.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main City */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardMainCity || 'Main City'}</p>
        <div className="relative">
          <select value={mainCity} onChange={e => setMainCity(e.target.value)}
            className="w-full appearance-none bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl pl-5 pr-12 py-4 text-base cursor-pointer focus:outline-none focus:border-[#7C5CFC]/70 transition-colors">
            <option value="" disabled className="bg-[#0f111a]">{p.wizardMainCityPh || 'Select main city'}</option>
            {CITY_KEYS.map(key => <option key={key} value={getCityName(key)} className="bg-[#0f111a]">{getCityName(key)}</option>)}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 pointer-events-none" />
        </div>
      </div>

      {/* Additional Cities (show for day trip / provincial) */}
      {(areaType === 'seoul_day' || areaType === 'provincial') && (
        <div>
          <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardExtraCities || 'Additional Cities'} <span className="text-white/25">({p.wizardExtraOptional || 'optional'})</span></p>
          <div className="relative">
            <select value="" onChange={e => {
              const v = e.target.value;
              if (v && !extraCities.includes(v) && v !== mainCity) setExtraCities(prev => [...prev, v]);
            }}
              className="w-full appearance-none bg-white/[0.06] border border-white/[0.12] text-white rounded-2xl pl-5 pr-12 py-4 text-base cursor-pointer focus:outline-none focus:border-[#7C5CFC]/70 transition-colors">
              <option value="" className="bg-[#0f111a]">{p.wizardExtraCitiesPh || 'Add more cities...'}</option>
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
                  {city} <span className="text-white/40 hover:text-white">&times;</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Activities */}
      <div>
        <p className="text-sm text-white/50 mb-1 font-medium">{p.wizardActivities || 'What interests you?'}</p>
        <p className="text-xs text-white/25 mb-3">{p.wizardActivitiesHint || 'Select all that apply'}</p>
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

      {/* Free text */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardFreeInput || 'Specific places?'} <span className="text-white/25">({p.wizardOptional || 'optional'})</span></p>
        <textarea value={freeText} onChange={e => setFreeText(e.target.value)}
          placeholder={p.wizardFreeInputPh || 'e.g. Gyeongbokgung Palace, Myeongdong...'}
          rows={2}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 resize-none transition-colors" />
      </div>

      {/* Next button */}
      <button onClick={() => setStep(1)} disabled={!canGoStep1}
        className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] transition-all"
        style={{ background: canGoStep1 ? 'linear-gradient(135deg,#7C5CFC,#EA537E)' : 'rgba(255,255,255,.1)' }}>
        Next: Details <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )};

  /* ═══════════════════════════════════════════════════════
     STEP 1: Travel Details
     ═══════════════════════════════════════════════════════ */
  const renderStep1 = () => (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">{p.planner_step2_date || 'Travel Details'}</h2>
        <p className="text-sm text-white/40">When, who, and how you're arriving</p>
      </div>

      {/* Dates */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">When are you visiting?</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-white/30 mb-1 block">{p.startDate || 'Start Date'}</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              lang="en" min={new Date().toISOString().split('T')[0]}
              className={`w-full bg-white/[0.06] border ${!startDate && step === 1 ? 'border-white/[0.12]' : 'border-white/[0.12]'} text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]`} />
          </div>
          <div>
            <label className="text-xs text-white/30 mb-1 block">{p.endDate || 'End Date'}</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              lang="en" min={startDate || new Date().toISOString().split('T')[0]}
              className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
          </div>
        </div>
        {startDate && endDate && (
          <p className="text-sm text-[#7C5CFC] font-semibold mt-2">{durationDays}{p.dayCountSuffix || ' days'} {p.tripSuffix || 'trip'}</p>
        )}
      </div>

      {/* Travelers */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.planner_step2_adults || 'How many travelers?'}</p>
        <input type="number" value={paxInput} onChange={e => setPaxInput(e.target.value)} min={1} max={50}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-5 py-3 text-base focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
      </div>

      {/* Arrival Airport Chips */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">Which airport are you arriving at?</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['ICN_T1','ICN Terminal 1'] as const,
            ['ICN_T2','ICN Terminal 2'] as const,
            ['GMP','Gimpo Airport'] as const,
            ['already_in_korea','Already in Korea'] as const
          ]).map(([val,label]) => (
            <button key={val} onClick={() => setArrivalTerminal(arrivalTerminal === val ? '' : val as any)}
              className={`px-3.5 py-3 rounded-xl text-sm font-semibold border transition-all ${
                arrivalTerminal === val 
                  ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white shadow-[0_0_8px_rgba(124,92,252,0.15)]' 
                  : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'
              }`}>
              {(p as any)[val.toLowerCase()] || label}
            </button>
          ))}
        </div>
      </div>

      {/* Hotel */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.hotel_address_title || 'Where are you staying?'} <span className="text-white/25">({p.wizardOptional || 'optional'})</span></p>
        <input type="text" value={hotelAddress} onChange={e => setHotelAddress(e.target.value)}
          placeholder={p.hotel_placeholder || 'e.g. Lotte Hotel Myeongdong...'}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-xl px-5 py-3 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors" />
      </div>

      {/* Mobility */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.mobility_title || 'Mobility'}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setMobility('ok')}
            className={`px-3.5 py-3 rounded-xl text-sm font-semibold border transition-all ${mobility === 'ok' ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'}`}>
            {p.stairs_ok || 'Stairs & hills OK'}
          </button>
          <button onClick={() => setMobility('limited')}
            className={`px-3.5 py-3 rounded-xl text-sm font-semibold border transition-all ${mobility === 'limited' ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white' : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20'}`}>
            {p.stairs_limited || 'Minimize stairs'}
          </button>
        </div>
      </div>

      {/* Nav */}
      <div className="flex gap-3 pt-2">
        <button onClick={() => setStep(0)}
          className="px-5 py-3.5 rounded-2xl border border-white/[0.12] text-white/50 hover:text-white text-sm font-semibold flex items-center gap-1 transition-all">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button onClick={() => setStep(2)} disabled={!canGoStep2}
          className="flex-1 py-3.5 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-35 hover:scale-[1.01] transition-all"
          style={{ background: canGoStep2 ? 'linear-gradient(135deg,#7C5CFC,#EA537E)' : 'rgba(255,255,255,.1)' }}>
          Next: Generate <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════════════════
     STEP 2: Review & Generate
     ═══════════════════════════════════════════════════════ */
  const renderStep2 = () => {
    const airportLabel = arrivalTerminal === 'ICN_T1' ? 'ICN T1' : arrivalTerminal === 'ICN_T2' ? 'ICN T2' : arrivalTerminal === 'GMP' ? 'Gimpo' : 'In Korea';
    return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-white">Review Your Trip</h2>

      {/* Summary cards */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button onClick={() => setStep(0)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<MapPin className="w-4 h-4" />} label="Destination" value={allCities[0] || '-'} />
          </button>
          <button onClick={() => setStep(1)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Calendar className="w-4 h-4" />} label="Dates" value={startDate && endDate ? `${formatDateShort(startDate)} - ${formatDateShort(endDate)}` : 'TBD'} />
          </button>
          <button onClick={() => setStep(1)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Plane className="w-4 h-4" />} label="Airport" value={airportLabel} />
          </button>
          <button onClick={() => setStep(1)} className="text-left hover:ring-1 hover:ring-[#7C5CFC]/40 rounded-xl transition-all">
            <SummaryCard icon={<Users className="w-4 h-4" />} label="Travelers" value={`${pax} pax`} />
          </button>
        </div>

        <div className="text-xs text-white/40 space-y-1 border-t border-white/[0.06] pt-3">
          <p><span className="text-white/25">Activities:</span> <span className="text-white/60">{selectedActivities.map(a => (p as any)[`act${a}`] || a).join(', ') || '-'}</span></p>
          {hotelAddress && <p><span className="text-white/25">Hotel:</span> <span className="text-white/60">{hotelAddress}</span></p>}
          <p><span className="text-white/25">Mobility:</span> <span className="text-white/60">{mobility === 'ok' ? 'Stairs OK' : 'Minimize stairs'}</span></p>
        </div>

        <p className="text-[10px] text-white/20 text-center">Tap any card to edit</p>
      </div>

      {/* What You'll Get */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 sm:p-5">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#7C5CFC]" /> What You'll Get</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {WHAT_YOU_GET.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-white/50">
              <Check className="w-3.5 h-3.5 text-green-400/70 shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Price + Generate */}
      <div className="bg-gradient-to-br from-[#7C5CFC]/10 to-[#EA537E]/10 border border-[#7C5CFC]/20 rounded-2xl p-5 text-center space-y-4">
        <div>
          <p className="text-sm text-white/50 mb-1">AI Travel Plan</p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold text-white">$4.90</span>
            <span className="text-sm text-white/30">/ &#8361;6,600</span>
          </div>
        </div>

        <button onClick={handleGenerate} disabled={isLoading}
          className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', boxShadow: '0 4px 28px rgba(124,92,252,.4)' }}>
          <Shield className="w-5 h-5" />
          {isLoading ? (p.generating || 'Creating your itinerary...') : 'Generate AI Itinerary'}
        </button>

        <p className="text-[10px] text-white/30 flex items-center justify-center gap-1">
          <Wallet className="w-3 h-3" /> Takes about 15 seconds after payment
        </p>
      </div>

      {/* Back */}
      <button onClick={() => setStep(1)}
        className="w-full py-3 rounded-2xl border border-white/[0.1] text-white/40 hover:text-white text-sm font-semibold flex items-center justify-center gap-1 transition-all">
        <ChevronLeft className="w-4 h-4" /> Back to Details
      </button>
    </div>
  )};

  /* ═══════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════ */
  return (
    <>
      <div className="w-full">
        {/* Step Indicator — 3 steps */}
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
          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════ */
function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
      <span className="flex items-center gap-1 text-[10px] text-white/35 mb-1">{icon} {label}</span>
      <p className="text-sm font-bold text-white truncate">{value}</p>
    </div>
  );
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
