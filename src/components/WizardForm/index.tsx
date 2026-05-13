// WizardForm container: holds shared wizard state + routes between steps.
// Previously src/components/WizardForm.tsx (798L) — split into step components
// under src/components/WizardForm/* for P3 Lock release.
import { useState, useEffect, lazy, Suspense } from 'react';
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
import {
  useWizardPersistence,
  loadWizardSnapshot,
  clearWizardSnapshot,
} from '@/hooks/useWizardPersistence';
import { ResumeWizardModal } from '@/components/ResumeWizardModal';

import { CITY_CHIPS, LOCALE_MAP } from './data';
import { getAirportOptions } from './helpers';
// 2026-05-13 PR #393 후속: getZoneByKey 는 handleGenerate 안에서 dynamic import.
// cityNameToZoneKey + CITY_NAME_BY_KEY 는 zoneHelpers (light) 에서 직접 import →
// main planner chunk 에서 heavy zone arrays 분리.
import { cityNameToZoneKey } from './zoneHelpers';
// 2026-05-13 PR #393 후속: 5 step 컴포넌트 모두 lazy. 한 번에 하나만 마운트되므로
// 다음 step 으로 이동 시점에 fetch — 초기 planner chunk 에서 step 코드 분리.
// type-only re-export 는 컴파일 시 사라져 main chunk 영향 없음.
const WizardStep0Reservation = lazy(() =>
  import('./WizardStep0Reservation').then(m => ({ default: m.WizardStep0Reservation })),
);
const WizardStep0Destination = lazy(() =>
  import('./WizardStep0Destination').then(m => ({ default: m.WizardStep0Destination })),
);
const WizardStep1Food = lazy(() =>
  import('./WizardStep1Food').then(m => ({ default: m.WizardStep1Food })),
);
const WizardStep2Details = lazy(() =>
  import('./WizardStep2Details').then(m => ({ default: m.WizardStep2Details })),
);
const WizardStep3Review = lazy(() =>
  import('./WizardStep3Review').then(m => ({ default: m.WizardStep3Review })),
);
import type { ReservationStatus } from './WizardStep0Reservation';
import type { TourPace } from './WizardStep2Details';

import type { WizardDict } from './types';

// 2026-05-09 (B9-35): autosave snapshot 의 values shape. wizard 가 30+ state 를
// 갖고 있어 모두 typed 로 묶기엔 무거움 — 단순 Record 로 유연하게 + key 단위 복원.
// 새 필드 추가 시 PlannerSnapshotValues 에도 같이 추가 (실수 시 그 필드만 복원 안 됨).
interface PlannerSnapshotValues {
  reservationStatus: ReservationStatus | null;
  mainCity: string;
  mainCityKey: string;
  extraCities: string[];
  selectedActivities: string[];
  freeText: string;
  dietPrefs: string[];
  allergies: string[];
  priceRange: string;
  spiceLevel: string;
  bucketDishes: string[];
  // dateRange 는 Date 가 들어있어 JSON 직렬화 시 string 됨. 복원 시 new Date() 로 변환.
  dateRangeFrom: string | null;  // ISO yyyy-MM-dd
  dateRangeTo: string | null;
  paxInput: string;
  arrivalTerminal: string;
  hotelAddress: string;
  arrivalTime: string;
  departureTime: string;
  luggageSmall: number;
  luggageMedium: number;
  luggageLarge: number;
  wantAccom: boolean;
  accomBudget: string;
  // 2026-05-11 (B-2): single-zone string → Record<city, zone>. autosave snapshot 의
  // 기존 사용자는 recommendedZone (legacy) 만 갖고 있을 수 있어 복원 시 fallback 처리.
  recommendedZones: Record<string, string>;
  tourPace: TourPace;
}

