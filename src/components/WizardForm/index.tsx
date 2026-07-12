// WizardForm container: holds shared wizard state + routes between steps.
// Previously src/components/WizardForm.tsx (798L) — split into step components
// under src/components/WizardForm/* for P3 Lock release.
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
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
import { track as posthogTrack } from '@/lib/posthog';
import { trackEvent } from '@/lib/analytics';
import { requestNotifyPermission } from '@/lib/notify';
import {
  useWizardPersistence,
  loadFreshestWizardSnapshot,
  clearWizardSnapshot,
  clearPlannerWizardSnapshot,
  markWizardDirtyExit,
} from '@/hooks/useWizardPersistence';
import { ResumeWizardModal } from '@/components/ResumeWizardModal';
import { WizardStepHint } from './WizardStepHint';

import { CITY_CHIPS, LOCALE_MAP } from './data';
import { getAirportOptions } from './helpers';
import { hasMeaningfulWizardContent, hasMeaningfulWizardContentStrict } from './snapshotContent';

// PR-D (2026-06-01): resume "이어서 작성" modal 과노출 fix 의 기능 플래그.
// OFF(기본) = 기존 동작 byte-identical. ON 일 때만 좁힌 트리거 적용:
//   (1) 임계값 ≥2 신호 (식이/알레르기는 단독 허용 — SAFETY)
//   (2) "사고 이탈(dirtyExit)" 마커가 있을 때만 modal 노출
//   (3) discard 가 planner + planner_paused 양쪽 키 정리
// string === 'true' 비교 — Vite env 는 항상 문자열.
const RESUME_DIRTY_EXIT_ON = import.meta.env.VITE_FEATURE_RESUME_DIRTY_EXIT === 'true';
// 2026-05-13 PR #393 후속: getZoneByKey 는 handleGenerate 안에서 dynamic import.
// cityNameToZoneKey + CITY_NAME_BY_KEY 는 zoneHelpers (light) 에서 직접 import →
// main planner chunk 에서 heavy zone arrays 분리.
import { cityNameToZoneKey } from './zoneHelpers';
// 2026-05-13 PR #393 후속: 5 step 컴포넌트 모두 lazy. 한 번에 하나만 마운트되므로
// 다음 step 으로 이동 시점에 fetch — 초기 planner chunk 에서 step 코드 분리.
// type-only re-export 는 컴파일 시 사라져 main chunk 영향 없음.
// step import 함수 추출 — lazy() + preload(idle 마운트) 둘 다 재사용. (2026-06-02 A3: 깜빡임 완성)
const importStep0Reservation = () => import('./WizardStep0Reservation');
const importStep0Destination = () => import('./WizardStep0Destination');
const importStep1Food = () => import('./WizardStep1Food');
const importStep2Details = () => import('./WizardStep2Details');
const importStep3Review = () => import('./WizardStep3Review');
const STEP_IMPORTS = [importStep0Reservation, importStep0Destination, importStep1Food, importStep2Details, importStep3Review];
const WizardStep0Reservation = lazy(() => importStep0Reservation().then(m => ({ default: m.WizardStep0Reservation })));
const WizardStep0Destination = lazy(() => importStep0Destination().then(m => ({ default: m.WizardStep0Destination })));
const WizardStep1Food = lazy(() => importStep1Food().then(m => ({ default: m.WizardStep1Food })));
const WizardStep2Details = lazy(() => importStep2Details().then(m => ({ default: m.WizardStep2Details })));
const WizardStep3Review = lazy(() => importStep3Review().then(m => ({ default: m.WizardStep3Review })));
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
  /** P142 (2026-05-22): 입국/출국 공항 분리. 빈 문자열 = arrivalTerminal 과 동일
   *  (단도시 plan 기본값 / backward compat snapshot). 사용자가 명시적으로 다른 값을
   *  고른 경우만 채워짐 (예: 입국=T1, 출국=T2 또는 ICN→GMP). */
  departureTerminal: string;
  hotelAddress: string;
  arrivalTime: string;
  departureTime: string;
  /** P239 (2026-05-27): 투어 시작 시각. default '09:00'. 새벽 도착 + Day1 stops 분리
   *  architectural fix. arrival_time 무관하게 Day1 첫 stop 시각을 고정 (호텔 anchor 유지). */
  tourStartTime: string;
  /** #tour-end (2026-06-05): 투어 종료 시각 cap. default '21:00'. 모든 day 의 관광 stop 을
   *  이 시각 이후 trim → 사용자가 원하는 시간에 일정 종료 (호텔 복귀·휴식). */
  tourEndTime: string;
  luggageSmall: number;
  luggageMedium: number;
  luggageLarge: number;
  wantAccom: boolean;
  accomBudget: string;
  // 2026-05-11 (B-2): single-zone string → Record<city, zone>. autosave snapshot 의
  // 기존 사용자는 recommendedZone (legacy) 만 갖고 있을 수 있어 복원 시 fallback 처리.
  recommendedZones: Record<string, string>;
  tourPace: TourPace;
  /** UIUX P3 (2026-07-13): 동행 유형 — 선택형. 옛 snapshot 엔 없음 → 복원 시 '' 폴백. */
  companions?: '' | 'solo' | 'couple' | 'family' | 'friends';
  /** PR-D (2026-06-01): "사고 이탈" 마커. pagehide 가 동기 기록 → resume modal 의
   *  좁힌 트리거(flag ON)가 dirtyExit 있을 때만 노출. 사용자 입력 시그널이 아니라
   *  라이프사이클 신호 — autosaveValues 에는 직렬화하지 않고(markWizardDirtyExit 가
   *  저장된 snapshot 에 직접 기록), 복원(applyResumeSnapshot) 시에도 무시. optional. */
  dirtyExit?: boolean;
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

  // wizard_started (PostHog) — 깔때기 상단 진입 지표. WizardForm 이 처음 마운트될 때
  // 1회만 발화 → 시작→생성→결제 전환율의 분모(시작 수) 확보. payment_started 등 기존
  // 이벤트 패턴(void posthogTrack)과 동일. StrictMode 의 이중 마운트로 두 번 발화하는
  // 것을 막기 위해 ref 가드 사용(키 미설정 빌드에서는 track 이 no-op).
  const wizardStartedRef = useRef(false);
  useEffect(() => {
    if (wizardStartedRef.current) return;
    wizardStartedRef.current = true;
    void posthogTrack('wizard_started', {
      language,
      started_at: new Date().toISOString(),
    });
    // GA4 planner_start — 위저드 진입 = 고의향 신호. Google Ads Smart Bidding 이 깔때기 상단
    //   (방문→위저드시작→결제진입→구매)을 인식하게. trackEvent 는 GA 미설정 시 no-op.
    trackEvent('planner_start', { language });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // step 청크 preload — 마운트 후 idle 시 모든 step import 선로드 → 전환/이어서하기 점프 시
  // Suspense fallback flash(깜빡임) 제거 (2026-06-02 A3 후보2, #768 mode="wait" 후속).
  useEffect(() => {
    const preloadAll = () => { STEP_IMPORTS.forEach((fn) => { fn().catch(() => {}); }); };
    const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(preloadAll);
      return () => { w.cancelIdleCallback?.(id); };
    }
    const t = setTimeout(preloadAll, 1500);
    return () => clearTimeout(t);
  }, []);
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
  // 2026-05-21 (P125): 다도시 plan 의 명시적 입국/출국 도시. cityKey 형식.
  // 사용자 신고 (5/21): "서울 부산이면 어디서 입국하고 어디서 출국하는지 표시해야되는데
  // 없더라" — 단일 mainCity 로 entry 만 추론 → 출국 city 모호성.
  const [arrivalCityKey, setArrivalCityKey]     = useState<string>('');
  const [departureCityKey, setDepartureCityKey] = useState<string>('');

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
  // P142 (2026-05-22): 출국 공항/터미널 분리. 빈 문자열 = arrivalTerminal 폴백.
  // 사용자가 입국=T1, 출국=T2 (또는 입국=ICN, 출국=GMP) 같이 다른 터미널 선택 가능.
  // 이전 회귀 (PR #522 fix): 출국 터미널을 입국 터미널 변수로 직접 할당해서
  const [departureTerminal, setDepartureTerminal] = useState('');
  const [hotelAddress, setHotelAddress]       = useState('');
  // 2026-05-10 B10-2: 다도시 plan 시 도시별 호텔 주소 (cityKey → address). 단도시면
  // 기존 hotelAddress 사용 (backward compat). entry_city = mainCityKey 자동.
  const [hotelByCity, setHotelByCity]         = useState<Record<string, string>>({});
  // Klook/Trip.com pattern: collect arrival time + luggage so backend can
  // recommend the right airport-to-hotel transport (late night → limousine,
  // heavy bags → taxi, otherwise AREX). All optional but improves accuracy.
  const [arrivalTime, setArrivalTime]         = useState('');     // "HH:MM" 24h
  const [departureTime, setDepartureTime]     = useState('');     // "HH:MM" 24h
  // P239 (2026-05-27): tourStartTime — 새벽 도착 fix. default '09:00' (운영자 권장).
  // arrival_time 과 별개로 Day1 stops 시작 시각을 고정 → 새벽 도착 시 호텔만 transit
  // + 09:00 부터 stops 시작. root cause: P159 / P136 / B-13 false positive 해소.
  const [tourStartTime, setTourStartTime]     = useState('09:00'); // "HH:MM" 24h (default 09:00)
  // #tour-end (2026-06-05): tourEndTime — 매일 관광 종료 시각 cap. default '21:00' (운영자 권장).
  // 모든 day 의 마지막 관광 stop 이 이 시각 이전이도록 → 사용자 지정 종료시간 준수 (호텔 복귀).
  const [tourEndTime, setTourEndTime]         = useState('21:00'); // "HH:MM" 24h (default 21:00)
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
  // UIUX P3 (2026-07-13, 운영자 승인): 동행 유형 — 선택형(강제 X). ''=미선택=기존 동작 그대로.
  const [companions, setCompanions]           = useState<'' | 'solo' | 'couple' | 'family' | 'friends'>('');
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
  // #resume-instant (2026-06-05): "이어서" 점프 시 step 전환 애니 1회 억제 → 제자리 즉시 복원.
  // mode="wait" exit→enter 빈틈이 "강제 새로고침 느낌"의 주범(운영자 #4). 일반 next/prev 는 슬라이드 유지.
  const [noStepAnim, setNoStepAnim] = useState(false);
  const [jumpToStep, setJumpToStep] = useState<number | null>(null);

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
  // 2026-05-21 (P126): 사용자 신고 "이어 작성하시겠습니까 아무때나 나와". hasContent
  // 의 dateRangeFrom 검사가 false positive — dateRange.from 은 mount 시 tomorrow
  // 기본값 auto-init (L131-135) → autosave 500ms 후 항상 snapshot 저장 → 재방문 시 모달.
  // 사용자는 wizard 만 열고 닫았을 뿐인데 "이어 작성" 발화.
  // Fix: dateRangeFrom 제외 + 명시적 사용자 시그널 (reservationStatus / freeText /
  // dietPrefs / allergies / paxInput≠default / dateRangeTo 등) 모두 확인.
  useEffect(() => {
    if (initialValues) return; // revision prefill 우선
    // P316 (2026-05-30): 'planner' + 'planner_paused' 중 ts 최신 snapshot 채택.
    // (paused = resume modal 떠 있던 중 편집분. 이전엔 읽는 곳이 없어 새로고침 시
    //  silent 손실됐음 = write-only dead key.) 결제 단계(PlanDetailPage)에서 SDK
    //  멈춤/광고차단으로 막혀 새로고침 → /planner 재진입 시에도 직전 입력 복원 +
    //  resume modal 노출 (handleGenerate 성공 시점에 더 이상 snapshot 을 지우지 않음
    //  — 아래 handleGenerate else 분기 주석 참고).
    const fresh = loadFreshestWizardSnapshot<PlannerSnapshotValues>('planner', 'planner_paused');
    if (!fresh) return;
    const v = fresh.snapshot.values;
    // P126 (2026-05-21): 명시적 사용자 입력 시그널만 hasContent 로 인정. dateRangeFrom 은
    // mount 시 tomorrow auto-init 이라 false positive — 제외. helper 는 testable.
    // (과노출 방지 규칙 유지: clicker-only/무의미 snapshot 은 여전히 modal 미노출.)
    // PR-D (2026-06-01, flag ON): 임계값을 ≥2 신호로 상향 (strict). 식이/알레르기 단독 허용.
    //   플래그 OFF = 기존 hasMeaningfulWizardContent (단일 시그널) 그대로 → byte-identical.
    const hasContent = RESUME_DIRTY_EXIT_ON
      ? hasMeaningfulWizardContentStrict(v)
      : hasMeaningfulWizardContent(v);
    if (!hasContent) {
      // 의미 없는 snapshot — 양쪽 키 모두 정리.
      clearWizardSnapshot('planner');
      clearWizardSnapshot('planner_paused');
      return;
    }
    // PR-D (2026-06-01, flag ON): 콘텐츠는 의미있지만 "사고 이탈(dirtyExit)" 마커가 없으면
    // modal 미노출 — "정상 이탈"(둘러보다 나감)일 가능성. 단 snapshot 은 보존(삭제 X):
    //  - P316 결제 단계 retention 을 깨면 안 됨.
    //  - 이후 진짜 중단(새로고침/탭닫힘) 시 pagehide 가 dirtyExit 를 켜면 그때 노출.
    // 플래그 OFF 에선 이 게이트가 없어 기존처럼 dirtyExit 무관하게 노출 → byte-identical.
    if (RESUME_DIRTY_EXIT_ON && !v.dirtyExit) {
      return;
    }
    // paused 가 더 최신이라 채택됐다면 stale 'planner' 키 정리 (모달 결정 일관성).
    // applyResumeSnapshot/discardResumeSnapshot 는 'planner' 만 지우므로, 채택분이
    // paused 였다면 반대편 stale 키를 미리 치워 다음 마운트 혼선 방지.
    if (fresh.staleSource) {
      clearWizardSnapshot(fresh.staleSource);
    }
    setPendingSnap(v);
    setPendingStep(fresh.snapshot.step || 0);
    setResumeOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PR-D (2026-06-01): "사고 이탈" 감지 — 입력 도중 페이지가 teardown(새로고침/탭닫힘/
  // 뒤로가기로 SPA 이탈)될 때 pagehide 가 동기적으로 dirtyExit 마커를 저장.
  // 다음 /planner 진입 시 좁힌 트리거(flag ON)가 이 마커가 있을 때만 resume modal 노출 →
  // "잠깐 둘러보다 정상적으로 나간" 경우의 과노출 제거.
  //
  // - 리스너는 항상 등록(플래그 무관) — 마커 기록 자체는 무해(트리거 판정만 플래그 분기).
  // - unmount 시 cleanup 필수 (결제 페이지로 client 전이 시 리스너 누수 방지).
  // - markWizardDirtyExit 는 저장된 snapshot 이 있을 때만 동작(없으면 noop) → 빈 noise X.
  // - 활성 namespace(planner / planner_paused) 둘 다 마킹 → 어느 쪽이 채택되든 마커 보존.
  //   (다음 마운트의 loadFreshestWizardSnapshot 가 ts 로 freshest 를 고름.)
  // - beforeunload 대신 pagehide: bfcache 친화 + 모바일 신뢰도 높음 (Safari/iOS).
  useEffect(() => {
    const onPageHide = () => {
      markWizardDirtyExit('planner', true);
      markWizardDirtyExit('planner_paused', true);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
    // 등록/해제 1회 — onPageHide 는 클로저 변수에 의존하지 않음(고정 키 마킹).
  }, []);

  // #resume-instant: noStepAnim 켜진 "다음" 커밋에서 step 점프 수행 — 현재 step 이 먼저 instant(0ms)
  // 로 재렌더된 뒤 exit 되므로 exit/enter 둘 다 빈틈 없이 즉시. jumpToStep 은 1회용 트리거.
  useEffect(() => {
    if (jumpToStep === null) return;
    setStep(jumpToStep);
    setJumpToStep(null);
  }, [jumpToStep]);

  // 점프 완료(jumpToStep 소진 + step 갱신) 후 애니 복원 — 일반 네비게이션은 다시 0.25s 슬라이드.
  useEffect(() => {
    if (!noStepAnim || jumpToStep !== null) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setNoStepAnim(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [step, noStepAnim, jumpToStep]);

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
    setDepartureTerminal(v.departureTerminal ?? '');
    setHotelAddress(v.hotelAddress ?? '');
    setArrivalTime(v.arrivalTime ?? '');
    setDepartureTime(v.departureTime ?? '');
    // P239 (2026-05-27): tourStartTime resume — 없는 snapshot 은 default '09:00'.
    // 옛 snapshot 호환 (architectural fix 도입 전 사용자) — undefined → '09:00'.
    setTourStartTime(v.tourStartTime ?? '09:00');
    // #tour-end (2026-06-05): tourEndTime resume — 없는 snapshot 은 default '21:00' (옛 snapshot 호환).
    setTourEndTime(v.tourEndTime ?? '21:00');
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
    setCompanions((v.companions as '' | 'solo' | 'couple' | 'family' | 'friends') ?? '');
    // #resume-instant: 애니 억제 플래그를 먼저 켜(현재 step 이 instant 로 재렌더된 뒤),
    // 다음 커밋에서 step 점프(jumpToStep) → exit/enter 둘 다 0ms = 제자리 즉시 (mode="wait" 빈틈 제거).
    setNoStepAnim(true);
    setJumpToStep(pendingStep);
    setResumeOpen(false);
    setPendingSnap(null);
  }

  function discardResumeSnapshot() {
    // PR-D (2026-06-01, flag ON): "새로 시작" 시 양쪽 키 모두 정리.
    // 기존 버그: 'planner' 만 지워 'planner_paused' 잔존 → 다음 마운트에서
    // freshest 로 다시 채택돼 modal 재노출 가능. flag ON 에서 clearPlannerWizardSnapshot()
    // 로 둘 다 제거. 플래그 OFF = 기존 동작('planner' 만) 보존 → byte-identical.
    if (RESUME_DIRTY_EXIT_ON) {
      clearPlannerWizardSnapshot();
    } else {
      clearWizardSnapshot('planner');
    }
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
  // P142 (2026-05-22) → P-launch (2026-05-31): 출국 공항.
  //   ⚠️ 이전엔 `departureTerminal || arrivalTerminal` 로 미선택 시 *입국 공항*을 강제 →
  //   다도시(서울→부산) plan 에서 출국이 '부산→인천(ICN)' 으로 잘못 안내 = 비행기 놓침 risk.
  //   FIX: 사용자가 명시 안 했으면 '' 를 보내 backend inferDepartureAirport 가
  //   *마지막 도시* 기준 도출하게 위임 (부산→김해 PUS / 제주→CJU / 단도시·미매핑→입국 공항).
  //   사용자가 dropdown 에서 명시 선택하면 그 값 그대로 존중 (override 안 함 = 안전).
  const departureAirport = departureTerminal;

  const airportOptions = getAirportOptions(mainCityKey || 'seoul');

  // Reset airport when mainCity changes
  useEffect(() => {
    const validValues = airportOptions.map(o => o.value);
    if (arrivalTerminal && !validValues.includes(arrivalTerminal)) {
      setArrivalTerminal('');
    }
    // P142: 다도시에서 mainCity 변경 시 departureTerminal 도 검증.
    // 출국지 도시가 mainCity 와 다를 수 있어 airportOptions 검사 skip — 단도시면
    // 같이 reset, 다도시면 별도 도시 공항 옵션 사용 가능 (사용자 자유).
    if (departureTerminal && !validValues.includes(departureTerminal) && cityKeys.length <= 1) {
      setDepartureTerminal('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainCityKey]);

  // 2026-05-21 (P125): arrival/departure role 자동 cleanup. 사용자가 도시를 deselect
  // 하면 (예: extraCities 에서 제거, mainCity swap) 그 도시의 role 도 해제.
  // 또한 arrival === departure 무효 상태 차단 (단도시 plan 의 경우만 같을 수 있음).
  useEffect(() => {
    const liveKeys = mainCityKey ? [mainCityKey, ...extraCityKeys] : [];
    if (arrivalCityKey && !liveKeys.includes(arrivalCityKey)) setArrivalCityKey('');
    if (departureCityKey && !liveKeys.includes(departureCityKey)) setDepartureCityKey('');
    // 다도시 plan 인데 arrival === departure 같으면 departure 해제 (사용자 cycle 중 혼동).
    if (liveKeys.length > 1 && arrivalCityKey && arrivalCityKey === departureCityKey) {
      setDepartureCityKey('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainCityKey, extraCityKeys.join(','), arrivalCityKey, departureCityKey]);

  const calendarLocale = LOCALE_MAP[language] || enUS;

  // 2026-05-09 (B9-35): debounced autosave. resume modal 이 떠 있는 동안엔 저장 X
  // (사용자가 아직 결정 안 했으므로 기존 snapshot 덮어쓰면 안 됨).
  const autosaveValues: PlannerSnapshotValues = {
    reservationStatus,
    mainCity, mainCityKey, extraCities,
    selectedActivities, freeText,
    dietPrefs, allergies, priceRange, spiceLevel, bucketDishes,
    // P239 (2026-05-27): tourStartTime autosave — wizard reopen 시 복원.
    tourStartTime,
    // #tour-end (2026-06-05): tourEndTime autosave — wizard reopen 시 복원.
    tourEndTime,
    dateRangeFrom: dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : null,
    dateRangeTo: dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : null,
    paxInput, arrivalTerminal, departureTerminal, hotelAddress,
    arrivalTime, departureTime,
    luggageSmall, luggageMedium, luggageLarge,
    wantAccom, accomBudget, recommendedZones, tourPace, companions,
    // PR-D 주의: dirtyExit 는 일부러 여기 넣지 않는다. 이 라이프사이클 마커는
    // markWizardDirtyExit 가 저장된 snapshot 에 직접(out-of-band) 기록한다. 여기에
    // 넣으면(예: false 고정) autosave 가 디바운스마다 마커를 덮어써 사고 이탈 신호가
    // 사라진다. autosave 는 [autosaveValues, step] 변경 시에만 도므로, 마커를 켠 뒤
    // 사용자 입력이 없으면(=teardown 직전, 결제 단계 진입 직후) 덮어쓰지 않는다.
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
      // 2026-05-21 (P134 분기 #10 fix): mainCity 변경 시 oldMainKey 의 hotelByCity /
      // recommendedZones Record 키 cleanup. 누락 시 backend buildPrompt 가 deselect 된
      // 도시의 호텔 주소 inject → P122 placeholder 회귀.
      const oldMainKey = mainCityKey;
      const next = extraCities[0] || '';
      const newMainKey = next ? (CITY_CHIPS.find(c => getCityName(c.key) === next)?.key || '') : '';
      setMainCity(next);
      setMainCityKey(newMainKey);
      setExtraCities(prev => prev.slice(1));
      if (oldMainKey) {
        setHotelByCity(prev => {
          if (!(oldMainKey in prev)) return prev;
          const { [oldMainKey]: _drop, ...rest } = prev;
          return rest;
        });
        setRecommendedZones(prev => {
          if (!(oldMainKey in prev)) return prev;
          const { [oldMainKey]: _drop, ...rest } = prev;
          return rest;
        });
      }
    } else if (extraCities.includes(cityName)) {
      // 2026-05-21 (P134 분기 #10 fix): 다도시 deselect 시 그 도시 hotelByCity / zones 키 cleanup.
      const removedKey = cityNameToZoneKey(cityName);
      setExtraCities(prev => prev.filter(c => c !== cityName));
      if (removedKey) {
        setHotelByCity(prev => {
          if (!(removedKey in prev)) return prev;
          const { [removedKey]: _drop, ...rest } = prev;
          return rest;
        });
        setRecommendedZones(prev => {
          if (!(removedKey in prev)) return prev;
          const { [removedKey]: _drop, ...rest } = prev;
          return rest;
        });
      }
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
        // 2026-05-21 (P134 분기 #1 fix, R-P133): buildPrompt 가 reservation_status 사용하는데
        // frontend payload 미전달이던 회귀. nothing/flight/flight_hotel/all_done 4 종 forward.
        ...(reservationStatus ? { reservation_status: reservationStatus } : {}),
        // 다도시 시 추가 컨텍스트 — backend buildPrompt.js 가 도시별 prompt inject.
        // 2026-05-21 (P134 Layer 1): 빈 객체도 전달. 운영자 의도 — 호텔 입력 옵셔널.
        // 호텔 없는 도시는 backend buildPrompt 가 zone 중심 bookend 분기 (Layer 2,
        // buildPrompt.js #10 호텔 미입력 도시 섹션). P122/P123 silent placeholder 차단.
        ...(isMultiCity ? { hotelByCity: hotelByCity ?? {} } : {}),
        ...(isMultiCity ? { entry_city: mainCityKey } : {}),
        // 2026-05-21 (P125): 사용자가 명시적으로 입국/출국 도시 클릭 cycle 로 지정한 경우만
        // forward. 미입력 시 backend buildPrompt MULTI-CITY HANDLING 의 city ordering rule
        // (arrival_airport → 첫 도시) 폴백.
        ...(arrivalCityKey ? { arrival_city: arrivalCityKey } : {}),
        ...(departureCityKey ? { departure_city: departureCityKey } : {}),
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
        // UIUX P3: 동행 유형 — 미선택('')이면 필드 자체 미전송 = 기존 동작 그대로.
        companions: companions || undefined,
        // New: airport-transport context (all optional)
        arrival_time: arrivalTime || undefined,
        departure_time: departureTime || undefined,
        // P239 (2026-05-27): 투어 시작 시간 — 운영자 architectural fix.
        // arrival_time 무관하게 Day1 stops 시작 시각을 고정 (default 09:00).
        // 새벽 도착 시 호텔 transit 만 + tourStartTime 부터 stops 작성.
        // root cause level 해결: P159 / P136 / B-13. snake_case → backend 가 camelCase 변환 처리.
        tour_start_time: tourStartTime || '09:00',
        // #tour-end (2026-06-05): 투어 종료 시각 cap — 모든 day 관광 stop 을 이 시각 이후 trim.
        // snake_case → backend requestShaper 가 camelCase(tourEndTime) 변환 처리. default 21:00.
        tour_end_time: tourEndTime || '21:00',
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
        // P316 (2026-05-30): 제출(quick preview 생성) 성공 시점에는 'planner'
        // snapshot 을 지우지 '않는다'. 운영자 신고 — 생성 성공 → 결제 단계
        // (PlanDetailPage / PurchaseSection 의 PayPal) 로 진행하는데, 결제 SDK
        // 로딩 실패 / 광고차단 / 멈춤으로 막힌 뒤 사용자가 새로고침하거나 /planner
        // 로 되돌아오면, 이전엔 여기서 이미 snapshot 을 지워버려 위저드가 빈 1페이지로
        // 초기화 + resume modal 도 안 떴음 (입력 전부 소실).
        //
        // 결제 완료 전까지 plan 은 "끝난" 게 아니므로 snapshot 유지 → 재진입 시
        // resume modal 노출 (생성까지 간 입력은 hasMeaningfulWizardContent 항상 통과).
        // 'planner' 정리는 (a) 사용자 '새로 시작' discard, (b) 24h 만료
        // (loadWizardSnapshot STALE_MS), (c) 결제 완료 후 PlanDetailPage 의
        // clearPlannerWizardSnapshot() 이 담당.
        //
        // paused 는 modal 격리 저장용 임시 키라 성공 시점에 정리해도 무방 (정식
        // 'planner' 만 위 사유로 보존).
        clearWizardSnapshot('planner_paused');
        // PR-D (2026-06-01, flag ON): 생성 성공 → 결제 단계로 진행은 "정상 전이" 가
        // 아니라 "아직 안 끝남". 결제 중단(SDK 멈춤/광고차단/새로고침) 후 /planner
        // 재진입 시 좁힌 트리거가 dirtyExit AND 를 요구하므로, 여기서 'planner' 에
        // dirtyExit 마커를 켜 둔다 → P316 결제-창 retention + resume 노출 보존.
        // (결제 페이지로의 client 전이는 pagehide 를 발생시키지 않아 WizardForm
        //  리스너가 마킹할 기회가 없으므로, 이 시점에 명시적으로 켠다.)
        // 플래그 OFF 에선 dirtyExit 트리거 게이트 자체가 없으므로 이 마킹도 불필요.
        if (RESUME_DIRTY_EXIT_ON) {
          markWizardDirtyExit('planner', true);
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
      {/* 2026-05-09 (B9-35): autosave 복원 모달. snapshot 발견 시에만 표시. */}
      <ResumeWizardModal
        open={resumeOpen}
        summary={buildSnapshotSummary(pendingSnap)}
        onContinue={applyResumeSnapshot}
        onRestart={discardResumeSnapshot}
      />
      <div className="w-full">
        {/* Step Indicator — compact card aligned with charter/tours density */}
        <div
          className="rounded-[18px] px-3 py-3 sm:px-4 sm:py-3.5 mb-3.5 sm:mb-5"
          style={{
            background: 'linear-gradient(135deg, rgba(182,104,252,0.08), rgba(255,107,157,0.05))',
            border: '1px solid rgba(182,104,252,0.18)',
          }}
        >
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <div className="min-w-0">
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black tracking-[0.08em] uppercase"
                style={{
                  background: 'rgba(182,104,252,0.16)',
                  border: '1px solid rgba(182,104,252,0.30)',
                  color: '#D9A8FF',
                }}
              >
                <Wand2 className="w-3 h-3" />
                Step {step + 1} / {STEPS.length}
              </div>
              <p className="text-[13px] sm:text-[14px] font-bold text-white mt-1.5 leading-tight">
                {STEPS[step]?.label}
              </p>
            </div>
            <p className="text-[11px] font-bold text-white/45 shrink-0">{Math.round(((step + 1) / STEPS.length) * 100)}%</p>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden mb-2.5">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${((step + 1) / STEPS.length) * 100}%`,
                background: 'linear-gradient(90deg,#B668FC,#FF6B9D)',
              }}
            />
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {STEPS.map((s, i) => (
              <button
                key={i}
                aria-label={s.label}
                onClick={() => { if (i <= step) goToStep(i); }}
                className={`h-7 rounded-full text-[11px] font-black transition-all ${
                  i <= step ? 'text-white' : 'text-white/35 cursor-default'
                }`}
                style={i <= step
                  ? { background: i === step ? 'rgba(182,104,252,0.26)' : 'rgba(182,104,252,0.13)', border: '1px solid rgba(182,104,252,0.26)' }
                  : { background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                {i < step ? <Check className="w-3.5 h-3.5 mx-auto" /> : i + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-2xl mx-auto">
          {/* #wizard-step-hints (운영자 #3): 스텝별 친절 설명 — 첫 도달 시 1회 + "?" 재보기 (비차단). */}
          <WizardStepHint step={step} />
          {/* AnimatePresence + motion.div로 step 전환 시 슬라이드/페이드.
              key={step}로 React가 unmount/mount 인식 → exit 애니 발동.
              2026-05-13 PR #393 후속: 5 step 컴포넌트 모두 React.lazy. 한 번에 한
              step 만 마운트 → 다음 step 으로 이동 시점에 dynamic fetch. Suspense
              fallback 은 step 컨테이너 최소 높이 유지하는 spinner — layout shift
              방지. fetch 가 통상 < 100ms (preload + prefetch 가능) 이므로 UX 영향
              미미하나, 첫 진입 시 main planner chunk 가 가장 작아짐. */}
          {/* mode="wait" (2026-06-02, A3 진단): App.tsx 라우트 전환부와 일관 — 나가는 step exit
              완료 후 새 step mount. 빠져 있어서 sync 모드로 두 step 이 동시 렌더돼 "이어서 하기"
              점프 시 깜빡임/밀림 발생했음. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`step-${step}`}
              initial={noStepAnim ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: noStepAnim ? 0 : 0.25 }}
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
              {/* Step 1: destinations. P161: arrival/departure marking props 제거 (4페이지로 이전). */}
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
                  departureTerminal={departureTerminal} setDepartureTerminal={setDepartureTerminal}
                  hotelAddress={hotelAddress} setHotelAddress={setHotelAddress}
                  arrivalTime={arrivalTime} setArrivalTime={setArrivalTime}
                  departureTime={departureTime} setDepartureTime={setDepartureTime}
                  /* P239 (2026-05-27): tourStartTime — 새벽 도착 architectural fix */
                  tourStartTime={tourStartTime} setTourStartTime={setTourStartTime}
                  /* #tour-end (2026-06-05): tourEndTime — 매일 관광 종료 cap */
                  tourEndTime={tourEndTime} setTourEndTime={setTourEndTime}
                  luggageSmall={luggageSmall} setLuggageSmall={setLuggageSmall}
                  luggageMedium={luggageMedium} setLuggageMedium={setLuggageMedium}
                  luggageLarge={luggageLarge} setLuggageLarge={setLuggageLarge}
                  wantAccom={wantAccom} setWantAccom={setWantAccom}
                  accomBudget={accomBudget} setAccomBudget={setAccomBudget}
                  tourPace={tourPace} setTourPace={setTourPace}
                  companions={companions} setCompanions={setCompanions}
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
                  /* P161 (2026-05-23): 입국/출국 cycle 마킹 4페이지로 이전 */
                  allCities={allCities}
                  selectedCityKeys={selectedCityKeys}
                  arrivalCityKey={arrivalCityKey} departureCityKey={departureCityKey}
                  setArrivalCityKey={setArrivalCityKey} setDepartureCityKey={setDepartureCityKey}
                />
              )}
              {step === 4 && (
                <WizardStep3Review
                  p={p}
                  allCities={allCities} startDate={startDate} endDate={endDate}
                  arrivalTerminal={arrivalTerminal} pax={pax}
                  selectedActivities={selectedActivities} hotelAddress={hotelAddress}
                  // 2026-05-21 (P134 분기 #34/#35 fix): 다도시 + 호텔 anchor 미리보기 props
                  mainCityKey={mainCityKey}
                  hotelByCity={hotelByCity}
                  recommendedZones={recommendedZones}
                  isMultiCity={isMultiCity}
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
