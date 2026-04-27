// useQuoteCalculator — pricing_spec.json SSOT 기반 실시간 견적 훅
// CharterWizard의 Step 6 최종 견적에서 호출. 메모이제이션으로 리렌더 최소화.
import { useMemo } from 'react';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
  VEHICLE_TYPES,
  EXTRA_CHARGES,
  KPOP_SHUTTLE,
  DISTANCE_MATRIX,
  SERVICE_CONFIG,
  ATTRACTION_FEES,
} from '@/data/charterPricing';
import type { WizardState, QuoteBreakdown, QuoteAddon, VehicleType } from '@/components/charter/types';
import {
  normalizeDestinationToMatrixKey,
  getMatrixKeyAlternatives,
  getZoneForInput,
  getZoneForMatrixKey,
  ZONE_DEFAULTS,
} from '@/components/charter/destinationKeyMap';

// 차종별 배수 (스타리아 = 1.0 기준)
const VEHICLE_MULTIPLIER: Record<VehicleType, number> = {
  staria: 1.0,
  sprinter: 1.45,
  bus: 2.3,
};

// pricing_spec.json의 staria.intercity 값과 동기화 (rate_per_km: 1000)
const STARIA_BASE_FEE = 50_000;
const STARIA_RATE_PER_KM = 1000;

// 권역 fallback이 적용되는 출발지 (서울/인천/김포 출발 기준)
const ZONE_FALLBACK_ORIGINS = new Set(['SEL_METRO', 'ICN', 'GMP']);

function matrixLookup(origin: string, destination: string): { km?: number; hours?: number; priceKRW?: number } | null {
  // METRO ↔ city 키 fallback — 부산/BUS_METRO 같은 동의 키 자동 시도
  const candidates = getMatrixKeyAlternatives(destination);
  for (const dest of candidates) {
    const key = `${origin}→${dest}`;
    const entry = (DISTANCE_MATRIX as unknown as Record<string, unknown>)[key];
    if (entry && typeof entry === 'object') {
      return entry as { km?: number; hours?: number; priceKRW?: number };
    }
  }
  return null;
}

// 매트릭스 미존재 + 출발지 SEL/ICN/GMP일 때 권역 평균 km로 fallback
function zoneLookup(origin: string, input: string | undefined): { km: number; hours: number } | null {
  if (!input) return null;
  if (!ZONE_FALLBACK_ORIGINS.has(origin)) return null;
  const zone = getZoneForInput(input);
  if (!zone) return null;
  if (zone === 'jeju') return null; // 제주는 multi_day local 전용 — 별도 분기
  const z = ZONE_DEFAULTS[zone];
  if (z.km === 0) return null;
  return { km: z.km, hours: z.hours };
}

// destinationCustom (한글 자유입력) → 매트릭스 영문 키 매핑 시도
function tryResolveCustomDestination(state: WizardState): string | null {
  if (state.destinationKey) return state.destinationKey;
  if (!state.destinationCustom) return null;
  return normalizeDestinationToMatrixKey(state.destinationCustom);
}

// destinationKey가 매트릭스 키일 때만 zone 직접 반환, custom이면 입력 → zone
function getZoneForState(state: WizardState): string | null {
  if (state.destinationKey) return getZoneForMatrixKey(state.destinationKey);
  if (state.destinationCustom) return getZoneForInput(state.destinationCustom);
  return null;
}

function calcIntercityFormula(vehicle: VehicleType, km: number): number {
  // 공식: base_fee + (km × 2) × rate_per_km × vehicle_multiplier
  // pricing_spec.json staria.intercity 기준 (rate_per_km: 1000)
  const staria = STARIA_BASE_FEE + km * 2 * STARIA_RATE_PER_KM;
  return Math.round(staria * VEHICLE_MULTIPLIER[vehicle]);
}

function surchargeForNight(baseKRW: number, isNight: boolean): number {
  return isNight ? Math.round(baseKRW * (EXTRA_CHARGES.nightSurchargePercent / 100)) : 0;
}