// 2026-05-09 (B9-37): RevisionCard → PlannerPage → WizardForm 으로 흘러오는
// prefill 데이터. plan.input 핵심 필드의 부분 직렬. 미직렬 필드는 기본값 유지.
export interface WizardInitialValues {
  startDate?: string;
  endDate?: string;
  regions?: string[];
  categories?: string[];
  pax?: number;
  arrivalAirport?: string;
  hotelAddress?: string;
  dietary?: string[];
  allergies?: string[];
  freeText?: string;
}

export function WizardForm({ onSubmit, isLoading, initialValues }: { onSubmit: (values: PlannerFormValues) => Promise<{ ok: boolean; data?: Record<string, string> } | void>; isLoading: boolean; initialValues?: WizardInitialValues }) {
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

  // Step 2: travel details — default start = tomorrow (Option A: 기본값 내일)
  const [dateRange, setDateRange]             = useState<DateRange | undefined>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { from: tomorrow, to: undefined };
  });
  const [paxInput, setPaxInput]               = useState('2');
  const [arrivalTerminal, setArrivalTerminal] = useState('');
  const [hotelAddress, setHotelAddress]       = useState('');
  // 2026-05-10 B10-2: 다도시 plan 시 도시별 호텔 주소 (cityKey → address). 단도시면
  // 기존 hotelAddress 사용 (backward compat). entry_city = mainCityKey 자동.
  const [hotelByCity, setHotelByCity]         = useState<Record<string, string>>({});
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
  // and the AI hubs stops near it. Empty record = no recommendation chosen.
  // 2026-05-11 (B-2 fix): 단일 string → Record<cityKey, zoneKey>. 다도시 plan 에서
  // 도시별로 각각 1개씩 zone 보유 가능. 단도시 plan 은 { [mainCityKey]: zone } 형태.
  const [recommendedZones, setRecommendedZones] = useState<Record<string, string>>({});
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

  // 2026-05-09 (B9-35): autosave 복원용 ResumeWizardModal 표시 여부 + 저장된 snapshot.
  // initialValues (revision prefill) 가 있으면 autosave 무시 — revision 의도가 우선.
  const [resumeOpen, setResumeOpen] = useState(false);
  const [pendingSnap, setPendingSnap] = useState<PlannerSnapshotValues | null>(null);
  const [pendingStep, setPendingStep] = useState<number>(0);

  // 2026-05-09 (B9-37): revision 으로 진입 시 plan.input 핵심 필드 prefill.
  // 첫 마운트 1회만 — 사용자가 이후 수정한 값을 덮어쓰지 않게 deps=[].
  // mainCityKey 매핑: regions[0] 가 cityKey('seoul') 또는 i18n cityName('서울') 양쪽 다 지원.
  useEffect(() => {
    if (!initialValues) return;
    const iv = initialValues;
    if (iv.regions && iv.regions[0]) {
      const r0 = iv.regions[0];
      const r0Lower = String(r0).toLowerCase().trim();
      const chip = CITY_CHIPS.find(c => c.key === r0Lower) ||
                   CITY_CHIPS.find(c => getCityName(c.key) === r0);
      if (chip) {
        setMainCity(getCityName(chip.key));
        setMainCityKey(chip.key);
      } else {
        // chip 매칭 실패 시 그대로 표시 (사용자가 다시 선택 가능)
        setMainCity(r0);
      }
      if (iv.regions.length > 1) {
        setExtraCities(iv.regions.slice(1).map((r) => {
          const lower = String(r).toLowerCase().trim();
          const c = CITY_CHIPS.find(x => x.key === lower);
          return c ? getCityName(c.key) : r;
        }));
      }
    }
    if (iv.categories && iv.categories.length) {
      setSelectedActivities(iv.categories);
    }
    if (typeof iv.freeText === 'string' && iv.freeText) {
      setFreeText(iv.freeText);
    }
    if (iv.dietary && iv.dietary.length) {
      setDietPrefs(iv.dietary);
    }
    if (iv.allergies && iv.allergies.length) {
      setAllergies(iv.allergies);
    }
    if (iv.startDate) {
      const from = new Date(iv.startDate);
      if (!Number.isNaN(from.getTime())) {
        const to = iv.endDate ? new Date(iv.endDate) : undefined;
        setDateRange({ from, to: to && !Number.isNaN(to.getTime()) ? to : undefined });
      }
    }
    if (iv.pax && iv.pax > 0) setPaxInput(String(iv.pax));
    if (iv.arrivalAirport) setArrivalTerminal(iv.arrivalAirport);
    if (iv.hotelAddress) setHotelAddress(iv.hotelAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-05-09 (B9-35): autosave snapshot 복원 시도. revision prefill 이 있으면 무시.
  // 첫 마운트 1회만 — snapshot 발견 → 사용자에게 모달로 복원 여부 묻기.
  useEffect(() => {
    if (initialValues) return; // revision prefill 우선
    const snap = loadWizardSnapshot<PlannerSnapshotValues>('planner');
    if (!snap) return;
    // 거의 빈 snapshot 이면 (사용자가 첫 step 도 안 채움) 모달 안 띄움 — 신호 너무 약함
    const v = snap.values;
    const hasContent = !!(v.mainCity || v.selectedActivities?.length || v.dateRangeFrom || v.arrivalTerminal);
    if (!hasContent) {
      clearWizardSnapshot('planner');
      return;
    }
    setPendingSnap(v);
    setPendingStep(snap.step || 0);
    setResumeOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyResumeSnapshot() {
    if (!pendingSnap) return;
    const v = pendingSnap;
    // 각 state 개별 복원. 누락된 필드는 default 유지 (실수로 새 필드 추가 후 deploy 시
    // 기존 snapshot 파싱 안전).
    setReservationStatus(v.reservationStatus ?? null);
    setMainCity(v.mainCity ?? '');
    setMainCityKey(v.mainCityKey ?? '');
    setExtraCities(Array.isArray(v.extraCities) ? v.extraCities : []);
    setSelectedActivities(Array.isArray(v.selectedActivities) ? v.selectedActivities : []);
    setFreeText(v.freeText ?? '');
    setDietPrefs(Array.isArray(v.dietPrefs) ? v.dietPrefs : []);
    setAllergies(Array.isArray(v.allergies) ? v.allergies : []);
    setPriceRange(v.priceRange ?? 'Any');
    setSpiceLevel(v.spiceLevel ?? 'medium');
    setBucketDishes(Array.isArray(v.bucketDishes) ? v.bucketDishes : []);
    // dateRange 복원: ISO 문자열 → Date 변환. 잘못된 값이면 undefined.
    if (v.dateRangeFrom) {
      const from = new Date(v.dateRangeFrom);
      if (!Number.isNaN(from.getTime())) {
        const to = v.dateRangeTo ? new Date(v.dateRangeTo) : undefined;
        setDateRange({ from, to: to && !Number.isNaN(to.getTime()) ? to : undefined });
      }
    }
    setPaxInput(v.paxInput ?? '2');
    setArrivalTerminal(v.arrivalTerminal ?? '');
    setHotelAddress(v.hotelAddress ?? '');
    setArrivalTime(v.arrivalTime ?? '');
    setDepartureTime(v.departureTime ?? '');
    setLuggageSmall(typeof v.luggageSmall === 'number' ? v.luggageSmall : 0);
    setLuggageMedium(typeof v.luggageMedium === 'number' ? v.luggageMedium : 0);
    setLuggageLarge(typeof v.luggageLarge === 'number' ? v.luggageLarge : 0);
    setWantAccom(!!v.wantAccom);
    setAccomBudget(v.accomBudget ?? 'moderate');
    // 2026-05-11 (B-2): Record 복원 + legacy single-string snapshot fallback.
    // 기존 사용자는 recommendedZone (string) 만 갖고 있을 수 있음. mainCityKey
    // 매핑으로 Record 로 lift — 도시 미상이면 빈 Record.
    if (v.recommendedZones && typeof v.recommendedZones === 'object' && !Array.isArray(v.recommendedZones)) {
      setRecommendedZones(v.recommendedZones);
    } else {
      // legacy snapshot: { recommendedZone: 'myeongdong' } — Record 로 lift.
      const legacyZone = (v as unknown as { recommendedZone?: string }).recommendedZone;
      const legacyMainKey = v.mainCityKey || '';
      if (legacyZone && legacyMainKey) {
        setRecommendedZones({ [legacyMainKey]: legacyZone });
      } else {
        setRecommendedZones({});
      }
    }
    setTourPace((v.tourPace as TourPace) ?? 'full');
    setStep(pendingStep);
    setResumeOpen(false);
    setPendingSnap(null);
  }

  function discardResumeSnapshot() {
    clearWizardSnapshot('planner');
    setResumeOpen(false);
    setPendingSnap(null);
  }

  // derived
  const allCities = mainCity ? [mainCity, ...extraCities.filter(c => c !== mainCity)] : [];
  // 2026-05-10 다도시 plan UX: extraCities (이름) → zoneData cityKey 배열.
  // ZoneRecommender 가 모든 selected cities zone 묶음 표시.
  const extraCityKeys = extraCities
    .map(name => cityNameToZoneKey(name))
    .filter((k): k is string => !!k && k !== mainCityKey);
  const cityKeys = mainCityKey ? [mainCityKey, ...extraCityKeys] : ['seoul'];
  const isMultiCity = cityKeys.length > 1;
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

  // 2026-05-09 (B9-35): debounced autosave. resume modal 이 떠 있는 동안엔 저장 X
  // (사용자가 아직 결정 안 했으므로 기존 snapshot 덮어쓰면 안 됨).
  const autosaveValues: PlannerSnapshotValues = {
    reservationStatus,
    mainCity, mainCityKey, extraCities,
    selectedActivities, freeText,
    dietPrefs, allergies, priceRange, spiceLevel, bucketDishes,
    dateRangeFrom: dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : null,
    dateRangeTo: dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : null,
    paxInput, arrivalTerminal, hotelAddress,
    arrivalTime, departureTime,
    luggageSmall, luggageMedium, luggageLarge,
    wantAccom, accomBudget, recommendedZones, tourPace,
  };
  // resume modal 활성 시 'planner_paused' namespace 로 저장 → real snapshot 유지.
  // (사용자가 모달 띄운 채 다른 input 만지면 새 snap 으로 덮이는 일 방지)
  useWizardPersistence(resumeOpen ? 'planner_paused' : 'planner', autosaveValues, step);

  // 2026-05-09 (B9-35): resume modal summary — 저장된 snapshot 의 핵심 필드 압축.
  // "Seoul · 4박 5일 · 2명" 또는 "Seoul · 2명" (날짜만 빠져도 OK).
  function buildSnapshotSummary(s: PlannerSnapshotValues | null): string {
    if (!s) return '';
    const parts: string[] = [];
    if (s.mainCity) parts.push(s.mainCity);
    if (s.dateRangeFrom && s.dateRangeTo) {
      const from = new Date(s.dateRangeFrom);
      const to = new Date(s.dateRangeTo);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        const nightsCount = Math.max(0, differenceInCalendarDays(to, from));
        if (nightsCount > 0) parts.push(`${nightsCount}N${nightsCount + 1}D`);
      }
    }
    const paxNum = parseInt(s.paxInput || '0', 10);
    if (paxNum > 0) parts.push(`${paxNum} pax`);
    return parts.join(' · ');
  }

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

  // 2026-05-10 B10-1: 다도시 plan 시 사용자가 다른 도시로 입국 변경. handlePickZone
  // 의 swap 패턴 재사용 — mainCity ↔ extraCities[idx] 교환. 공항 dropdown 도
  // useEffect [mainCityKey] chain 으로 자동 PUS/Gimhae 등 변경.
  function handleEntryCityChange(newEntryCityKey: string) {
    if (newEntryCityKey === mainCityKey) return;
    const idx = extraCities.findIndex(name => cityNameToZoneKey(name) === newEntryCityKey);
    if (idx === -1) return;
    const newMainCityName = extraCities[idx];
    const oldMainCityName = mainCity;
    setMainCity(newMainCityName);
    setMainCityKey(newEntryCityKey);
    setExtraCities(prev => {
      const next = [...prev];
      next[idx] = oldMainCityName;
      return next;
    });
  }

  // 2026-05-10 다도시 plan UX: zone 선택 시 그 zone 이 속한 도시가 mainCity 와
  // 다르면 자동 swap (mainCity ↔ extraCities[idx]). 이렇게 하면 공항 dropdown
  // 도 useEffect [mainCityKey] chain 으로 자동 업데이트, hub city 와 zone 정합.
  //
  // 2026-05-11 (B-2 fix): 시그니처 (cityKey, zoneKey) — 도시별 zone Record 단위
  // 토글. 다른 도시 zone 선택은 그 도시 슬롯만 교체 → 사용자가 두 도시 모두
  // zone 보유 가능. zoneKey='' 면 그 도시 slot 만 deselect (다른 도시 유지).
  // mainCity auto-swap 은 (1) 첫 zone 선택 (= 다른 도시 zone 없음) 시에만 발동.
  // 두 번째 도시 zone 선택 시 swap 안 함 — 첫 도시 = 입국 hub 로 유지.
  function handlePickZone(zoneCityKey: string, zoneKey: string) {
    setRecommendedZones(prev => {
      const next = { ...prev };
      if (zoneKey) {
        next[zoneCityKey] = zoneKey;
      } else {
        delete next[zoneCityKey];
      }
      return next;
    });
    if (!zoneKey) return; // deselect — swap 안 함
    if (zoneCityKey === mainCityKey) return; // already main — no swap
    // 다른 도시 zone 도 이미 선택된 상태면 swap 안 함 — 사용자가 의도적으로 두
    // 도시 모두 골랐을 가능성 높음. main = entry/airport 도시 유지.
    const hasOtherCityZone = Object.entries(recommendedZones)
      .some(([ck, zk]) => ck !== zoneCityKey && !!zk);
    if (hasOtherCityZone) return;
    const idx = extraCities.findIndex(name => cityNameToZoneKey(name) === zoneCityKey);
    if (idx === -1) return; // 일치 도시 없음 (예외 가드)
    const newMainCityName = extraCities[idx];
    const oldMainCityName = mainCity;
    setMainCity(newMainCityName);
    setMainCityKey(zoneCityKey);
    setExtraCities(prev => {
      const next = [...prev];
      next[idx] = oldMainCityName;
      return next;
    });
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
      // 2026-05-10 다도시 plan UX: zone 이 mainCity 가 아닌 도시 (e.g. 부산) 에서
      // 선택될 수 있으므로 mainCityKey 한정 lookup → 글로벌 reverse lookup 으로 변경.
      // handlePickZone 의 mainCity auto-swap 이 한 frame 늦게 commit 되는 경우도
      // safe (zoneData 전체에서 zone key unique).
      //
      // 2026-05-11 (B-2 fix): Record 에서 mainCity zone 우선, 없으면 첫 키 zone.
      // RouteAgent 의 공항→hotel 경로는 entry city (mainCity) zone 기반.
      const mainCityZone = recommendedZones[mainCityKey] || '';
      const firstAvailableZone = mainCityZone || Object.values(recommendedZones).find(z => !!z) || '';
      // 2026-05-13 PR #393 후속: getZoneByKey 가 zoneData heavy arrays 를 참조 →
      // submit 시점에 dynamic import. handleGenerate 가 async 라 자연스럽게 await.
      let zoneAnchor: string | undefined = undefined;
      if (!hotelAddress && firstAvailableZone) {
        const { getZoneByKey } = await import('./zoneData');
        zoneAnchor = getZoneByKey(firstAvailableZone)?.zone.anchorAddress;
      }
      // 2026-05-10 B10-1/B10-2: 다도시 시 entry city 의 호텔 = hotel_address (RouteAgent
      // 가 entry 공항 → 첫 호텔 경로 계산). hotelByCity Record 도 같이 forward
      // (buildPrompt.js 가 day 별 prompt 에 도시별 호텔 inject).
      const effectiveHotelAddress = isMultiCity
        ? (hotelByCity[mainCityKey] || hotelAddress)
        : hotelAddress;
      const res = await onSubmit({
        startDate: sd, endDate: ed,
        regions: allCities.length > 0 ? allCities : ['Seoul'],
        categories: selectedActivities, transport: 'staria', pax, durationDays,
        freeText: freeText || '',
        arrival_airport: arrivalTerminal,
        departure_airport: departureAirport,
        hotel_address: effectiveHotelAddress,
        // 다도시 시 추가 컨텍스트 — backend buildPrompt.js 가 도시별 prompt inject.
        ...(isMultiCity && Object.keys(hotelByCity).length > 0 ? { hotelByCity } : {}),
        ...(isMultiCity ? { entry_city: mainCityKey } : {}),
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
        // 2026-05-11 (B-2): 단도시 또는 mainCity zone (= entry city) 우선. backend
        // RouteAgent + LODGING ZONE PREFERENCE prompt 는 단일 zone 기준 작동.
        recommended_zone: !hotelAddress && firstAvailableZone ? firstAvailableZone : undefined,
        // 2026-05-11 (B-2): 다도시 시 도시별 zone Record. backend buildPrompt MULTI-CITY
        // HANDLING 섹션이 도시별 prompt 분기 inject. 단도시 plan 도 동일 형식 전달.
        recommended_zones: !hotelAddress && Object.keys(recommendedZones).length > 0
          ? recommendedZones
          : undefined,
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
      } else {
        // 2026-05-09 (B9-35): 제출 성공 → autosave snapshot 정리.
        // (실패 시엔 유지 — 사용자가 다시 시도 가능하도록)
        clearWizardSnapshot('planner');
        clearWizardSnapshot('planner_paused');
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
      {/* 2026-05-09 (B9-35): autosave 복원 모달. snapshot 발견 시에만 표시. */}
      <ResumeWizardModal
        open={resumeOpen}
        summary={buildSnapshotSummary(pendingSnap)}
        onContinue={applyResumeSnapshot}
        onRestart={discardResumeSnapshot}
      />
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
              key={step}로 React가 unmount/mount 인식 → exit 애니 발동.
              2026-05-13 PR #393 후속: 5 step 컴포넌트 모두 React.lazy. 한 번에 한
              step 만 마운트 → 다음 step 으로 이동 시점에 dynamic fetch. Suspense
              fallback 은 step 컨테이너 최소 높이 유지하는 spinner — layout shift
              방지. fetch 가 통상 < 100ms (preload + prefetch 가능) 이므로 UX 영향
              미미하나, 첫 진입 시 main planner chunk 가 가장 작아짐. */}
          <AnimatePresence initial={false}>
            <motion.div
              key={`step-${step}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
            >
              <Suspense fallback={
                <div className="min-h-[320px] flex items-center justify-center">
                  <div className="w-7 h-7 border-2 border-[#7C5CFC] border-t-transparent rounded-full animate-spin" />
                </div>
              }>
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
                  dateRange={dateRange} setDateRange={setDateRange}
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
                  recommendedZones={recommendedZones}
                  cityKeys={cityKeys}
                  onPickZone={handlePickZone}
                  isMultiCity={isMultiCity}
                  mainCityKey={mainCityKey}
                  onEntryCityChange={handleEntryCityChange}
                  hotelByCity={hotelByCity}
                  setHotelByCity={setHotelByCity}
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
                  language={language}
                  onEditStep={(s) => goToStep(s)} onGenerate={handleGenerate}
                />
              )}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
