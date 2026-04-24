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

// 차종별 배수 (스타리아 = 1.0 기준)
const VEHICLE_MULTIPLIER: Record<VehicleType, number> = {
  staria: 1.0,
  sprinter: 1.45,
  bus: 2.3,
};

function matrixLookup(origin: string, destination: string): { km?: number; hours?: number; priceKRW?: number } | null {
  const key = `${origin}→${destination}`;
  const entry = (DISTANCE_MATRIX as unknown as Record<string, unknown>)[key];
  if (!entry || typeof entry !== 'object') return null;
  return entry as { km?: number; hours?: number; priceKRW?: number };
}

function calcIntercityFormula(vehicle: VehicleType, km: number): number {
  // 공식: base_fee + (km × 2) × rate_per_km × vehicle_multiplier
  // pricing_spec.json의 staria.intercity 값 기준(=50,000 + 900*2) × 차종배수
  const staria = 50_000 + km * 2 * 900;
  return Math.round(staria * VEHICLE_MULTIPLIER[vehicle]);
}

function surchargeForNight(baseKRW: number, isNight: boolean): number {
  return isNight ? Math.round(baseKRW * (EXTRA_CHARGES.nightSurchargePercent / 100)) : 0;
}

export function useQuoteCalculator(state: WizardState): QuoteBreakdown | null {
  return useMemo(() => {
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
      } else if (state.origin && state.destinationKey) {
        const m = matrixLookup(state.origin, state.destinationKey);
        if (m?.priceKRW) {
          vehicleChargeKRW = Math.round(m.priceKRW * VEHICLE_MULTIPLIER[vehicle]);
          distanceKm = m.km; durationHours = m.hours; source = 'matrix';
        } else if (m?.km) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, m.km);
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
        } else {
          warnings.push('매트릭스에 없는 공항→목적지 조합 — 거리 미상');
        }
      }
    } else if (mode === 'day_tour') {
      if (state.destinationKey && DAILY_TOUR_PRICES[state.destinationKey]) {
        vehicleChargeKRW = Math.round(DAILY_TOUR_PRICES[state.destinationKey].priceKRW * VEHICLE_MULTIPLIER[vehicle]);
        source = 'package';
      } else if (state.origin && state.destinationKey) {
        const m = matrixLookup(state.origin, state.destinationKey);
        if (m?.km) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, m.km);
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
        }
      }
    } else if (mode === 'multi_day') {
      // 1박2일 이상: 매트릭스 기반, 일당 서비스 피 + 숙박 일수 × 드라이버 숙식비
      const staria = VEHICLE_TYPES.staria as unknown as Record<string, unknown>;
      const daily = 200_000;      // pricing_spec의 staria.intercity.daily_service_fee와 동기화 필요 (향후 리팩토링)
      const overnight = 130_000;
      const tourDays = Math.max(1, state.startDate && state.endDate ?
        Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000) : 1);
      const nights = Math.max(0, tourDays - 1);
      void staria;

      if (state.origin && state.destinationKey) {
        const m = matrixLookup(state.origin, state.destinationKey);
        if (m?.km) {
          const intercity = calcIntercityFormula(vehicle, m.km);
          vehicleChargeKRW = intercity + daily * tourDays + overnight * nights;
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
        }
      }
    }

    if (vehicleChargeKRW === 0) {
      warnings.push('견적을 산출하기에 입력이 부족합니다.');
    }

    // ── 추가 옵션 ──
    const addons: QuoteAddon[] = [];
    if (state.options?.englishGuide)  addons.push({ key: 'english_guide',  label: '영어 가이드',     amountKRW: EXTRA_CHARGES.englishGuidePerDay });
    if (state.options?.airportPicket) addons.push({ key: 'airport_picket', label: '공항 픽켓 서비스', amountKRW: EXTRA_CHARGES.airportPicketService });
    if (state.options?.childSeat)     addons.push({ key: 'child_seat',     label: '카시트',           amountKRW: EXTRA_CHARGES.childSeatPerTrip });

    // sprinter/bus는 가이드 필수료 자동 가산
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

    // ── 왕복 할인 (multi_day 왕복형 자동 적용) ──
    const roundTripDiscountKRW = 0;  // MVP: 할인 비활성. UI 플래그로 확장 예정.

    const subtotalKRW = vehicleChargeKRW + addonsSum + surchargeKRW - roundTripDiscountKRW;

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
      roundTripDiscountKRW,
      estimatedMealsKRW,
      estimatedAttractionsKRW,
      showMeals,
      showAttractions,
      includes,
      excludes,
      distanceKm,
      durationHours,
      warnings,
    };
  }, [state]);
}
