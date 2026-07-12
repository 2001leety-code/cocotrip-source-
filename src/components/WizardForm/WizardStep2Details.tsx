// Step 2: travel dates, pax, airport, hotel address, arrival/departure time, luggage, accom opt-in.
// 2026-05-10 ZoneRecommender React.lazy: hotel 미입력 시점에만 노출 → 진입 즉시
// fetch (작은 skeleton fallback). Main bundle 에서 ZoneRecommender 코드 분리.
import { useState, lazy, Suspense } from 'react';
import { Plane, Briefcase, Minus, Plus, Pencil, PlaneLanding, PlaneTakeoff } from 'lucide-react';
import { WizardNav } from './WizardNav';
import { DayPicker } from 'react-day-picker';
import type { DateRange } from 'react-day-picker';
import type { Locale } from 'date-fns';
import type { AirportOption } from './data';
import type { WizardDict } from './types';
import { MobileSelectDrawer } from '@/components/MobileSelectDrawer';
import { useLanguage } from '@/hooks/useLanguage';
// P142 (2026-05-22): 출국 공항 옵션 빌더 — 다도시 union dedup.
import { getDepartureAirportOptions } from './helpers';
// 2026-05-13 PR #393 후속: light helper 만 import (zone arrays 는 ZoneRecommender
// lazy chunk 가 fetch — 본 컴포넌트는 도시 라벨만 필요).
import { CITY_NAME_BY_KEY } from './zoneHelpers';
import { calcVehicleCount } from '@/lib/luggageVehicle';
import { HotelSuggestInput } from './HotelSuggestInput';

const ZoneRecommender = lazy(() =>
  import('./ZoneRecommender').then(m => ({ default: m.ZoneRecommender })),
);

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
  /** P142 (2026-05-22): 출국 공항. 빈 문자열 = arrivalTerminal 폴백 (UI 에서 chip
   *  "같은 공항 / Same as arrival" 표시). 사용자가 명시적으로 다른 공항 선택 가능. */
  departureTerminal: string;
  setDepartureTerminal: (v: string) => void;
  hotelAddress: string;
  setHotelAddress: (v: string) => void;
  arrivalTime: string;
  setArrivalTime: (v: string) => void;
  departureTime: string;
  setDepartureTime: (v: string) => void;
  /** P239 (2026-05-27): 투어 시작 시간 — 새벽 도착 시 호텔 transit 만 / 다음 stops 는
   *  tourStartTime 부터. arrival_time 무관하게 Day1 stops 시작 시각을 고정.
   *  default '09:00'. 운영자 의도: 새벽 01:30 도착해도 호텔만 가고 09:00 부터 투어 시작.
   *  root cause level 해결: P159 새벽 stops / P136 RouteAgent 24h wrap / B-13 false positive. */
  tourStartTime: string;
  setTourStartTime: (v: string) => void;
  /** #tour-end (2026-06-05): 투어 종료 시각 cap. default '21:00'. 모든 day 의 관광 stop 을
   *  이 시각 이후 trim → 사용자가 원하는 시간에 일정 종료 (호텔 복귀·휴식). */
  tourEndTime: string;
  setTourEndTime: (v: string) => void;
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
  // UIUX P3 (2026-07-13, 운영자 승인): 동행 유형 — 선택형(강제 X), 재탭 시 해제.
  companions: '' | 'solo' | 'couple' | 'family' | 'friends';
  setCompanions: (v: '' | 'solo' | 'couple' | 'family' | 'friends') => void;
  // Sprint 2 #5: recommended zone (when hotel undecided) + city key for picker scoping.
  // 2026-05-10 다도시 plan UX fix: cityKeys (모든 selected cities). zone 선택 시 cityKey
  // 도 같이 받아 부모가 mainCity auto-swap. mainCityKey 는 cityKeys[0] 로 대체됨.
  // 2026-05-11 (B-2 fix): recommendedZone: string → recommendedZones: Record<city,zone>.
  // 다도시 plan 에서 두 도시 zone 동시 선택 가능. onPickZone 시그니처도 (cityKey, zoneKey).
  recommendedZones: Record<string, string>;
  cityKeys: string[];
  onPickZone: (cityKey: string, zoneKey: string) => void;
  // 2026-05-10 B10-1/B10-2: 다도시 입국 도시 명시 + 도시별 호텔 input.
  isMultiCity: boolean;
  mainCityKey: string;
  onEntryCityChange: (cityKey: string) => void;
  hotelByCity: Record<string, string>;
  setHotelByCity: (v: Record<string, string>) => void;
  canGoStep3: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** P0 dedup: Step0(Reservation)에서 항공편을 이미 입력했으면 입력칸 대신
   *  칩으로 보여주고 이 콜백으로 Step0으로 점프해 수정하게 함.
   *  미지정 시 기존 동작 유지 (입력칸 항상 노출). */
  onEditStep0?: () => void;
  /** 2026-05-03 fix: Step 3에서 공항을 직접 편집 중이면 "from Step 1" chip으로
   *  swap하면 안 됨 (한 글자 칠 때마다 input이 chip으로 바뀌어 입력 불가 + Edit
   *  버튼이 Step 0으로 보내버리는 버그). reservationStatus + 사용자가 Step 3에서
   *  실제로 만진 적 있는지 (touched) 두 가지를 합쳐서 판정.
   *  2026-05-07: 4 옵션 복구 — 'nothing' | 'flight' | 'flight_hotel' | 'all_done'. */
  reservationStatus?: 'nothing' | 'flight' | 'flight_hotel' | 'all_done' | null;
  airportTouchedInStep3: boolean;
  setAirportTouchedInStep3: (v: boolean) => void;
  /** P161 (2026-05-23): 입국/출국 cycle 마킹 UI 가 2페이지 (Destinations) 에서 4페이지로
   *  이전. 도시 chips 더블클릭 cycle (선택 → 입국 → 출국 → 해제) + route 표시 통합. */
  allCities: string[];
  selectedCityKeys: string[];
  arrivalCityKey: string;
  departureCityKey: string;
  setArrivalCityKey: (v: string) => void;
  setDepartureCityKey: (v: string) => void;
}

