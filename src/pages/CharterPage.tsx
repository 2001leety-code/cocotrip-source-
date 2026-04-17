import { useState, useMemo } from 'react';
import { MessageCircle, Mail, ArrowLeft, Car, Bus, AlertTriangle, Check, Clock, Sparkles, Plane, Luggage, ChevronDown, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
  VEHICLE_TYPES,
  EXTRA_CHARGES,
} from '@/data/charterPricing';
import { CalendarPicker } from '@/components/PlannerForm';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { KpopShuttleBanner } from '@/components/KpopShuttleBanner';
import { usePageMeta } from '@/hooks/usePageMeta';

// ── 타입 ──────────────────────────────────────────────
type VehicleType = 'staria' | 'sprinter' | 'bus';
type ServiceType = 'airport' | 'daily' | 'multiday' | 'kpop' | 'other';

// ── 상수 ──────────────────────────────────────────────
const AIRPORTS = [
  { id: 'ICN', ko: '인천국제공항', en: 'Incheon International (ICN)' },
  { id: 'GMP', ko: '김포국제공항', en: 'Gimpo International (GMP)' },
  { id: 'PUS', ko: '김해국제공항 (부산)', en: 'Gimhae International, Busan (PUS)' },
  { id: 'CJU', ko: '제주국제공항', en: 'Jeju International (CJU)' },
  { id: 'TAE', ko: '대구국제공항', en: 'Daegu International (TAE)' },
  { id: 'CJJ', ko: '청주국제공항', en: 'Cheongju International (CJJ)' },
  { id: 'MWX', ko: '무안국제공항', en: 'Muan International (MWX)' },
  { id: 'KWJ', ko: '광주공항', en: 'Gwangju Airport (KWJ)' },
  { id: 'RSU', ko: '여수공항', en: 'Yeosu Airport (RSU)' },
  { id: 'USN', ko: '울산공항', en: 'Ulsan Airport (USN)' },
];

const ICN_DESTS = Object.entries(AIRPORT_TRANSFER_PRICES);

const LUGGAGE_SIZES = [
  { id: 'small', ko: '소형 (기내반입)', en: 'Small (Carry-on)', ja: '小型（機内持込）', zh: '小型（登机箱）' },
  { id: 'medium', ko: '중형 (24인치)', en: 'Medium (24")', ja: '中型（24インチ）', zh: '中型（24寸）' },
  { id: 'large', ko: '대형 (28인치+)', en: 'Large (28"+)', ja: '大型（28インチ+）', zh: '大型（28寸+）' },
];

// ── 스타일 상수 ─────────────────────────────────────
const SEL  = 'border-[#B668FC] bg-gradient-to-br from-[#B668FC]/10 to-[#FF6B9D]/10 text-[#B668FC] shadow-[0_0_15px_rgba(182,104,252,0.15)]';
const UNSEL = 'border-white/10 bg-white/[0.04] text-white/55 hover:border-[#B668FC]/50 hover:text-white/90 hover:shadow-[0_0_10px_rgba(182,104,252,0.1)] transition-all';
const LABEL = 'text-[11px] uppercase tracking-[.07em] text-white/35 font-semibold mb-3';

