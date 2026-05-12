// src/data/charterPricing.ts
// 코코트립 차량/투어 가격 어댑터
// ⚠️ 가격 값은 pricing_spec.json에서 단일 관리. 이 파일은 기존 TS 타입/모양을 유지하는 리시프(reshape) 어댑터.
// 컴포넌트 측 import 경로(예: AIRPORT_TRANSFER_PRICES)는 그대로 유지되어 마이그레이션 충격 0.
import spec from './pricing_spec.json';

// ────────────────────────────────────────
// 차량 기본 정보 (기존 소비: CharterPage 등)
// ────────────────────────────────────────
export const VEHICLE_INFO = {
  name: spec.vehicles.staria.name_ko,
  maxPassengers: spec.vehicles.staria.max_pax,
  features: spec.vehicles.staria.features_ko as string[],
};

// ────────────────────────────────────────
// 공항 픽업/샌딩 요금 (편도, 차량 1대)
// ────────────────────────────────────────
type AirportTransferEntry = {
  ko: string;
  en: string;
  priceKRW: number;
  priceUSD: number;
  durationMin: number;
};

export const AIRPORT_TRANSFER_PRICES: Record<string, AirportTransferEntry> = Object.fromEntries(
  Object.entries(spec.airport_transfer_prices)
    .filter(([key]) => key !== 'comment')
    .map(([key, raw]) => {
      const v = raw as {
        name_ko: string; name_en: string;
        priceKRW: number; priceUSD: number; durationMin: number;
      };
      return [key, {
        ko: v.name_ko,
        en: v.name_en,
        priceKRW: v.priceKRW,
        priceUSD: v.priceUSD,
        durationMin: v.durationMin,
      }];
    }),
);

// ────────────────────────────────────────
// 일일 전세 투어 요금 (서울 출발, 차량 1대)
// ────────────────────────────────────────
type DailyTourEntry = {
  ko: string;
  en: string;
  priceKRW: number;
  priceUSD: number;
  hours: number;
  spots: string[];
  keywords: string[];
};

export const DAILY_TOUR_PRICES: Record<string, DailyTourEntry> = Object.fromEntries(
  Object.entries(spec.daily_tour_prices)
    .filter(([key]) => key !== 'comment')
    .map(([key, raw]) => {
      const v = raw as {
        name_ko: string; name_en: string;
        priceKRW: number; priceUSD: number;
        hours: number; spots: string[]; keywords: string[];
      };
      return [key, {
        ko: v.name_ko,
        en: v.name_en,
        priceKRW: v.priceKRW,
        priceUSD: v.priceUSD,
        hours: v.hours,
        spots: v.spots,
        keywords: v.keywords,
      }];
    }),
);

// ────────────────────────────────────────
// 차량 타입 (staria / sprinter / bus)
// - 기존 스키마 보존: staria는 guideFee, sprinter/bus는 guideFeeDailyKRW (calculateTotalPrice 호환)
// ────────────────────────────────────────
const _staria   = spec.vehicles.staria;
const _sprinter = spec.vehicles.sprinter;
const _bus      = spec.vehicles.bus;

export const VEHICLE_TYPES = {
  staria: {
    name: { ko: _staria.name_ko, en: _staria.name_en, ja: _staria.name_ja, zh: _staria.name_zh },
    maxPassengers: _staria.max_pax,
    guideRequired: _staria.guide_required,
    guideFee: _staria.guide_daily_fee,
    description: {
      ko: _staria.description_ko,
      en: _staria.description_en,
      ja: _staria.description_ja,
      zh: _staria.description_zh,
    },
  },
  sprinter: {
    name: { ko: _sprinter.name_ko, en: _sprinter.name_en, ja: _sprinter.name_ja, zh: _sprinter.name_zh },
    maxPassengers: _sprinter.max_pax,
    guideRequired: _sprinter.guide_required,
    guideFeeDailyKRW: _sprinter.guide_daily_fee,
    description: {
      ko: _sprinter.description_ko,
      en: _sprinter.description_en,
      ja: _sprinter.description_ja,
      zh: _sprinter.description_zh,
    },
  },
  bus: {
    name: { ko: _bus.name_ko, en: _bus.name_en, ja: _bus.name_ja, zh: _bus.name_zh },
    maxPassengers: _bus.max_pax,
    guideRequired: _bus.guide_required,
    guideFeeDailyKRW: _bus.guide_daily_fee,
    description: {
      ko: _bus.description_ko,
      en: _bus.description_en,
      ja: _bus.description_ja,
      zh: _bus.description_zh,
    },
  },
};

