// useQuoteCalculator — pricing_spec.json SSOT 기반 실시간 견적 훅
// 정책 B (2026-05-07 사용자 확정):
//   1. spec.daily_tour_prices key 매칭 → 기존 가격
//   2. distance_matrix lookup → entry.priceKRW
//   3. matrix miss → Geocoding API → calcSimpleByVehicle (km × 차량별 단순 공식)
//   4. Geocoding 실패 → null (사용자 manual km 입력 toggle)
// zone fallback 폐기 — 충청권 평균 200km로 모든 도시 균일 가격이 비현실적.
//
// 옵션 C-FINAL (2026-05-12):
//   airport_transfer 자유입력 fallback 은 calcPickupTransferFormula (4-tier) 적용.
//   day_tour / multi_day 는 기존 calcIntercityFormula (왕복 × 차량 배수) 유지.
//
// async 처리 — Geocoding은 fetch이므로 useEffect + useState 패턴.
import { useEffect, useState } from 'react';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
  VEHICLE_TYPES,
  EXTRA_CHARGES,
  KPOP_SHUTTLE,
  DISTANCE_MATRIX,
  SERVICE_CONFIG,
  ATTRACTION_FEES,
  AIRPORT_TRANSFER_PRICING_FORMULA,
  VEHICLE_INTERCITY,
} from '@/data/charterPricing';
import type { WizardState, QuoteBreakdown, QuoteAddon, VehicleType } from '@/components/charter/types';
import {
  normalizeDestinationToMatrixKey,
  getMatrixKeyAlternatives,
} from '@/components/charter/destinationKeyMap';
import { resolveKm, resolveKmFromCoords } from '@/lib/calculatorDistance';
import { calcSimpleByVehicle, tollEstimate } from '@/lib/calculator';
import { calcTransferQuote, curatedStariaKRW, fourTierStariaKRW } from '@/lib/transferQuote';

// 차종별 배수 — 권역 정의 가격(daily_tour_prices / matrix.priceKRW)에 곱해서 적용.
// 2026-05-03 사용자 정책: sprinter 1.45→2.0, bus 2.3→3.0. resolveProductType.ts와 동기화.
// vip 는 매트릭스 가격에 곱해야 할 일이 없음 (협의 → null 반환). 안전상 1.0.
const VEHICLE_MULTIPLIER: Record<VehicleType, number> = {
  staria: 1.0,
  sprinter: 2.0,
  bus: 3.0,
  vip: 1.0,
};

// pricing_spec.json staria.intercity 기준 (rate_per_km: 1000) — 매트릭스 km만 알 때 사용.
// 옵션 C-FINAL 이후 SSOT VEHICLE_INTERCITY.staria 와 일치 확인됨 — hardcode 보조용.
const STARIA_BASE_FEE = 50_000;
const STARIA_RATE_PER_KM = 1000;