export type TourPace = 'half' | 'short' | 'full' | 'action';
const TOUR_PACE_KEYS: TourPace[] = ['half', 'short', 'full', 'action'];
// Authoritative hours mapping lives in api/_food_helper.js (_PACE_HOURS).
// UI shows hours via the sub-label fallback below.
// 2026-04-28: zone-aware 설명 추가. 사용자 신고: "하루에 3군데씩 서울구를 옮겨다니면 너무 힘들다".
// Backend pace 매핑: half/short → relaxed (단일 zone), full → standard (2 zones), action → packed (free).
const TOUR_PACE_FALLBACK: Record<TourPace, { label: string; sub: string }> = {
  half:   { label: 'Half-day',    sub: '4h · 1-2 stops · 한 동네 집중' },
  short:  { label: 'Short tour',  sub: '6h · 3-4 stops · 한 구역 위주' },
  full:   { label: 'Full day',    sub: '8h · 5-6 stops · 인접 2구역 (표준)' },
  action: { label: 'Action-pack', sub: '10h+ · 7+ stops · 자유 이동' },
};

function LuggageCounter({ label, sub, value, setValue, maxReached }: { label: string; sub: string; value: number; setValue: (v: number) => void; maxReached?: boolean }) {
  const { t } = useLanguage();
  const plusDisabled = maxReached && value > 0 ? true : maxReached;
  return (
    <div className="flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
      <div>
        <p className="text-[13px] font-semibold text-white">{label}</p>
        <p className="text-[10px] text-white/55">{sub}</p>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setValue(Math.max(0, value - 1))}
          className="w-11 h-11 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/60 disabled:opacity-30"
          disabled={value === 0} aria-label={t.a11y?.decrease || 'Decrease'}>
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="w-6 text-center text-sm font-bold text-white">{value}</span>
        <button type="button" onClick={() => setValue(value + 1)}
          className="w-11 h-11 rounded-full bg-[#7C5CFC]/30 hover:bg-[#7C5CFC]/50 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={plusDisabled} aria-label={t.a11y?.increase || 'Increase'}>
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
    arrivalTerminal, setArrivalTerminal,
    departureTerminal, setDepartureTerminal,
    hotelAddress, setHotelAddress,
    arrivalTime, setArrivalTime, departureTime, setDepartureTime,
    tourStartTime, setTourStartTime,
    tourEndTime, setTourEndTime,
    luggageSmall, setLuggageSmall, luggageMedium, setLuggageMedium, luggageLarge, setLuggageLarge,
    wantAccom, setWantAccom, accomBudget, setAccomBudget,
    tourPace, setTourPace, companions, setCompanions,
    recommendedZones, cityKeys, onPickZone,
    isMultiCity, mainCityKey, onEntryCityChange, hotelByCity, setHotelByCity,
    canGoStep3, onPrev, onNext, onEditStep0,
    reservationStatus,
    airportTouchedInStep3, setAirportTouchedInStep3,
    allCities, selectedCityKeys,
    arrivalCityKey, departureCityKey, setArrivalCityKey, setDepartureCityKey,
  } = props;
  const { language } = useLanguage();
  const lang = (language as 'ko' | 'en' | 'ja' | 'zh') || 'en';

  // 2026-05-03 fix (사용자 신고): Step 3에서 공항 직접 입력하면 한 글자 칠
  // 때마다 input이 "from Step 1" chip으로 swap → 입력 끊김 + Edit 버튼이 Step 0으로
  // 점프시켜 사용자가 "지우면 뒤로 가져" 라고 신고. 진짜로 Step 0에서 입력한
  // 경우(=reservationStatus가 flight + 사용자가 Step 3에서 만진 적 없음)에만
  // chip 모드로 표시.
  // 2026-05-05: 호텔 chip 분기 제거 — Step 0에서 호텔을 묻지 않으므로 항상 input 노출.
  // 2026-05-21 (P134 분기 #22 fix): flight_hotel 도 chip 분기 발동. 이전엔 'flight' only →
  // flight_hotel 사용자는 Step0 에서 항공편 입력했어도 Step3 에서 input 재노출 (P0 dedup 의도 위반).
  const flightInfoFromStep0 =
    !!onEditStep0
    && (reservationStatus === 'flight' || reservationStatus === 'flight_hotel')
    && !!arrivalTerminal
    && !airportTouchedInStep3;

  // 수화물 합계 — B9-32 (2026-05-09): cap 의미 분리. 차터 wizard PR #321 패턴과 동일.
  //   luggageHardCap (>=99) — 사실상 무제한 (실질 입력 차단 안 닿음).
  //   luggageOver7 (>=8) — amber 정보성 안내 트리거 (입력 차단 X). 큰 짐 많은 6명 가족
  //   같은 사용자가 8개 이상 적어도 막히지 않도록. 8+ 시 차량 N대 (스타리아 추천) 안내.
  //   B-5/B-8 (2026-05-10 prod 검증): 1-7개=1대, 8+=2대, 14+=3대, +6/대 선형 룰.
  //   "봉고차" 라벨 금지 (외국인 픽업 부적절) → "스타리아 N대" 사용.
  const luggageTotal = luggageSmall + luggageMedium + luggageLarge;
  const luggageHardCap = luggageTotal >= 99;
  const vehicleCount = calcVehicleCount(luggageTotal);
  const luggageOver7 = vehicleCount >= 2; // 8개 이상 → 2대 이상 권장 시 amber 노출

  // 입력 가드: 사용자가 Next를 눌러야 오류 표시
  const [showErrors, setShowErrors] = useState(false);
  const dateOk = !!(dateRange?.from && dateRange?.to);
  const airportOk = !!arrivalTerminal || flightInfoFromStep0;

  function handleNext() {
    if (!canGoStep3) {
      setShowErrors(true);
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] sm:text-lg font-bold text-white mb-1">{p.planner_step2_date || 'Travel Details'}</h2>
        <p className="text-[13px] sm:text-sm text-white/55">{p.wizardDetailsSub || "When, who, and how you're arriving"}</p>
      </div>

      {/* Range Calendar */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.wizardWhenVisit || 'When are you visiting?'}</p>
        {showErrors && !dateOk && (
          <p className="text-[11px] text-red-400 mb-2">{(p as Record<string, string>).wizardFillRequired || 'Please select travel dates'}</p>
        )}
        <div className={`cocotrip-calendar-wrap bg-white/[0.04] border rounded-2xl p-3 sm:p-4 ${showErrors && !dateOk ? 'border-red-400/60' : 'border-white/[0.1]'}`}>
          <DayPicker
            mode="range"
            selected={dateRange}
            onSelect={setDateRange}
            locale={calendarLocale}
            numberOfMonths={isMobile ? 1 : 2}
            disabled={(d) => {
              // AI 플래너 정책: 오늘 시작 불가 (day1 = today 차단).
              // 내일 이후만 선택 가능. 서버와 정책 일치.
              const todayMidnight = new Date();
              todayMidnight.setHours(0, 0, 0, 0);
              const tomorrow = new Date(todayMidnight);
              tomorrow.setDate(todayMidnight.getDate() + 1);
              return d < tomorrow;
            }}
            showOutsideDays={false}
            classNames={{
              root: 'cocotrip-rdp',
            }}
          />
        </div>
        {nights > 0 && (
          <>
            <p className="text-sm text-[#7C5CFC] font-semibold mt-2">
              {(p.wizardNightsTrip || '{n} nights, {m} days trip').replace('{n}', String(nights)).replace('{m}', String(nights + 1))}
            </p>
            {/* P163 (2026-05-23): 일수별 생성 시간 동적 표시 + 7일 초과 권장 */}
            {(() => {
              const days = nights + 1;
              // 시뮬레이션 기준 (3일 90~180s / 5일 200~260s / 7일 230~290s / 10일 cap)
              const etaMin = days <= 2 ? '1~2' : days <= 3 ? '2~3' : days <= 5 ? '3~4' : days <= 7 ? '4~5' : '5';
              const etaTxt = lang === 'ko' ? `⏱ AI 플랜 생성 예상 시간: 약 ${etaMin}분`
                            : lang === 'ja' ? `⏱ AIプラン生成所要時間: 約 ${etaMin}分`
                            : lang === 'zh' ? `⏱ AI规划生成预计时间: 约 ${etaMin}分钟`
                            : `⏱ Estimated plan generation: ~${etaMin} min`;
              const overTxt = lang === 'ko' ? `💡 7일 이상은 안정적인 생성을 위해 여러 번 나눠서 만드시는 걸 권장드려요`
                            : lang === 'ja' ? `💡 7日以上は安定した生成のため複数回に分けて作成することをおすすめします`
                            : lang === 'zh' ? `💡 建议7天以上的行程分多次创建以确保稳定生成`
                            : `💡 For trips longer than 7 days, we recommend splitting into multiple plans for reliable generation`;
              return (
                <>
                  <p className="text-[12px] text-white/70 mt-1">{etaTxt}</p>
                  {days > 7 && (
                    <p className="text-[12px] text-amber-300 mt-1 leading-snug">{overTxt}</p>
                  )}
                </>
              );
            })()}
          </>
        )}
        {/* AI 플래너: 내일 이후만 가능 안내 (달력 아래 항상 노출) */}
        <p className="text-[11px] text-white/45 mt-1.5 px-1">
          {lang === 'ko' ? '📅 AI 플래너는 내일 이후 출발만 예약 가능합니다.' :
           lang === 'ja' ? '📅 AIプランナーは明日以降の出発のみ予約可能です。' :
           lang === 'zh' ? '📅 AI规划师仅支持明天以后出发的行程。' :
           '📅 AI Planner only accepts trips starting tomorrow or later.'}
        </p>
      </div>

      {/* Travelers */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.planner_step2_adults || 'How many travelers?'}</p>
        <input type="number" value={paxInput} onChange={e => setPaxInput(e.target.value)} min={1} max={50}
          className="w-full bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]" />
      </div>

      {/* UIUX P3 (2026-07-13): 동행 유형 — 선택형(강제 X), 재탭 해제. AI 플랜 소프트 힌트(travel_party). */}
      <div>
        <p className="text-sm text-white/50 mb-2.5 font-medium">{p.companionsLabel || 'Who are you traveling with? (optional)'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { key: 'solo' as const,    fb: 'Solo' },
            { key: 'couple' as const,  fb: 'Couple' },
            { key: 'family' as const,  fb: 'Family' },
            { key: 'friends' as const, fb: 'Friends' },
          ]).map(({ key, fb }) => {
            const cap = key.charAt(0).toUpperCase() + key.slice(1);
            const label = (p[`companions${cap}` as keyof typeof p] as string) || fb;
            const sel = companions === key;
            return (
              <button key={key} type="button" onClick={() => setCompanions(sel ? '' : key)}
                className={`px-3 py-2.5 rounded-xl border text-left transition-all ${
                  sel
                    ? (isMobile
                        ? 'bg-[#B668FC]/20 border-[#B668FC]/55 text-white'
                        : 'bg-[#7C5CFC]/20 border-[#7C5CFC]/55 text-white')
                    : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
                }`}>
                <span className="text-[13px] font-bold leading-tight">{label}</span>
              </button>
            );
          })}
        </div>
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

      {/* P161 (2026-05-23): 다도시 plan 의 입국/출국 cycle UI (2페이지에서 이전).
          기존 single-select radio toggle → cycle chip 으로 교체. 사용자 신고 Screenshot 2:
          도시 chip 한 번 더 누르면 입국 → 출국 순으로 마킹 (출국 지정 시 다른 도시 자동 입국).
          arrival 도시 = mainCity (entry hub) — onEntryCityChange 로 mainCity ↔ extraCities swap.
          단도시 시 미노출 (mainCity = entry 자동). */}
      {isMultiCity && (
        <div className="rounded-xl border border-[#7C5CFC]/25 bg-[#7C5CFC]/[0.05] p-3.5">
          <p className="text-[13px] font-semibold text-white mb-1">
            {p.entryCityTitle || 'Which city are you arriving in?'}
          </p>
          <p className="text-[11px] text-white/55 mb-2.5 leading-snug flex items-center gap-1.5">
            <PlaneLanding className="w-3 h-3 text-sky-400 shrink-0" />
            <span>{p.wizardArrivalDepartureHint || '도시를 한 번 더 누르면 입국 → 출국 순으로 지정됩니다 (출국 지정 시 다른 도시 자동 입국)'}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {cityKeys.map(ck => {
              const meta = CITY_NAME_BY_KEY[ck];
              const cityName = meta ? (meta[lang] || meta.en) : ck;
              const cityIcon = meta?.icon || '📍';
              const isArr = arrivalCityKey === ck;
              const isDep = departureCityKey === ck;
              const isMain = ck === mainCityKey;
              return (
                <button
                  key={ck}
                  type="button"
                  onClick={() => {
                    // P161 cycle (4페이지 통합): none → arrival → departure → none.
                    // arrival 지정 시 mainCity swap (entry hub = arrival city 동기화).
                    if (!isArr && !isDep) {
                      // role 없음 → arrival 채움 (이미 다른 도시 arrival 이면 이 도시 departure)
                      if (!arrivalCityKey) {
                        setArrivalCityKey(ck);
                        if (!isMain) onEntryCityChange(ck);
                      } else if (!departureCityKey) {
                        setDepartureCityKey(ck);
                      } else {
                        // 둘 다 점유 중 → 기존 departure 해제 + 이 도시 departure
                        setDepartureCityKey(ck);
                      }
                    } else if (isArr) {
                      // arrival → departure (다른 selected city 자동 arrival 승계)
                      setArrivalCityKey('');
                      setDepartureCityKey(ck);
                      const others = selectedCityKeys.filter((k) => k !== ck && k !== departureCityKey);
                      if (others.length > 0) {
                        setArrivalCityKey(others[0]);
                        if (others[0] !== mainCityKey) onEntryCityChange(others[0]);
                      }
                    } else if (isDep) {
                      // departure → 해제 (cycle 닫기)
                      setDepartureCityKey('');
                    }
                  }}
                  aria-pressed={isArr || isDep}
                  className={`px-3 py-2 rounded-lg border text-sm transition-all flex items-center gap-1.5 ${
                    isArr
                      ? 'bg-sky-500/20 border-sky-500/55 text-white font-semibold'
                      : isDep
                        ? 'bg-fuchsia-500/20 border-fuchsia-500/55 text-white font-semibold'
                        : 'bg-white/[0.04] border-white/[0.10] text-white/65 hover:border-white/20'
                  }`}
                >
                  <span>{cityIcon}</span>
                  <span>{cityName}</span>
                  {isArr && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-300 ml-0.5">
                      <PlaneLanding className="w-3 h-3" /> {p.wizardArrivalBadge || '입국'}
                    </span>
                  )}
                  {isDep && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-fuchsia-300 ml-0.5">
                      <PlaneTakeoff className="w-3 h-3" /> {p.wizardDepartureBadge || '출국'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* P161: 경로 표시 — 2페이지에서 이전 */}
          {allCities.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="text-xs text-white/55">{p.wizardRoute || 'Route'}:</span>
              {allCities.map((c, i) => (
                <span key={c} className="text-xs text-white/50">
                  {i > 0 && <span className="text-white/55 mx-1">-&gt;</span>}{c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Airport Dropdown — Step0에서 이미 입력한 경우 칩으로 대체 (P0 dedup) */}
      {flightInfoFromStep0 ? (
        <button
          type="button"
          onClick={onEditStep0}
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
          {showErrors && !airportOk && (
            <p className="text-[11px] text-red-400 mb-2">{(p as Record<string, string>).wizardFillRequired || 'Please select an airport'}</p>
          )}
          <MobileSelectDrawer
            value={arrivalTerminal}
            onChange={(v) => { setArrivalTerminal(v); setAirportTouchedInStep3(true); }}
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

      {/* P142 (2026-05-22): 출국 공항 — 입국지와 다를 수 있어 (T1 입국 → T2 출국,
          또는 ICN 입국 → GMP/PUS 출국) 별도 dropdown. 빈 값 = 입국 공항과 동일
          (단도시 plan 절대다수 케이스). arrivalTerminal 이 'ALREADY'(이미 한국 체류)
          여도 출국 공항은 필요하므로 노출.
          이전 회귀: const departureAirport = arrivalTerminal; 하드코딩으로 입국=출국 강제. */}
      {arrivalTerminal && (
        <div>
          <p className="text-sm text-white/50 mb-2.5 font-medium">
            {(p as Record<string, string>).wizardWhichDepartureAirport || 'Which airport are you departing from?'}
          </p>
          <MobileSelectDrawer
            value={departureTerminal}
            onChange={(v) => setDepartureTerminal(v)}
            title={(p as Record<string, string>).wizardWhichDepartureAirport || 'Departure airport'}
            placeholder={(p as Record<string, string>).wizardDepartureSameAsArrival || 'Same as arrival airport'}
            options={getDepartureAirportOptions(isMultiCity ? cityKeys : [mainCityKey || 'seoul']).map(opt => ({
              value: opt.value,
              label: opt.label,
            }))}
            icon={<Plane className="w-4 h-4 text-white/55" />}
          />
          {departureTerminal && departureTerminal !== arrivalTerminal && (
            <p className="text-[11px] text-[#C99FFF] mt-1.5 font-medium">
              {(p as Record<string, string>).wizardDepartureDifferentNote || 'Different from arrival — backend will plan accordingly'}
            </p>
          )}
        </div>
      )}

      {/* Hotel — P1: AI 추천 토글 시 주소 입력칸 자동 숨김 (mutual exclusion).
          2026-05-05: free-claim funnel 제거 — Step 0의 호텔 chip 분기 삭제, 호텔 입력은 항상 이 step에서.
          2026-05-10 B10-2: 다도시 plan 시 도시별 hotel input 분리 (hotelByCity Record).
          단도시는 기존 hotelAddress 단일 input (regression 0). */}
      {!wantAccom ? (
        isMultiCity ? (
          /* 다도시 — 도시별 호텔 카드 list */
          <div>
            <p className="text-sm text-white/50 mb-1 font-medium">
              {p.multicityHotelTitle || 'Hotels by city'}
              <span className="text-[#7C5CFC]/80 ml-1 text-[11px]">{p.hotelAccuracyHint || '(precise address = step-by-step transit guide)'}</span>
            </p>
            <p className="text-[11px] text-white/45 mb-3">
              {p.multicityHotelHint || 'Enter the hotel for each city (optional)'}
            </p>
            <div className="space-y-3">
              {cityKeys.map(ck => {
                const meta = CITY_NAME_BY_KEY[ck];
                const cityName = meta ? (meta[lang] || meta.en) : ck;
                const cityIcon = meta?.icon || '📍';
                const value = hotelByCity[ck] || '';
                const labelTpl = p.multicityHotelLabel || '{city} hotel';
                return (
                  <div key={ck}>
                    <label className="text-[12px] text-white/65 mb-1.5 flex items-center gap-1.5 font-medium">
                      <span>{cityIcon}</span>
                      <span>{labelTpl.replace('{city}', cityName)}</span>
                      {ck === mainCityKey && (
                        <span className="text-[10px] text-[#B668FC] bg-[#7C5CFC]/15 px-1.5 py-0.5 rounded ml-1">
                          {p.entryCityTitle ? '🛬' : '🛬'}
                        </span>
                      )}
                    </label>
                    <HotelSuggestInput
                      value={value}
                      onChange={(v) => setHotelByCity({ ...hotelByCity, [ck]: v })}
                      placeholder={p.hotel_placeholder || 'e.g. Lotte Hotel Myeongdong...'}
                      lang={lang}
                      className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors" />
                  </div>
                );
              })}
            </div>
            {/* 다도시 ZoneRecommender — 모든 도시 호텔 비어있을 때만 노출.
                한 도시라도 입력하면 자동 collapse. */}
            {Object.values(hotelByCity).every(v => !(v && v.trim())) && (
              <Suspense fallback={
                <div className="mt-3 rounded-xl border border-[#7C5CFC]/15 bg-[#7C5CFC]/[0.02] p-3">
                  <div className="h-3 w-32 rounded bg-white/[0.06] animate-pulse mb-2" />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[0,1,2,3,4,5].map(i => (
                      <div key={i} className="h-20 rounded-lg bg-white/[0.04] animate-pulse" />
                    ))}
                  </div>
                </div>
              }>
                <ZoneRecommender
                  language={lang}
                  isMobile={isMobile}
                  cityKeys={cityKeys}
                  hotelAddress=""
                  recommendedZones={recommendedZones}
                  onPickZone={onPickZone}
                  labelTitle={p.zoneRecommendTitle}
                  labelSubtitle={p.zoneRecommendSubtitle}
                  labelPick={p.zoneRecommendPicked}
                  labelHotelCta={p.zoneHotelCta}
                  labelHotelSponsored={p.zoneHotelSponsored}
                  labelGroupHeader={p.zoneRecommendGroupHeader}
                />
              </Suspense>
            )}
          </div>
        ) : (
          /* 단도시 — 기존 단일 input + ZoneRecommender (regression 0) */
          <div>
            <p className="text-sm text-white/50 mb-2.5 font-medium">
              {p.hotel_address_title || 'Where are you staying?'}
              <span className="text-[#7C5CFC]/80 ml-1 text-[11px]">{p.hotelAccuracyHint || '(precise address = step-by-step transit guide)'}</span>
            </p>
            <HotelSuggestInput value={hotelAddress}
              onChange={(v) => setHotelAddress(v)}
              placeholder={p.hotel_placeholder || 'e.g. Lotte Hotel Myeongdong...'}
              lang={lang}
              className="w-full bg-white/[0.06] border border-white/[0.12] text-white placeholder-white/25 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors" />
            {hotelAddress.trim().length === 0 && (
              <Suspense fallback={
                <div className="mt-3 rounded-xl border border-[#7C5CFC]/15 bg-[#7C5CFC]/[0.02] p-3">
                  <div className="h-3 w-32 rounded bg-white/[0.06] animate-pulse mb-2" />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[0,1,2,3,4,5].map(i => (
                      <div key={i} className="h-20 rounded-lg bg-white/[0.04] animate-pulse" />
                    ))}
                  </div>
                </div>
              }>
                <ZoneRecommender
                  language={lang}
                  isMobile={isMobile}
                  cityKeys={cityKeys}
                  hotelAddress={hotelAddress}
                  recommendedZones={recommendedZones}
                  onPickZone={onPickZone}
                  labelTitle={p.zoneRecommendTitle}
                  labelSubtitle={p.zoneRecommendSubtitle}
                  labelPick={p.zoneRecommendPicked}
                  labelHotelCta={p.zoneHotelCta}
                  labelHotelSponsored={p.zoneHotelSponsored}
                  labelGroupHeader={p.zoneRecommendGroupHeader}
                />
              </Suspense>
            )}
          </div>
        )
      ) : null}

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

      {/* P239 (2026-05-27): 투어 시작 시간 — 운영자 의도 박제.
          "새벽 도착해도 호텔까지 경로만 알려주고 투어 시작시간을 정하면 거기에만 맞춰 작성"
          arrival_time 무관하게 Day1 stops 시작 시각을 고정. default 09:00.
          root cause level 해결: P159 새벽 stops / P136 RouteAgent 24h wrap / B-13 false positive.
          UI 비유: "🌅 투어 시작 시간 09:00" — 호텔 체크인은 따로, 투어는 09:00 부터. */}
      <div className="rounded-xl border border-[#7C5CFC]/25 bg-[#7C5CFC]/[0.04] p-3.5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-semibold text-white">
            <span className="mr-1.5">🌅</span>
            {(p as Record<string, string>).tourStartTimeLabel || 'Tour start time'}
          </p>
          <input
            type="time"
            value={tourStartTime || '09:00'}
            onChange={e => setTourStartTime(e.target.value)}
            min="04:00"
            max="14:00"
            className="bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]"
            aria-label={(p as Record<string, string>).tourStartTimeLabel || 'Tour start time'}
          />
        </div>
        {/* #tour-end (2026-06-05): 투어 종료 시각 — 매일 관광 일정을 이 시각 이후 종료 (호텔 복귀·휴식). */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-semibold text-white">
            <span className="mr-1.5">🌆</span>
            {(p as Record<string, string>).tourEndTimeLabel || 'Tour end time'}
          </p>
          <input
            type="time"
            value={tourEndTime || '21:00'}
            onChange={e => setTourEndTime(e.target.value)}
            min="15:00"
            max="23:59"
            className="bg-white/[0.06] border border-white/[0.12] text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#7C5CFC]/70 transition-colors [color-scheme:dark]"
            aria-label={(p as Record<string, string>).tourEndTimeLabel || 'Tour end time'}
          />
        </div>
        <p className="text-[11px] text-white/55 leading-snug">
          {(p as Record<string, string>).tourStartTimeHint
            || 'Late-night arrival? Just rest at the hotel — your tour starts at this time.'}
        </p>
        {/* validation hint: tourStartTime 가 arrival_time 이전 또는 departure_time 이후일 때 amber */}
        {tourStartTime && arrivalTime && tourStartTime <= arrivalTime && (
          <p className="text-[11px] text-amber-300/80 mt-1.5">
            {(p as Record<string, string>).tourStartTimeAfterArrival
              || 'Tour start time should be after your arrival time.'}
          </p>
        )}
        {tourStartTime && departureTime && tourStartTime >= departureTime && (
          <p className="text-[11px] text-amber-300/80 mt-1.5">
            {(p as Record<string, string>).tourStartTimeBeforeDeparture
              || 'Tour start time should be before your departure time.'}
          </p>
        )}
        {/* #tour-end validation: 종료 시각이 시작 시각보다 빠르거나 같으면 amber */}
        {tourStartTime && tourEndTime && tourEndTime <= tourStartTime && (
          <p className="text-[11px] text-amber-300/80 mt-1.5">
            {(p as Record<string, string>).tourEndTimeAfterStart
              || 'Tour end time should be after the start time.'}
          </p>
        )}
      </div>

      {/* Luggage counters — heavy bags trigger taxi recommendation in arrival_guide.
          합계 7개 제한: Carry-on + Medium + Large ≤ 7 */}
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
            value={luggageSmall} setValue={setLuggageSmall}
            maxReached={luggageHardCap} />
          <LuggageCounter
            label={p.luggageMedium || 'Medium suitcase'}
            sub={p.luggageMediumSub || '24 inch'}
            value={luggageMedium} setValue={setLuggageMedium}
            maxReached={luggageHardCap} />
          <LuggageCounter
            label={p.luggageLarge || 'Large suitcase'}
            sub={p.luggageLargeSub || '28 inch+'}
            value={luggageLarge} setValue={setLuggageLarge}
            maxReached={luggageHardCap} />
        </div>
        {/* B9-32 (2026-05-09) + B-5/B-8 (2026-05-10 prod 검증):
            8+ 시 amber 안내. 입력 차단 아닌 정보성 — 차량 N대 (스타리아) 권장.
            "봉고차" 라벨 금지 (외국인 픽업 부적절). 룰: 1-7=1대, 8+=2대, 14+=3대, +6/대. */}
        {luggageOver7 && (
          <p className="text-[11px] text-amber-300/80 mt-2 text-center">
            {(() => {
              const tmpl = (p as Record<string, string>).luggageVehicleNote
                || '{{count}} suitcases — {{vehicles}} vehicles recommended (Staria)';
              return tmpl
                .replace(/\{\{count\}\}/g, String(luggageTotal))
                .replace(/\{\{vehicles\}\}/g, String(vehicleCount));
            })()}
          </p>
        )}
      </div>

      {/* Accommodation Recommendation Opt-in.
          2026-05-05: Step 0에서 호텔을 안 묻는 단순화로 전환 — chip 분기 제거되어 항상 노출. */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={wantAccom} onChange={e => {
            const next = e.target.checked;
            setWantAccom(next);
            // P1 mutual exclusion: AI 추천 켜면 사용자 입력 호텔 주소 클리어 (혼란 방지)
            if (next && hotelAddress) setHotelAddress('');
            // 2026-05-21 (분기 #23 fix, R-P133 d): wantAccom 켜면 다도시 hotelByCity Record 도
            // 클리어. 누락 시 stale Record 가 backend forward → AI 가 사용자 입력 호텔로 오해.
            if (next && Object.keys(hotelByCity).length > 0) setHotelByCity({});
          }}
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
        onNext={handleNext}
        prevLabel={p.planner_prev || 'Back'}
        nextLabel={p.wizardNextGenerate || 'Next: Generate'}
        isMobile={isMobile}
      />
    </div>
  );
}