export const calculateTotalPrice = (
  basePrice: number,
  vehicleType: 'staria' | 'sprinter' | 'bus',
  days = 1,
): { basePrice: number; guideFee: number; totalPrice: number; guideRequired: boolean; note: string } => {
  const vehicle = VEHICLE_TYPES[vehicleType];
  const dailyFee = (vehicle as unknown as { guideFeeDailyKRW?: number }).guideFeeDailyKRW ?? 300000;
  const guideTotal = vehicle.guideRequired ? dailyFee * days : 0;
  return {
    basePrice,
    guideFee: guideTotal,
    totalPrice: basePrice + guideTotal,
    guideRequired: vehicle.guideRequired,
    note: vehicle.guideRequired ? `가이드 비용 ₩300,000/일 × ${days}일 포함` : '',
  };
};

// ────────────────────────────────────────
// 추가 요금표
// ────────────────────────────────────────
export const EXTRA_CHARGES = {
  overtimePerHour: spec.extra_charges.overtime_per_hour,
  nightSurchargePercent: spec.extra_charges.night_surcharge_percent,
  peakSeasonPercent: spec.extra_charges.peak_season_percent,
  roundTripDiscountPercent: spec.extra_charges.round_trip_discount_percent,
  multiDayDiscountPercent: (spec.extra_charges as Record<string, unknown>).multi_day_discount_percent as number | undefined,
  englishGuidePerDay: spec.extra_charges.english_guide_per_day,
  licensedGuidePerDay: (spec.extra_charges as Record<string, unknown>).licensed_guide_per_day as number | undefined,
  airportPicketService: spec.extra_charges.airport_picket_service,
  childSeatPerTrip: spec.extra_charges.child_seat_per_trip,
  vatExcluded: (spec.extra_charges as Record<string, unknown>).vat_excluded as boolean | undefined,
  vatPercent: (spec.extra_charges as Record<string, unknown>).vat_percent as number | undefined,
};

// ────────────────────────────────────────
// K-pop 콘서트 셔틀 요금
// ────────────────────────────────────────
export const KPOP_SHUTTLE = {
  priceOneWay: spec.kpop_shuttle.price_one_way,
  priceRoundTrip: spec.kpop_shuttle.price_round_trip,
  maxPassengers: spec.kpop_shuttle.max_passengers,
  pricePerVehicle: spec.kpop_shuttle.price_per_vehicle,
  vehicleType: spec.vehicles.staria.name_ko,
  includes: spec.kpop_shuttle.includes_ko as string[],
  venues: (spec.kpop_shuttle.venues as Array<{
    name_ko: string; name_en: string; location_ko: string; location_en: string;
  }>).map(v => ({
    name: v.name_ko, nameEn: v.name_en,
    location: v.location_ko, locationEn: v.location_en,
  })),
  pickupPoints: spec.kpop_shuttle.pickup_points_ko as string[],
};

// 전세차량 기본 요금 (공항 픽업 편도)
export const CHARTER_BASE_PRICE = spec.charter_base_price;