// Formula 1 (Pickup/Transfer one-way) — SSOT airport_transfer_pricing_formula 기반.
// 검증 (운영자 PR #381 자연 도출):
//   PUS → 해운대 (30km)         : flat ₩77K ✓
//   ICN → 부산 (450km, toll ₩67K): ₩463K + 150×0.85 + 67 = ₩658K ≈ ₩660K ✓
//   ICN → 명동 (55km)           : ₩77K + 25×1.8 = ₩122K
//   ICN → 강남 (70km)           : ₩77K + 40×1.8 = ₩149K
//   CJU → 중문 (40km)           : ₩77K + 10×1.8 = ₩95K
export function calcPickupTransferFormula(
  km: number,
  vehicleType: VehicleType,
  includeToll: boolean = true,
): { krw: number; breakdown: { base: number; perKm: number; toll: number } } | null {
  // Bus/VIP 는 협의 (formula 미적용)
  if (vehicleType === 'bus' || vehicleType === 'vip') return null;
  const safeKm = Number.isFinite(km) && km > 0 ? km : 0;
  if (safeKm === 0) return null;

  const f = AIRPORT_TRANSFER_PRICING_FORMULA.staria;
  let priceKRW: number;
  let baseKRW = f.tier1_price_krw;
  let perKmKRW = 0;

  if (safeKm <= f.tier1_flat_km) {
    // Tier 1: 0-30km flat
    priceKRW = f.tier1_price_krw;
  } else if (safeKm <= f.tier2_max_km) {
    // Tier 2: 30-100km
    perKmKRW = (safeKm - f.tier1_flat_km) * f.tier2_per_km_krw;
    priceKRW = f.tier1_price_krw + perKmKRW;
  } else if (safeKm <= f.tier3_max_km) {
    // Tier 3: 100-300km
    const tier2Cap = (f.tier2_max_km - f.tier1_flat_km) * f.tier2_per_km_krw;
    perKmKRW = tier2Cap + (safeKm - f.tier2_max_km) * f.tier3_per_km_krw;
    priceKRW = f.tier1_price_krw + perKmKRW;
  } else {
    // Tier 4: 300km+
    const tier2Cap = (f.tier2_max_km - f.tier1_flat_km) * f.tier2_per_km_krw;
    const tier3Cap = (f.tier3_max_km - f.tier2_max_km) * f.tier3_per_km_krw;
    perKmKRW = tier2Cap + tier3Cap + (safeKm - f.tier3_max_km) * f.tier4_per_km_krw;
    priceKRW = f.tier1_price_krw + perKmKRW;
  }

  const toll = includeToll && f.include_toll ? tollEstimate(safeKm) : 0;
  priceKRW += toll;

  // Sprinter 는 staria × multiplier_vs_staria
  if (vehicleType === 'sprinter') {
    const mult = AIRPORT_TRANSFER_PRICING_FORMULA.sprinter.multiplier_vs_staria;
    priceKRW = Math.round(priceKRW * mult);
    baseKRW = Math.round(baseKRW * mult);
    perKmKRW = Math.round(perKmKRW * mult);
  } else {
    priceKRW = Math.round(priceKRW);
  }

  return {
    krw: priceKRW,
    breakdown: {
      base: baseKRW,
      perKm: perKmKRW,
      toll,
    },
  };
}

// Bus/VIP는 결제 불가 — 항상 협의(상담 폼) 신호.
function isInquiryOnly(vehicle: VehicleType): boolean {
  return vehicle === 'bus' || vehicle === 'vip';
}