// ── 메인 컴포넌트 ────────────────────────────────────
export default function CharterPage() {
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const p = t.planner;
  const c = (t as any).charterPage ?? {} as any;
  const lk = ({ ko: 'ko', en: 'en', ja: 'en', zh: 'en' } as const)[language] ?? 'en'; // pricing data: ko/en only; ja/zh → en fallback
  const llk = (['ko','en','ja','zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh'; // language key for luggage labels

  usePageMeta({
    title: 'Charter Vehicle — Airport Pickup & Day Tours',
    description: 'Book private charter vehicles in Korea. Airport transfers, day tours, K-pop concert shuttles. Hyundai Staria, Sprinter, Bus available.',
    ogImage: '/hero-seoul-real.webp',
  });

  const [vehicle,     setVehicle]     = useState<VehicleType>('staria');
  const [service,     setService]     = useState<ServiceType>('airport');
  const [airport,     setAirport]     = useState('ICN');
  const [destination, setDestination] = useState('');
  const [customDest,  setCustomDest]  = useState('');
  const [tourType,    setTourType]    = useState('');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [adults,      setAdults]      = useState(2);
  const [children,    setChildren]    = useState(0);
  const [luggageSmall,  setLuggageSmall]  = useState(0);
  const [luggageMedium, setLuggageMedium] = useState(0);
  const [luggageLarge,  setLuggageLarge]  = useState(0);
  const [flightNo,      setFlightNo]      = useState('');
  const [arrivalTime,   setArrivalTime]   = useState('');
  const [notes,         setNotes]         = useState('');

  // ── 가격 계산 ───────────────────────────────────────
  const quote = useMemo(() => {
    if (service === 'airport' && destination) {
      const dest = AIRPORT_TRANSFER_PRICES[destination];
      if (!dest) return null;
      const base = dest.priceKRW;
      if (vehicle === 'staria') {
        return { priceKRW: base, priceUSD: dest.priceUSD, label: dest[lk], guideFee: 0, guideRequired: false };
      }
      if (vehicle === 'sprinter') {
        const guide = VEHICLE_TYPES.sprinter.guideFeeDailyKRW ?? 300000;
        return { priceKRW: null, guideFee: guide, guideRequired: true, label: dest[lk] };
      }
      return null;
    }
    if (service === 'daily' && tourType) {
      const tour = DAILY_TOUR_PRICES[tourType];
      if (!tour) return null;
      const base = tour.priceKRW;
      if (vehicle === 'staria') {
        return { priceKRW: base, priceUSD: tour.priceUSD, label: tour[lk], guideFee: 0, guideRequired: false };
      }
      if (vehicle === 'sprinter') {
        const guide = VEHICLE_TYPES.sprinter.guideFeeDailyKRW ?? 300000;
        return { priceKRW: null, guideFee: guide, guideRequired: true, label: tour[lk] };
      }
      return null;
    }
    return null;
  }, [vehicle, service, destination, tourType, adults, c, lk]);

  const canPayPal = vehicle === 'staria' && quote?.priceKRW != null && !!startDate;
  const needsCustom = vehicle === 'sprinter' || vehicle === 'bus' || service === 'multiday' || service === 'other';

  const luggageParts: string[] = [];
  if (luggageSmall > 0) luggageParts.push(`Carry-on x${luggageSmall}`);
  if (luggageMedium > 0) luggageParts.push(`24" x${luggageMedium}`);
  if (luggageLarge > 0) luggageParts.push(`28"+ x${luggageLarge}`);
  const luggageSummary = luggageParts.length > 0 ? luggageParts.join(', ') : 'None';

  const waText = encodeURIComponent(
    `[CocoTrip Charter]\nVehicle: ${VEHICLE_TYPES[vehicle].name.ko}\nService: ${service}\nDate: ${startDate}${endDate && endDate !== startDate ? ` ~ ${endDate}` : ''}\nPax: ${adults} adults${children > 0 ? ` ${children} children` : ''}\nAirport: ${airport}\n${destination ? `Dest: ${destination === '__custom__' ? customDest : destination}\n` : ''}${flightNo ? `Flight: ${flightNo}\n` : ''}${arrivalTime ? `Arrival Time: ${arrivalTime}\n` : ''}Luggage: ${luggageSummary}\n${notes ? `Note: ${notes}` : ''}`
  );
  const waUrl    = `https://wa.me/821087140611?text=${waText}`;
  const emailUrl = `mailto:info@cocotripkorea.com?subject=Charter Quote&body=${waText}`;

  function handleDateChange(s: string, e: string) {
    setStartDate(s); setEndDate(e);
  }

  const nights = startDate && endDate
    ? Math.max(0, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))
    : 0;

  const SERVICE_ITEMS = [
    { id: 'airport',  label: c.serviceAirport ?? '공항 픽업/샌딩' },
    { id: 'daily',    label: c.serviceDaily ?? '일일 투어' },
    { id: 'multiday', label: c.serviceMultiday ?? '다일 투어' },
    { id: 'kpop',     label: c.serviceKpop ?? 'K-pop 셔틀' },
    { id: 'other',    label: c.serviceOther ?? '기타 문의' },
  ];

  return (
    <div className={isMobile ? 'm-page' : 'min-h-screen'} style={isMobile ? undefined : { background: '#080b14' }}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      {/* Hero */}
      <section className="text-white pt-24 pb-10 px-4"
        style={{ background: isMobile
          ? 'linear-gradient(160deg, #0a0412 0%, #1a0a2e 60%, #0d0618 100%)'
          : 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-1.5 text-white/35 text-xs hover:text-white/60 transition-colors mb-6">
            <ArrowLeft className="w-3.5 h-3.5" />{c.backToHome ?? '홈으로'}
          </Link>
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold tracking-wider uppercase mb-4 ${
            isMobile
              ? 'border-[#B668FC]/35 bg-[#B668FC]/08 text-[#B668FC]'
              : 'border-[rgba(196,149,106,.35)] bg-[rgba(196,149,106,.08)] text-[#D4A574]'
          }`}>
            {isMobile ? <Sparkles className="w-3.5 h-3.5" /> : <Car className="w-3.5 h-3.5" />}{c.badge ?? '전세차량 견적'}
          </div>
          <h1 className={`text-2xl sm:text-3xl font-bold leading-tight mb-2 ${isMobile ? 'm-shimmer-text' : 'text-white'}`}>
            {c.heroTitle ?? '코코트립 전세차량 견적'}
          </h1>
          <p className="text-white/50 text-sm">{c.heroSubtitle ?? '공항 픽업 · 일일 투어 · K-pop 셔틀 · 단체 투어'}</p>
        </div>
      </section>

      <main className={`max-w-2xl mx-auto px-4 space-y-6 pt-6 ${isMobile ? 'pb-6' : 'pb-20'}`}>

        {/* ── 1. 차량 선택 ── */}
        <div className={`${isMobile ? 'm-card m-appear p-5' : 'bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6'}`}>
          <div className={`${LABEL} flex items-center gap-1.5`}><Car className="w-3 h-3" />{c.vehicleSelect ?? '차량 선택'}</div>
          <div className="grid grid-cols-3 gap-3">
            {(Object.entries(VEHICLE_TYPES) as [VehicleType, typeof VEHICLE_TYPES[VehicleType]][]).map(([key, veh]) => (
              <button key={key} type="button" onClick={() => setVehicle(key)}
                className={`flex flex-col items-center py-4 px-2 rounded-xl border text-center transition-all duration-200 ${vehicle === key ? SEL : UNSEL}`}>
                <span className="mb-1.5">{key === 'staria' ? <Car className="w-5 h-5" /> : <Bus className="w-5 h-5" />}</span>
                <p className="text-xs font-bold leading-tight">{(t.planner as any)?.[`vehicle${key.charAt(0).toUpperCase() + key.slice(1)}`] ?? veh.name.en}</p>
                <p className="text-[10px] opacity-55 mt-0.5">
                  {veh.maxPassengers >= 100
                    ? (c.vehicleMaxGroup ?? '단체')
                    : `${veh.maxPassengers}${c.vehicleMaxUnit ?? '인'}`}
                </p>
                {key === 'staria' && (
                  <p className="text-[10px] text-[#C4956A] mt-1">{c.vehicleFromPrice ?? '₩291,200~'}</p>
                )}
                {(key === 'sprinter' || key === 'bus') && (
                  <p className="text-[10px] text-white/35 mt-1">{c.vehicleCustomQuote ?? '별도 견적'}</p>
                )}
              </button>
            ))}
          </div>

          {/* 10인승 이상 경고 */}
          {(vehicle === 'sprinter' || vehicle === 'bus') && (
            <div className="mt-4 flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/80 leading-relaxed">
                <strong>{c.vehicleGuideWarning ?? '한국 법률상 10인승 이상 차량은 면허 가이드 동행이 필수입니다.'}</strong>{' '}
                {c.vehicleGuideCost ?? '가이드 비용 ₩300,000/일이 추가됩니다.'}
              </p>
            </div>
          )}
        </div>

        {/* ── 2. 서비스 유형 ── */}
        <div className={`${isMobile ? 'm-card m-appear p-5' : 'bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6'}`} style={isMobile ? { animationDelay: '0.1s' } : undefined}>
          <p className={LABEL}>{c.serviceType ?? '서비스 유형'}</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_ITEMS.map(s => (
              <button key={s.id} type="button" onClick={() => setService(s.id as ServiceType)}
                className={`px-4 py-2 rounded-full border text-sm font-medium transition-all duration-200 ${service === s.id ? SEL : UNSEL}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── K-pop 셔틀 배너 (단독 표시) ── */}
        {service === 'kpop' && <KpopShuttleBanner p={p} />}

        {/* ── 3. 상세 정보 (K-pop 아닐 때만 표시) ── */}
        {service !== 'kpop' && (
          <>
            <div className={`${isMobile ? 'm-card m-appear p-5 space-y-5' : 'bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 space-y-5'}`} style={isMobile ? { animationDelay: '0.2s' } : undefined}>
              <p className={LABEL}>{c.details ?? '상세 정보'}</p>

          {/* 공항 픽업 — 드롭다운 기반 */}
          {service === 'airport' && (
            <>
              {/* ① 공항 드롭다운 */}
              <div>
                <p className="text-xs text-white/40 mb-2 flex items-center gap-1"><Plane className="w-3 h-3" />{c.airportSelect ?? '출발/도착 공항'}</p>
                <div className="relative">
                  <select value={airport}
                    onChange={e => { setAirport(e.target.value); setDestination(''); }}
                    className="w-full appearance-none px-4 py-3.5 pr-10 rounded-xl border border-white/15 bg-white/[0.04] text-white text-sm font-medium outline-none focus:border-[#B668FC]/60 transition-all cursor-pointer">
                    {AIRPORTS.map(a => (
                      <option key={a.id} value={a.id} className="bg-[#1a1a2e] text-white">
                        {a.id} — {a[lk as 'ko' | 'en']}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                </div>
              </div>

              {/* ② 목적지 드롭다운 + 직접입력 */}
              <div>
                <p className="text-xs text-white/40 mb-2">{c.destSelect ?? '목적지 선택'}</p>
                <div className="relative">
                  <select value={destination}
                    onChange={e => { setDestination(e.target.value); if (e.target.value !== '__custom__') setCustomDest(''); }}
                    className="w-full appearance-none px-4 py-3.5 pr-10 rounded-xl border border-white/15 bg-white/[0.04] text-white text-sm font-medium outline-none focus:border-[#B668FC]/60 transition-all cursor-pointer">
                    <option value="" className="bg-[#1a1a2e] text-white/50">— {c.destPlaceholder ?? '목적지를 선택하세요'} —</option>
                    {ICN_DESTS.map(([key, dest]) => (
                      <option key={key} value={key} className="bg-[#1a1a2e] text-white">
                        {dest[lk]} — ₩{dest.priceKRW.toLocaleString('ko-KR')}
                      </option>
                    ))}
                    <option value="__custom__" className="bg-[#1a1a2e] text-white">✏️ {c.destCustom ?? '직접 입력'}</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                </div>
                {destination === '__custom__' && (
                  <input type="text" value={customDest} onChange={e => setCustomDest(e.target.value)}
                    placeholder={c.destCustomPlaceholder ?? '예: 서울 강남구 테헤란로 123'}
                    className="w-full mt-2 px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-[#B668FC]/40 transition-all" />
                )}
                {destination && destination !== '__custom__' && (() => {
                  const d = AIRPORT_TRANSFER_PRICES[destination];
                  return d ? (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <Clock className="w-3 h-3 text-white/30" />
                      <span className="text-white/40">{c.estimatedTime ?? '예상 소요'} ~{d.durationMin}{c.minutes ?? '분'}</span>
                    </div>
                  ) : null;
                })()}
              </div>
            </>
          )}

          {/* 일일 투어 */}
          {service === 'daily' && (
            <div>
              <p className="text-xs text-white/40 mb-2">{c.tourSelect ?? '투어 코스 선택'}</p>
              <div className="space-y-1.5">
                {Object.entries(DAILY_TOUR_PRICES).map(([key, tour]) => (
                  <button key={key} type="button" onClick={() => setTourType(key)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all duration-200 ${tourType === key ? SEL : UNSEL}`}>
                    <div className="text-left">
                      <p className="font-medium">{tour[lk]}</p>
                      <p className="text-[10px] opacity-55 mt-0.5">{tour.hours}h · {tour.spots.slice(0, 3).join(' · ')}</p>
                    </div>
                    <span className={`text-xs font-bold shrink-0 ml-3 ${tourType === key ? 'text-[#C4956A]' : 'text-white/30'}`}>
                      ₩{tour.priceKRW.toLocaleString('ko-KR')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* K-pop 셔틀 섹션은 위 KpopShuttleBanner로 대체됨 */}

          {/* 다일 / 기타 안내 */}
          {(service === 'multiday' || service === 'other') && (
            <div className="bg-white/[0.03] rounded-xl px-4 py-3 text-xs text-white/45 leading-relaxed">
              {c.multidayNote ?? '다일 투어 및 기타 문의는 일정 · 도시 · 인원을 아래 추가 요청사항에 적어주시면 WhatsApp 또는 이메일로 정확한 견적을 보내드립니다.'}
            </div>
          )}

          {/* 날짜 선택 */}
          <div>
            <p className="text-xs text-white/40 mb-2">
              {service === 'multiday' ? (c.dateRange ?? '여행 날짜 범위') : (c.dateSelect ?? '날짜 선택')}
            </p>
            <CalendarPicker
              startDate={startDate}
              endDate={service === 'airport' || service === 'daily' ? startDate : endDate}
              onDateChange={handleDateChange}
              p={p}
              lang={language}
            />
            {nights > 0 && (
              <p className="text-xs text-[#C4956A] mt-2">
                {(c.nightsFormat ?? '{n}박 {m}일').replace('{n}', String(nights)).replace('{m}', String(nights + 1))}
              </p>
            )}
          </div>

          {/* 인원 */}
          <div>
            <p className="text-xs text-white/40 mb-2">{c.people ?? '인원'}</p>
            <div className="space-y-2">
              {[
                { key: 'adults'   as const, label: c.adults ?? '성인', min: 1, max: 20, val: adults,   set: setAdults },
                { key: 'children' as const, label: c.children ?? '어린이', min: 0, max: 10, val: children, set: setChildren },
              ].map(row => (
                <div key={row.key} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
                  <span className="text-sm text-white/65">{row.label}</span>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => row.set(Math.max(row.min, row.val - 1))}
                      className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-white/55 hover:border-[rgba(196,149,106,.4)] hover:text-[#C4956A] transition-all text-lg leading-none">−</button>
                    <span className="text-base font-bold text-white w-6 text-center">{row.val}</span>
                    <button type="button" onClick={() => row.set(Math.min(row.max, row.val + 1))}
                      className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-white/55 hover:border-[rgba(196,149,106,.4)] hover:text-[#C4956A] transition-all text-lg leading-none">+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 캐리어 — 사이즈별 개수 */}
          <div>
            <p className="text-xs text-white/40 mb-2 flex items-center gap-1"><Luggage className="w-3 h-3" />{c.luggage ?? '캐리어 정보'}</p>
            <p className="text-[10px] text-white/25 mb-3">{c.luggageSizeHint ?? '각 사이즈별 수량을 입력하세요'}</p>
            <div className="space-y-2">
              {[
                { key: 'small'  as const, label: LUGGAGE_SIZES[0][llk], val: luggageSmall,  set: setLuggageSmall },
                { key: 'medium' as const, label: LUGGAGE_SIZES[1][llk], val: luggageMedium, set: setLuggageMedium },
                { key: 'large'  as const, label: LUGGAGE_SIZES[2][llk], val: luggageLarge,  set: setLuggageLarge },
              ].map(row => (
                <div key={row.key} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
                  <span className="text-sm text-white/65">{row.label}</span>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => row.set(Math.max(0, row.val - 1))}
                      className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-white/55 hover:border-[#B668FC]/40 hover:text-[#B668FC] transition-all text-lg leading-none">−</button>
                    <span className="text-base font-bold text-white w-6 text-center">{row.val}</span>
                    <button type="button" onClick={() => row.set(Math.min(20, row.val + 1))}
                      className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-white/55 hover:border-[#B668FC]/40 hover:text-[#B668FC] transition-all text-lg leading-none">+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 비행기 편명 + 도착시간 */}
          <div>
            <p className="text-xs text-white/40 mb-2 flex items-center gap-1"><Plane className="w-3 h-3" />{c.flightNo ?? '비행기 편명 (선택)'}</p>
            <input type="text" value={flightNo} onChange={e => setFlightNo(e.target.value.toUpperCase())}
              placeholder={c.flightPlaceholder ?? '예: KE001, OZ521, 7C101'}
              className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-[#B668FC]/40 transition-all font-mono tracking-wider" />
          </div>

          {/* 도착 시간 */}
          <div>
            <p className="text-xs text-white/40 mb-2 flex items-center gap-1"><Timer className="w-3 h-3" />{c.arrivalTime ?? '도착 시간 (선택)'}</p>
            <input type="time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/80 text-sm outline-none focus:border-[#B668FC]/40 transition-all [color-scheme:dark]" />
            <p className="text-[10px] text-white/20 mt-1">{c.arrivalTimeHint ?? '비행기 도착 예정 시간을 입력하세요'}</p>
          </div>

          {/* 요청사항 */}
          <div>
            <p className="text-xs text-white/40 mb-2">{c.notes ?? '추가 요청사항 (선택)'}</p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder={c.notesPlaceholder ?? '예: 유아카시트 필요, 한국어 기사 선호, 특정 시간 픽업...'}
              className="w-full px-4 py-3 rounded-xl border border-white/12 bg-white/[0.03] text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-[#B668FC]/40 transition-all resize-none leading-relaxed" />
          </div>
            </div>

            {/* ── 4. 예상 견적 패널 ── */}
            {quote && (
              <div className={`rounded-2xl border overflow-hidden ${isMobile ? 'border-[#B668FC]/30 m-appear' : 'border-[rgba(196,149,106,.3)]'}`}
                style={{ background: isMobile
                  ? 'linear-gradient(135deg, rgba(182,104,252,0.08) 0%, rgba(10,4,18,0.95) 100%)'
                  : 'linear-gradient(135deg, rgba(196,149,106,0.08) 0%, rgba(10,16,32,0.95) 100%)' }}>
                <div className="px-6 py-5">
                  <p className={`text-[10px] uppercase tracking-widest font-semibold mb-3 ${isMobile ? 'text-[#B668FC]/70' : 'text-[#C4956A]/70'}`}>{c.quoteTitle ?? '예상 견적'}</p>
                  <p className="font-bold text-white text-base mb-0.5">{quote.label}</p>
                  <p className="text-xs text-white/40 mb-4">
                    {VEHICLE_TYPES[vehicle].name.ko} · {startDate || (c.dateNotSelected ?? '날짜 미선택')} · {c.adults ?? '성인'} {adults}{c.vehicleMaxUnit ?? '명'}{children > 0 ? ` ${c.children ?? '어린이'} ${children}${c.vehicleMaxUnit ?? '명'}` : ''}
                  </p>

                  {quote.priceKRW != null ? (
                    <>
                      <div className="flex items-baseline gap-3 mb-1">
                        <span className="text-3xl font-bold text-white">₩{quote.priceKRW.toLocaleString('ko-KR')}</span>
                        <span className="text-sm text-white/40">≈ ${quote.priceUSD} USD</span>
                      </div>
                      {EXTRA_CHARGES.roundTripDiscountPercent > 0 && service === 'airport' && (
                        <p className="text-[11px] text-[#C4956A]/70 mb-4">
                          {(c.roundTripDiscount ?? '왕복 예약 시 {n}% 할인 적용 (WhatsApp 문의)').replace('{n}', String(EXTRA_CHARGES.roundTripDiscountPercent))}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="mb-4">
                      <p className="text-lg font-bold text-amber-300">{c.customQuote ?? '별도 견적'}</p>
                      {quote.guideRequired && (
                        <p className="text-xs text-amber-200/70 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />{c.vehicleGuideCost ?? '가이드 비용 ₩300,000/일 별도 포함'}
                        </p>
                      )}
                    </div>
                  )}

                  {/* CTA */}
                  {canPayPal ? (
                    <PayPalBookingButton
                      productType={(() => {
                        if (service === 'airport' && destination)
                          return `airport_${destination.replace(/-/g, '_')}`;
                        if (service === 'daily' && tourType) {
                          const map: Record<string, string> = {
                            'seoul-city':      'charter_seoul_city',
                            'seoul-suburb':    'charter_seoul_suburb',
                            'dmz':             'charter_dmz',
                            'gangwon':         'charter_gangwon',
                            'ski-resort':      'charter_ski',
                            'gyeongju-jeonju': 'charter_gyeongju',
                            'busan-day':       'charter_busan',
                          };
                          return map[tourType] ?? 'charter_seoul_suburb';
                        }
                        return 'charter_seoul_suburb';
                      })()}
                      passengers={adults + children}
                      dateStart={startDate}
                      dateEnd={endDate || startDate}
                      priceKRW={quote.priceKRW!}
                      p={p}
                      lang={language}
                      pickupLocation={service === 'airport' ? airport : ''}
                      dropoffLocation={service === 'airport' ? destination : tourType}
                      vehicleType={vehicle}
                      memo={notes}
                    />
                  ) : (
                    <ContactCTAs waUrl={waUrl} emailUrl={emailUrl} c={c} />
                  )}
                </div>
              </div>
            )}

            {/* 견적 없을 때 기본 문의 CTA */}
            {!quote && (
              <div className={`${isMobile ? 'm-card p-5 text-center' : 'bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 text-center'}`}>
                <p className="text-white/40 text-sm mb-4">
                  {needsCustom
                    ? (c.noQuoteCustom ?? '스프린터·버스·다일투어는 맞춤 견적이 필요합니다.')
                    : (c.noQuoteDefault ?? '위에서 서비스 유형과 목적지를 선택하면 예상 금액이 표시됩니다.')}
                </p>
                <ContactCTAs waUrl={waUrl} emailUrl={emailUrl} c={c} />
              </div>
            )}

            {/* 추가 정보 */}
            <div className={`${isMobile ? 'm-card m-appear p-5' : 'bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5'}`} style={isMobile ? { animationDelay: '0.3s' } : undefined}>
              <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-3">{c.includedTitle ?? '포함 사항'}</p>
              <ul className="space-y-1.5 text-xs text-white/45 leading-relaxed">
                <li className="flex items-start gap-1.5"><Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500/70" /><span>{c.included1 ?? '차량 1대 기준 (인원 추가 시 차량 추가)'}</span></li>
                <li className="flex items-start gap-1.5"><Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500/70" /><span>{c.included2 ?? '영어 소통 가능 기사 · 24시간 지원'}</span></li>
                <li className="flex items-start gap-1.5"><Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500/70" /><span>{c.included3 ?? '대형 캐리어 수납 가능'}</span></li>
                <li className="flex items-start gap-1.5"><Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500/70" /><span>{c.included4 ?? '픽업 안내 서비스 (공항 픽업 ₩20,000 추가)'}</span></li>
                <li className="flex items-start gap-1.5"><Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/35" /><span>{(c.overtime ?? '초과 시간 ₩{n}/시간').replace('{n}', EXTRA_CHARGES.overtimePerHour.toLocaleString('ko-KR'))}</span></li>
                <li className="flex items-start gap-1.5"><Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/35" /><span>{(c.nightSurcharge ?? '심야 할증 (00:00–06:00) {n}% 추가').replace('{n}', String(EXTRA_CHARGES.nightSurchargePercent))}</span></li>
              </ul>
            </div>
          </>
        )}
      </main>

      {!isMobile && <Footer t={t} />}
    </div>
  );
}

// ── 연락 CTA 버튼 ─────────────────────────────────────
function ContactCTAs({ waUrl, emailUrl, c }: { waUrl: string; emailUrl: string; c: any }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <a href={waUrl} target="_blank" rel="noopener noreferrer"
        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
        style={{ background: '#25D366' }}>
        <MessageCircle className="w-4 h-4" />
        {c.waQuote ?? 'WhatsApp 견적 문의'}
      </a>
      <a href={emailUrl}
        className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl border border-white/20 text-sm font-medium text-white/65 hover:border-white/35 hover:text-white/85 transition-all">
        <Mail className="w-4 h-4" />
        {c.emailQuote ?? '이메일 문의'}
      </a>
    </div>
  );
}
