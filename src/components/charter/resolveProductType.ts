// resolveProductType — wizard state → PayPal productType 매핑 + 가격
// createPaypalOrder.js의 CHARTER_MAP/COMBO_MAP와 1:1로 동기화됨.
import { AIRPORT_TRANSFER_PRICES, DAILY_TOUR_PRICES, KPOP_SHUTTLE } from '@/data/charterPricing';
import type { WizardState } from './types';

// 당일 투어 destinationKey → PayPal productType
const DAY_TOUR_PRODUCT_MAP: Record<string, string> = {
  'seoul-city':      'charter_seoul_city',
  'seoul-suburb':    'charter_seoul_suburb',
  'dmz':             'charter_dmz',
  'gangwon':         'charter_gangwon',
  'ski-resort':      'charter_ski',
  'gyeongju-jeonju': 'charter_gyeongju',
  'busan-day':       'charter_busan',
};

// 차종 배수 (useQuoteCalculator와 동일)
// 2026-05-03 사용자 정책 변경: sprinter 1.45→2.0, bus 2.3→3.0.
// useQuoteCalculator.ts와 항상 동기화 필수 (PayPal 결제 금액 = 견적 화면 금액).
const VEHICLE_MULTIPLIER: Record<string, number> = {
  staria: 1.0,
  sprinter: 2.0,
  bus: 3.0,
};

export interface ResolvedPayment {
  productType: string | null;     // PayPal 인덱스 키
  priceKRW: number | null;         // PayPal order 금액
  passengers: number;
  payable: boolean;                // PayPal로 즉시 결제 가능 여부
  reason?: string;                 // payable=false일 때 사유
}

export function resolveProductType(state: WizardState): ResolvedPayment {
  const pax = state.paxCount ?? 1;
  const vehicle = state.vehicle ?? 'staria';
  const mult = VEHICLE_MULTIPLIER[vehicle] ?? 1.0;

  // 공항 픽업 — ICN 출발만 PayPal 하드코딩 매핑 존재 (다른 공항은 즉시결제 불가)
  if (state.service === 'airport_transfer') {
    if (state.origin !== 'ICN') {
      return {
        productType: null, priceKRW: null, passengers: pax, payable: false,
        reason: 'ICN 외 공항은 WhatsApp으로 견적 요청',
      };
    }
    const dest = state.destinationKey;
    if (!dest || !(AIRPORT_TRANSFER_PRICES[dest])) {
      return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: '목적지 미선택' };
    }
    const base = AIRPORT_TRANSFER_PRICES[dest].priceKRW;
    // createPaypalOrder.js는 'airport_'+key(dash→underscore)로 매핑
    const productType = `airport_${dest.replace(/-/g, '_')}`;
    return { productType, priceKRW: Math.round(base * mult), passengers: pax, payable: vehicle === 'staria' };
    // sprinter/bus는 별도 견적 — 가이드비 등 추가 계산 복잡해서 즉시결제 아님
  }

  // 당일 투어
  if (state.service === 'day_tour') {
    const dest = state.destinationKey;
    if (!dest || !DAY_TOUR_PRODUCT_MAP[dest] || !DAILY_TOUR_PRICES[dest]) {
      return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: '패키지 미선택' };
    }
    const base = DAILY_TOUR_PRICES[dest].priceKRW;
    return {
      productType: DAY_TOUR_PRODUCT_MAP[dest],
      priceKRW: Math.round(base * mult),
      passengers: pax,
      payable: vehicle === 'staria',
    };
  }

  // K-pop 셔틀 — 왕복 기본, per-vehicle 가격 (createPaypalOrder.js는 인원수 × 단가지만 위저드는 차량 단일가 사용)
  if (state.service === 'kpop_shuttle') {
    return {
      productType: 'kpop_shuttle_roundtrip',
      priceKRW: pax * KPOP_SHUTTLE.priceRoundTrip,
      passengers: pax,
      payable: true,
    };
  }

  // 1박 이상 장거리 — 아직 하드코딩 상품 없음. WhatsApp 견적.
  return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: '장거리 투어는 맞춤 견적' };
}