function matrixLookup(origin: string, destination: string): { km?: number; hours?: number; priceKRW?: number } | null {
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

function tryResolveCustomDestination(state: WizardState): string | null {
  if (state.destinationKey) return state.destinationKey;
  if (!state.destinationCustom) return null;
  return normalizeDestinationToMatrixKey(state.destinationCustom);
}

// 매트릭스 km만 있을 때 — staria 공식 × 차종 배수.
function calcIntercityFormula(vehicle: VehicleType, km: number): number {
  const staria = STARIA_BASE_FEE + km * 2 * STARIA_RATE_PER_KM;
  return Math.round(staria * VEHICLE_MULTIPLIER[vehicle]);
}

function surchargeForNight(baseKRW: number, isNight: boolean): number {
  return isNight ? Math.round(baseKRW * (EXTRA_CHARGES.nightSurchargePercent / 100)) : 0;
}

// 외부 거리 입력 (Geocoding 결과 또는 manual km). 동기 함수 — useEffect에서 호출.
function calculateQuoteWithKm(state: WizardState, externalKm: number | null): QuoteBreakdown | null {
  const warnings: string[] = [];
  if (!state.service || !state.vehicle) return null;

  const mode = state.service;
  const vehicle = state.vehicle;
  const svcCfg = (SERVICE_CONFIG as unknown as Record<string, {
    show_meals: boolean;
    show_attractions: boolean;
    meals_count_default?: number;
    meal_per_person?: number;
  }>)[mode];

  const includes = ['fuel', 'tolls', 'parking'];
  const excludes = ['meals', 'attractions', 'drinks', 'shopping'];

  const resolvedDest = tryResolveCustomDestination(state);
  let needsCustomQuote = false;

  // Bus/VIP는 즉시 needsCustomQuote — 결제 불가 신호.
  if (isInquiryOnly(vehicle)) {
    needsCustomQuote = true;
  }

  let vehicleChargeKRW = 0;
  let source: QuoteBreakdown['source'] = 'formula';
  let distanceKm: number | undefined;
  let durationHours: number | undefined;
  // 영수증 분해 (PR-F) — formula 일 때 base/distance/toll 채움. package/matrix 일 때 isPackage=true.
  let receiptBase: number | undefined;
  let receiptDistance: number | undefined;
  let receiptToll: number | undefined;
  let receiptIsPackage = false;

  if (!isInquiryOnly(vehicle)) {
    if (mode === 'kpop_shuttle') {
      vehicleChargeKRW = KPOP_SHUTTLE.pricePerVehicle;
      source = 'package';
      receiptIsPackage = true;
    } else if (mode === 'airport_transfer') {
      // 1. 권역 정의 (AIRPORT_TRANSFER_PRICES) 우선
      if (state.destinationKey && AIRPORT_TRANSFER_PRICES[state.destinationKey]) {
        vehicleChargeKRW = Math.round(AIRPORT_TRANSFER_PRICES[state.destinationKey].priceKRW * VEHICLE_MULTIPLIER[vehicle]);
        source = 'matrix';
        receiptIsPackage = true;
      } else if (state.origin && resolvedDest) {
        // 2. matrix lookup
        const m = matrixLookup(state.origin, resolvedDest);
        if (m?.priceKRW) {
          vehicleChargeKRW = Math.round(m.priceKRW * VEHICLE_MULTIPLIER[vehicle]);
          distanceKm = m.km; durationHours = m.hours; source = 'matrix';
          receiptIsPackage = true;
        } else if (m?.km) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, m.km);
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
          // calcIntercityFormula 는 base + km × perKm × 2 (왕복) 모델 — 톨비 별도 가산 안 됨.
          // 영수증에는 근사 분해로 노출 (km*100~150 정도 자동 톨비 포함 안 됨; "패키지" 행으로 단순화).
          receiptIsPackage = true;
        }
      }
      // 3. matrix miss + externalKm (Geocoding 또는 manual) → Pickup/Transfer Formula 1 (4-tier)
      //    옵션 C-FINAL 2026-05-12: airport_transfer 는 단방향이므로 calcSimpleByVehicle (왕복식) 대신
      //    calcPickupTransferFormula 사용. SSOT airport_transfer_pricing_formula 기반.
      if (vehicleChargeKRW === 0 && externalKm != null && externalKm > 0) {
        const formula = calcPickupTransferFormula(externalKm, vehicle, true);
        if (formula) {
          vehicleChargeKRW = formula.krw;
          distanceKm = externalKm; source = 'formula';
          receiptBase = formula.breakdown.base;
          receiptDistance = formula.breakdown.perKm;
          receiptToll = formula.breakdown.toll;
        }
      }
      // 4. Geocoding fail / km 없음 → needsCustomQuote
      if (vehicleChargeKRW === 0 && state.destinationCustom) {
        needsCustomQuote = true;
      }
    } else if (mode === 'day_tour') {
      // 1. 권역 정의 (DAILY_TOUR_PRICES) 우선
      if (state.destinationKey && DAILY_TOUR_PRICES[state.destinationKey]) {
        vehicleChargeKRW = Math.round(DAILY_TOUR_PRICES[state.destinationKey].priceKRW * VEHICLE_MULTIPLIER[vehicle]);
        source = 'package';
        receiptIsPackage = true;
      } else if (state.origin && resolvedDest) {
        // 2. matrix lookup
        const m = matrixLookup(state.origin, resolvedDest);
        if (m?.km) {
          vehicleChargeKRW = calcIntercityFormula(vehicle, m.km);
          distanceKm = m.km; durationHours = m.hours; source = 'formula';
          receiptIsPackage = true;
        }
      }
      // 3. matrix miss + externalKm → 단순 공식
      if (vehicleChargeKRW === 0 && externalKm != null && externalKm > 0) {
        const simple = calcSimpleByVehicle(vehicle, externalKm);
        if (simple) {
          vehicleChargeKRW = simple.krw;
          distanceKm = externalKm; source = 'formula';
          receiptBase = simple.breakdown.base;
          receiptDistance = simple.breakdown.perKm;
          receiptToll = simple.toll;
        }
      }
      if (vehicleChargeKRW === 0 && state.destinationCustom) {
        needsCustomQuote = true;
      }
    } else if (mode === 'multi_day') {
      // 1박 이상: 매트릭스 또는 externalKm 기반 + 일당 운영비 + 숙박비
      // P1 #6 fix (옵션 C-FINAL 2026-05-12): 차종별 daily/overnight 분기.
      //   staria  : daily ₩200K + overnight ₩130K (SSOT staria.intercity)
      //   sprinter: daily ₩280K + overnight ₩180K (SSOT sprinter.intercity)
      //   기존 hardcode (200K/130K) 는 sprinter 도 staria 값 적용 → underprice.
      const ic = VEHICLE_INTERCITY[vehicle as 'staria' | 'sprinter'] ?? VEHICLE_INTERCITY.staria;
      const daily = ic.daily_service_fee;
      const overnight = ic.overnight_driver_fee;
      const dayDiff = state.startDate && state.endDate
        ? Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000)
        : 0;
      const tourDays = Math.max(1, dayDiff + 1);
      const nights = Math.max(0, tourDays - 1);

      let kmForFormula: number | null = null;
      if (state.origin && resolvedDest) {
        const m = matrixLookup(state.origin, resolvedDest);
        if (m?.km) {
          kmForFormula = m.km; distanceKm = m.km; durationHours = m.hours; source = 'matrix';
        }
      }
      if (kmForFormula == null && externalKm != null && externalKm > 0) {
        kmForFormula = externalKm; distanceKm = externalKm; source = 'formula';
      }
      if (kmForFormula != null) {
        const intercity = calcIntercityFormula(vehicle, kmForFormula);
        vehicleChargeKRW = intercity + daily * tourDays + overnight * nights;
        receiptIsPackage = true;
      } else if (state.destinationCustom) {
        needsCustomQuote = true;
      }
    } else if (mode === 'transfer') {
      // 도시간 transfer(편도/왕복 1회 이동, 2026-06-02). 가격 표시는 Step6 TransferReceipt(calcTransferQuote),
      // 결제가는 resolveProductType(charter_transfer)=calcTransferQuote 가 권위. 여기 vehicleChargeKRW 는
      // canAdvance(subtotalKRW>0) + displayKRW fallback 용. multiDayDiscount/lodging 미적용(transfer=숙박 없음).
      let kmT: number | null = null;
      if (state.origin && resolvedDest) {
        const m = matrixLookup(state.origin, resolvedDest);
        if (m?.km) { kmT = m.km; distanceKm = m.km; durationHours = m.hours; source = 'matrix'; }
      }
      if (kmT == null && externalKm != null && externalKm > 0) { kmT = externalKm; distanceKm = externalKm; source = 'formula'; }
      if (kmT != null) {
        const tripType = state.tripType === 'roundtrip' ? 'roundtrip' : 'oneway';
        // 2026-06-05 통일: curatedKRW = 매트릭스 priceKRW ‖ 4-tier(km)+톨 (백 charter-transfer-price 와 동일).
        const curatedKRW = (state.origin && resolvedDest ? curatedStariaKRW(state.origin, resolvedDest) : null) ?? fourTierStariaKRW(kmT);
        const tq = curatedKRW != null ? calcTransferQuote({ curatedKRW, tripType, vehicle }) : null;
        if (tq) { vehicleChargeKRW = tq.total; receiptIsPackage = true; }
        else needsCustomQuote = true;
      } else if (state.destinationCustom) {
        needsCustomQuote = true;
      }
    }
  }

  if (vehicleChargeKRW === 0 && !needsCustomQuote) {
    warnings.push('견적을 산출하기에 입력이 부족합니다.');
  }

  // ── 추가 옵션 ──
  const addons: QuoteAddon[] = [];
  if (!isInquiryOnly(vehicle)) {
    // P1 #9 fix (2026-05-12): sprinter 는 guide_required 자동 가산이므로 licensed_guide 옵션을 무시.
    // 사용자가 sprinter + licensedGuide 둘 다 켜도 ₩300K 가 두 번 가산되지 않도록 server-side dedup.
    // UI Step5DateOptions 도 sprinter 선택 시 OptionPill 숨김 — 양쪽 다 방어.
    const licensedGuideApplies = state.options?.licensedGuide && vehicle !== 'sprinter';
    if (licensedGuideApplies)         addons.push({ key: 'licensed_guide', label: '면허 가이드 (영/일/중)', amountKRW: EXTRA_CHARGES.englishGuidePerDay });
    if (state.options?.airportPicket) addons.push({ key: 'airport_picket', label: '공항 픽켓 서비스',         amountKRW: EXTRA_CHARGES.airportPicketService });
    if (state.options?.childSeat)     addons.push({ key: 'child_seat',     label: '카시트',                   amountKRW: EXTRA_CHARGES.childSeatPerTrip });

    // sprinter는 가이드 필수료 자동 가산. bus/vip는 needsCustomQuote 분기로 빠지므로 도달 안 함.
    if (vehicle === 'sprinter') {
      const v = VEHICLE_TYPES[vehicle] as unknown as { guideFeeDailyKRW?: number };
      const fee = v.guideFeeDailyKRW ?? 300_000;
      addons.push({ key: 'guide_required', label: `면허 가이드 동행 (${vehicle}, 법적 필수)`, amountKRW: fee });
    }
  }

  const addonsSum = addons.reduce((s, a) => s + a.amountKRW, 0);

  const isNight = state.options?.night ?? false;
  const surchargeKRW = surchargeForNight(vehicleChargeKRW + addonsSum, isNight);
  const surchargePercent = isNight ? EXTRA_CHARGES.nightSurchargePercent : 0;

  let multiDayDiscountKRW = 0;
  let multiDayDiscountPercent = 0;
  if (mode === 'multi_day') {
    const dayDiff = state.startDate && state.endDate
      ? Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000)
      : 0;
    if (dayDiff >= 1) {
      const pct = EXTRA_CHARGES.multiDayDiscountPercent ?? 10;
      multiDayDiscountPercent = pct;
      multiDayDiscountKRW = Math.round((vehicleChargeKRW + addonsSum + surchargeKRW) * (pct / 100));
    }
  }

  const subtotalKRW = vehicleChargeKRW + addonsSum + surchargeKRW - multiDayDiscountKRW;

  // VAT 정보 — pricing_spec.json 의 vat_excluded 가 false 로 바뀌면 가산 처리. 현재는 부가세 포함 표기.
  const vatExcluded = (EXTRA_CHARGES as Record<string, unknown>).vatExcluded === true;
  const vatPercent = ((EXTRA_CHARGES as Record<string, unknown>).vatPercent as number) ?? 10;

  const showMeals = svcCfg?.show_meals ?? false;
  const showAttractions = svcCfg?.show_attractions ?? false;
  const pax = state.paxCount ?? 1;
  const days = Math.max(1, state.startDate && state.endDate ?
    Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000) : 1);
  const mealPerMeal = svcCfg?.meal_per_person ?? 0;
  const mealsCount = svcCfg?.meals_count_default ?? 0;
  const estimatedMealsKRW = showMeals ? pax * mealPerMeal * mealsCount * days : 0;

  let estimatedAttractionsKRW = 0;
  if (showAttractions && state.destinationKey && DAILY_TOUR_PRICES[state.destinationKey]) {
    const spots = DAILY_TOUR_PRICES[state.destinationKey].spots ?? [];
    for (const spot of spots) {
      const fee = (ATTRACTION_FEES as unknown as Record<string, number>)[spot];
      if (typeof fee === 'number') estimatedAttractionsKRW += fee * pax;
    }
  }

  // 영수증 분해 정보 — formula 일 때만 base/distance/toll 채움. 그 외 isPackage=true.
  const receipt = (receiptBase != null || receiptDistance != null || receiptToll != null || receiptIsPackage)
    ? {
        baseFeeKRW: receiptBase,
        distanceFeeKRW: receiptDistance,
        tollFeeKRW: receiptToll,
        isPackage: receiptIsPackage,
      }
    : undefined;

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
    receipt,
  };
}