// ────────────────────────────────────────
// AI 플래너 코스 자동 감지 함수
// ────────────────────────────────────────
export function detectCharterRecommendation(places: { name: string; nameEn?: string }[]): {
  recommended: boolean;
  tourType: string | null;
  pricing: typeof DAILY_TOUR_PRICES[string] | null;
  reason: string;
} {
  const allText = places
    .map((p) => `${p.name} ${p.nameEn ?? ''}`)
    .join(' ')
    .toLowerCase();

  for (const [key, tour] of Object.entries(DAILY_TOUR_PRICES)) {
    const matched = tour.keywords.some((kw) => allText.includes(kw.toLowerCase()));
    if (matched) {
      const isSeoulOnly = key === 'seoul-city';
      return {
        recommended: true,
        tourType: key,
        pricing: tour,
        reason: isSeoulOnly
          ? '짐이 많거나 이동이 불편한 경우 전세차량을 추천합니다.'
          : '이 코스는 대중교통으로 이동이 불편합니다. 전세차량을 강력 추천합니다.',
      };
    }
  }

  return { recommended: false, tourType: null, pricing: null, reason: '' };
}

// ────────────────────────────────────────
// 신규 공개: Phase B·C에서 사용할 확장 데이터
// ────────────────────────────────────────
export const SERVICE_CONFIG = spec.service_config;
export const AIRPORTS_CATALOG = spec.airports;
export const CITIES_CATALOG = spec.cities;
export const DISTANCE_MATRIX = spec.distance_matrix;
export const ATTRACTION_FEES = spec.attraction_fees;
export const PRICING_SPEC_VERSION = spec.version;

// ────────────────────────────────────────
// 옵션 C-FINAL (2026-05-12): SSOT 단일화
// ────────────────────────────────────────
// Pickup/Transfer Formula 1 (4-tier, one-way) — useQuoteCalculator.calcPickupTransferFormula 가 import.
// hardcode 회피: 모든 tier 값 (₩77K / ₩1.8K / ₩1.3K / ₩0.85K) 가 pricing_spec.json 에 단일 source.
type AirportTransferFormulaStaria = {
  tier1_flat_km: number;
  tier1_price_krw: number;
  tier2_max_km: number;
  tier2_per_km_krw: number;
  tier3_max_km: number;
  tier3_per_km_krw: number;
  tier4_per_km_krw: number;
  include_toll: boolean;
};
type AirportTransferFormulaSprinter = { multiplier_vs_staria: number };

const _formula = (spec as unknown as Record<string, unknown>).airport_transfer_pricing_formula as
  | { staria: AirportTransferFormulaStaria; sprinter: AirportTransferFormulaSprinter }
  | undefined;

// SSOT 누락 시 안전 default (운영자 P0-Q1 결정 PR #381 반영).
export const AIRPORT_TRANSFER_PRICING_FORMULA = {
  staria: _formula?.staria ?? {
    tier1_flat_km: 30,
    tier1_price_krw: 77_000,
    tier2_max_km: 100,
    tier2_per_km_krw: 1_800,
    tier3_max_km: 300,
    tier3_per_km_krw: 1_300,
    tier4_per_km_krw: 850,
    include_toll: true,
  },
  sprinter: _formula?.sprinter ?? { multiplier_vs_staria: 1.85 },
} as const;

// vehicles.{staria,sprinter}.intercity 노출 — useQuoteCalculator.multi_day 분기에서 사용.
// P1 #6 fix (옵션 C-FINAL): sprinter multi_day 가 staria 값 200K/130K 으로 계산되던 underprice 해결.
type VehicleIntercity = {
  base_fee: number;
  rate_per_km: number;
  deadhead_factor: number;
  daily_service_fee: number;
  overnight_driver_fee: number;
};
export const VEHICLE_INTERCITY: { staria: VehicleIntercity; sprinter: VehicleIntercity } = {
  staria: spec.vehicles.staria.intercity as VehicleIntercity,
  sprinter: spec.vehicles.sprinter.intercity as VehicleIntercity,
};