// 순수 함수 — 테스트 가능. useQuoteCalculator는 이 함수를 useMemo로 감싼 래퍼.
export function calculateQuote(state: WizardState): QuoteBreakdown | null {
  const warnings: string[] = [];
  if (!state.service || !state.vehicle) return null;

    const mode = state.service;
    const vehicle = state.vehicle;
    const svcCfg = (SERVICE_CONFIG as Record<string, {
      show_meals: boolean;
      show_attractions: boolean;
      meals_count_default?: number;
      meal_per_person?: number;
    }>)[mode];

    const includes = ['fuel', 'tolls', 'parking', 'driver_gratuity'];
    const excludes = ['meals', 'attractions', 'drinks', 'shopping'];

    // destinationKey가 비어있고 destinationCustom만 있는 경우 KR→EN 매핑 시도
    // needsCustomQuote는 모드별 분기에서 zone fallback도 실패했을 때만 true.
    const resolvedDest = tryResolveCustomDestination(state);
    let needsCustomQuote = false;

    let vehicleChargeKRW = 0;
    let source: QuoteBreakdown['source'] = 'formula';
    let distanceKm: number | undefined;
    let durationHours: number | undefined;

    // ── 모드별 차량비 산출 ──
    if (mode === 'kpop_shuttle') {
      vehicleChargeKRW = KPOP_SHUTTLE.pricePerVehicle;
      source = 'package';
    } else if (mode === 'airport_transfer') {
      if (state.destinationKey && AIRPORT_TRANSFER_PRICES[state.destinationKey]) {
        vehicleChargeKRW = Math.round(AIRPORT_TRANSFER_PRICES[state.destinationKey].priceKRW * VEHICLE_MULTIPLIER[vehicle]);
        distanceKm = undefined;
        source = 'matrix';
      } else if (state.origin && resolvedDest) {
        const m = matrixLookup(state.origin, resolvedDest);
        if (m?.priceKRW) {
          vehicleChargeKRW = Math.round(m.priceKRW * VEHICLE_MULTIPLIER[vehicle]);
          distanceKm = m.km; durationHours = m.hours; source = 'matrix';
        } else if (m?.km) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, m.km);
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
        }
      }
      // resolvedDest 없거나 매트릭스 miss인 경우 — 권역 fallback 시도
      if (vehicleChargeKRW === 0 && state.origin && state.destinationCustom) {
        const zoneFallback = zoneLookup(state.origin, state.destinationCustom);
        if (zoneFallback) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, zoneFallback.km);
          distanceKm = zoneFallback.km; durationHours = zoneFallback.hours; source = 'formula';
          warnings.push('권역 평균 거리 기준 추정가 — 정확한 견적은 WhatsApp 문의');
        } else {
          needsCustomQuote = true;
        }
      }
    } else if (mode === 'day_tour') {
      if (state.destinationKey && DAILY_TOUR_PRICES[state.destinationKey]) {
        vehicleChargeKRW = Math.round(DAILY_TOUR_PRICES[state.destinationKey].priceKRW * VEHICLE_MULTIPLIER[vehicle]);
        source = 'package';
      } else if (state.origin && resolvedDest) {
        const m = matrixLookup(state.origin, resolvedDest);
        if (m?.km) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, m.km);
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
        } else {
          // 매트릭스 miss — 권역 fallback (제주 제외)
          const zoneFallback = zoneLookup(state.origin, state.destinationCustom);
          if (zoneFallback) {
            vehicleChargeKRW = calcIntercityFormula(vehicle, zoneFallback.km);
            distanceKm = zoneFallback.km; durationHours = zoneFallback.hours; source = 'formula';
            warnings.push('권역 평균 거리 기준 추정가');
          } else if (state.destinationCustom) {
            needsCustomQuote = true;
          }
        }
      } else if (state.destinationCustom) {
        // origin 없는데 custom 입력만 있으면 별도견적
        const zoneFallback = zoneLookup(state.origin ?? 'SEL_METRO', state.destinationCustom);
        if (zoneFallback) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, zoneFallback.km);
          distanceKm = zoneFallback.km; durationHours = zoneFallback.hours; source = 'formula';
          warnings.push('권역 평균 거리 기준 추정가');
        } else {
          needsCustomQuote = true;
        }
      }
    } else if (mode === 'multi_day') {
      // 1박2일 이상: 매트릭스 또는 권역 fallback 기반 + 일당 운영비 + 숙박비
      // endDate는 "돌아오는 날" (포함). 1박2일 = startDate~endDate diff 1일 = 2일 일정.
      const staria = VEHICLE_TYPES.staria as unknown as Record<string, unknown>;
      const daily = 200_000;
      const overnight = 130_000;
      const dayDiff = state.startDate && state.endDate
        ? Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000)
        : 0;
      const tourDays = Math.max(1, dayDiff + 1); // endDate 포함 → diff+1일
      const nights = Math.max(0, tourDays - 1);
      void staria;

      // 제주는 multi_day + lodgingLocation='local'만 허용 — 그 외 needsCustomQuote
      const dstZone = getZoneForState(state);
      if (dstZone === 'jeju' && state.lodgingLocation !== 'local') {
        needsCustomQuote = true;
        warnings.push('제주는 현지 숙박 투어만 진행 — 항공편 별도');
      } else if (state.origin && resolvedDest) {
        const m = matrixLookup(state.origin, resolvedDest);
        if (m?.km) {
          const intercity = calcIntercityFormula(vehicle, m.km);
          vehicleChargeKRW = intercity + daily * tourDays + overnight * nights;
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
        } else {
          const zoneFallback = zoneLookup(state.origin, state.destinationCustom);
          if (zoneFallback) {
            const intercity = calcIntercityFormula(vehicle, zoneFallback.km);
            vehicleChargeKRW = intercity + daily * tourDays + overnight * nights;
            distanceKm = zoneFallback.km; durationHours = zoneFallback.hours; source = 'formula';
            warnings.push('권역 평균 거리 기준 추정가');
          } else if (state.destinationCustom) {
            needsCustomQuote = true;
          }
        }
      } else if (state.destinationCustom) {
        const zoneFallback = zoneLookup(state.origin ?? 'SEL_METRO', state.destinationCustom);
        if (zoneFallback) {
          const intercity = calcIntercityFormula(vehicle, zoneFallback.km);
          vehicleChargeKRW = intercity + daily * tourDays + overnight * nights;
          distanceKm = zoneFallback.km; durationHours = zoneFallback.hours; source = 'formula';
          warnings.push('권역 평균 거리 기준 추정가');
        } else {
          needsCustomQuote = true;
        }
      }
    }

    if (vehicleChargeKRW === 0 && !needsCustomQuote) {
      warnings.push('견적을 산출하기에 입력이 부족합니다.');
    }

    // ── 추가 옵션 ──
    const addons: QuoteAddon[] = [];
    if (state.options?.licensedGuide) addons.push({ key: 'licensed_guide', label: '면허 가이드 (영/일/중)', amountKRW: EXTRA_CHARGES.englishGuidePerDay });
    if (state.options?.airportPicket) addons.push({ key: 'airport_picket', label: '공항 픽켓 서비스',         amountKRW: EXTRA_CHARGES.airportPicketService });
    if (state.options?.childSeat)     addons.push({ key: 'child_seat',     label: '카시트',                   amountKRW: EXTRA_CHARGES.childSeatPerTrip });

    // sprinter/bus는 가이드 필수료 자동 가산 (staria + licensedGuide 옵션과 별도)
    if (vehicle === 'sprinter' || vehicle === 'bus') {
      const v = VEHICLE_TYPES[vehicle] as unknown as { guideFeeDailyKRW?: number };
      const fee = v.guideFeeDailyKRW ?? 300_000;
      addons.push({ key: 'guide_required', label: `면허 가이드 동행 (${vehicle}, 법적 필수)`, amountKRW: fee });
    }

    const addonsSum = addons.reduce((s, a) => s + a.amountKRW, 0);

    // ── 야간 할증 ──
    const isNight = state.options?.night ?? false;
    const surchargeKRW = surchargeForNight(vehicleChargeKRW + addonsSum, isNight);
    const surchargePercent = isNight ? EXTRA_CHARGES.nightSurchargePercent : 0;

    // ── multi-day 할인 (-10% / 1박 이상) ──
    let multiDayDiscountKRW = 0;
    let multiDayDiscountPercent = 0;
    if (mode === 'multi_day') {
      const dayDiff = state.startDate && state.endDate
        ? Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000)
        : 0;
      // dayDiff >= 1 → 최소 1박 (예: 4/29 → 4/30 = 1박2일)
      if (dayDiff >= 1) {
        const pct = EXTRA_CHARGES.multiDayDiscountPercent ?? 10;
        multiDayDiscountPercent = pct;
        multiDayDiscountKRW = Math.round((vehicleChargeKRW + addonsSum + surchargeKRW) * (pct / 100));
      }
    }

    const subtotalKRW = vehicleChargeKRW + addonsSum + surchargeKRW - multiDayDiscountKRW;

    // VAT 정보 (현재는 표기만, subtotal에 가산하지 않음)
    const vatExcluded = (EXTRA_CHARGES as Record<string, unknown>).vatExcluded === true;
    const vatPercent = ((EXTRA_CHARGES as Record<string, unknown>).vatPercent as number) ?? 10;

    // ── 별도 고지 항목 ──
    const showMeals = svcCfg?.show_meals ?? false;
    const showAttractions = svcCfg?.show_attractions ?? false;
    const pax = state.paxCount ?? 1;
    const days = Math.max(1, state.startDate && state.endDate ?
      Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000) : 1);
    const mealPerMeal = svcCfg?.meal_per_person ?? 0;
    const mealsCount = svcCfg?.meals_count_default ?? 0;
    const estimatedMealsKRW = showMeals ? pax * mealPerMeal * mealsCount * days : 0;

    // attractions: 패키지/매트릭스에서 spots 있을 때만. MVP에선 0 처리.
    let estimatedAttractionsKRW = 0;
    if (showAttractions && state.destinationKey && DAILY_TOUR_PRICES[state.destinationKey]) {
      const spots = DAILY_TOUR_PRICES[state.destinationKey].spots ?? [];
      for (const spot of spots) {
        const fee = (ATTRACTION_FEES as unknown as Record<string, number>)[spot];
        if (typeof fee === 'number') estimatedAttractionsKRW += fee * pax;
      }
    }

  return {
    mode,
    source,
    vehicle,
    vehicleChargeKRW,
    addons,
    subtotalKRW,
    surchargeKRW,
    surchargePercent,
    multiDayDiscountKRW,
    multiDayDiscountPercent,
    vatExcluded,
    vatPercent,
    estimatedMealsKRW,
    estimatedAttractionsKRW,
    showMeals,
    showAttractions,
    includes,
    excludes,
    distanceKm,
    durationHours,
    warnings,
    needsCustomQuote,
  };
}

// React 훅 래퍼 — 메모이제이션으로 리렌더 최소화. CharterWizard 등 React 컴포넌트에서 사용.
export function useQuoteCalculator(state: WizardState): QuoteBreakdown | null {
  return useMemo(() => calculateQuote(state), [state]);
}