export type DistanceSourceLabel = 'matrix' | 'geocoding' | 'manual' | null;

export interface QuoteCalculatorResult {
  quote: QuoteBreakdown | null;
  loading: boolean;
  geocodingFailed: boolean;     // 자동 거리 계산 실패 — manual km 입력 toggle 노출
  distanceSource: DistanceSourceLabel;
}

// 권역 정의(AIRPORT_TRANSFER_PRICES / DAILY_TOUR_PRICES) 또는 matrix priceKRW 가 hit 인지 사전 체크 —
// 사전에 결정 가능한 케이스에서는 Geocoding 호출을 건너뛴다.
function hasSpecOrMatrixPrice(state: WizardState): boolean {
  if (!state.service) return false;
  const vehicle = state.vehicle;
  if (!vehicle || isInquiryOnly(vehicle)) return false;
  if (state.service === 'kpop_shuttle') return true;
  if (state.service === 'airport_transfer' && state.destinationKey && AIRPORT_TRANSFER_PRICES[state.destinationKey]) return true;
  if (state.service === 'day_tour' && state.destinationKey && DAILY_TOUR_PRICES[state.destinationKey]) return true;
  if (state.origin) {
    const dest = tryResolveCustomDestination(state);
    if (dest && matrixLookup(state.origin, dest)) return true;
  }
  return false;
}

// React 훅 — Geocoding 호출 캐시 + 로딩/실패 상태 노출. CharterWizard Step 6 에서 manual km override 가능.
export function useQuoteCalculator(state: WizardState, manualKm?: number | null): QuoteCalculatorResult {
  const [externalKm, setExternalKm] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [geocodingFailed, setGeocodingFailed] = useState(false);
  const [distanceSource, setDistanceSource] = useState<DistanceSourceLabel>(null);

  // origin / destination / service / vehicle 변경 시 Geocoding 시도. matrix hit 이면 skip.
  useEffect(() => {
    let cancelled = false;
    setGeocodingFailed(false);

    if (!state.service || !state.vehicle) {
      setExternalKm(null); setDistanceSource(null); return;
    }
    if (isInquiryOnly(state.vehicle)) {
      setExternalKm(null); setDistanceSource(null); return;
    }

    if (hasSpecOrMatrixPrice(state)) {
      // 매트릭스/권역 hit — Geocoding 불필요. distanceSource는 quote.source 기반.
      setExternalKm(null);
      setDistanceSource('matrix');
      return;
    }

    // PR-H: AddressAutocomplete 가 좌표 두 개 모두 확정해줬으면 — Geocoding 우회.
    if (
      typeof state.originLat === 'number' && typeof state.originLng === 'number' &&
      typeof state.destLat === 'number' && typeof state.destLng === 'number'
    ) {
      const r = resolveKmFromCoords(state.originLat, state.originLng, state.destLat, state.destLng);
      if (r) {
        setExternalKm(r.km);
        setDistanceSource('geocoding'); // 'coords' 도 사실상 좌표 기반 추정 — 사용자에겐 동일 라벨.
        return;
      }
    }

    // origin / destination 둘 다 있어야 Geocoding 시도 가능.
    const originLabel = state.origin ?? state.originCustom;
    const destLabel = state.destinationKey ?? state.destinationCustom;
    if (!originLabel || !destLabel) {
      setExternalKm(null); setDistanceSource(null); return;
    }

    setLoading(true);
    resolveKm(String(originLabel), String(destLabel))
      .then(result => {
        if (cancelled) return;
        if (result) {
          setExternalKm(result.km);
          setDistanceSource(result.source === 'matrix' ? 'matrix' : 'geocoding');
        } else {
          setExternalKm(null);
          setDistanceSource(null);
          setGeocodingFailed(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setExternalKm(null);
        setDistanceSource(null);
        setGeocodingFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [
    state.service, state.vehicle, state.origin, state.originCustom,
    state.destinationKey, state.destinationCustom,
    state.originLat, state.originLng, state.destLat, state.destLng,
  ]);

  // manualKm > geocoding km — 사용자가 직접 입력했으면 우선.
  const effectiveKm = manualKm != null && manualKm > 0 ? manualKm : externalKm;
  const effectiveSource: DistanceSourceLabel = manualKm != null && manualKm > 0 ? 'manual' : distanceSource;

  const quote = calculateQuoteWithKm(state, effectiveKm);
  return {
    quote,
    loading,
    geocodingFailed: geocodingFailed && (manualKm == null || manualKm <= 0),
    distanceSource: effectiveSource,
  };
}

// 순수 동기 함수 — 매트릭스/권역 hit 케이스만 즉시 산출. 외부 km 없을 땐 호출 측에서 useQuoteCalculator 사용.
export function calculateQuote(state: WizardState): QuoteBreakdown | null {
  return calculateQuoteWithKm(state, null);
}
