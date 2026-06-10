// resolveProductType — wizard state → PayPal productType 매핑 + 가격
// createPaypalOrder.js의 CHARTER_MAP/COMBO_MAP와 1:1로 동기화됨.
import { AIRPORT_TRANSFER_PRICES, DAILY_TOUR_PRICES, KPOP_SHUTTLE } from '@/data/charterPricing';
import { calcMultiDayCharterKrw, lookupMatrixKm } from '@/lib/multidayQuote';
import { calcTourQuote } from '@/lib/tourQuote';
import { calcTransferQuote, curatedStariaKRW } from '@/lib/transferQuote';
import { discountV2Enabled } from '@/lib/discountFlags';
import { normalizeDestinationToMatrixKey } from './destinationKeyMap';
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

// 매트릭스 도착 키 정규화 — destinationKey('CUSTOM' 제외) → destinationCustomMatched → 자유입력 정규화.
function resolveDestMatrixKey(state: WizardState): string | null {
  if (state.destinationKey && state.destinationKey !== 'CUSTOM') return state.destinationKey;
  if (state.destinationCustomMatched) return state.destinationCustomMatched;
  if (state.destinationCustom) return normalizeDestinationToMatrixKey(state.destinationCustom);
  return null;
}

export interface ResolvedPayment {
  productType: string | null;     // PayPal 인덱스 키
  priceKRW: number | null;         // PayPal order 금액
  passengers: number;
  payable: boolean;                // PayPal로 즉시 결제 가능 여부
  reason?: string;                 // payable=false일 때 사유
  // 2026-06-02 차터 즉시결제 wiring — backend(createPaypalOrder) 재계산용. PaymentPanel 이 PayPalBookingButton 으로 forward.
  // 멀티데이/transfer/투어 시간제는 priceKRW 를 영수증 lib(=backend SSOT)에서 산출 → 표시가==청구가 (P311).
  originKey?: string | null;       // 매트릭스 출발 키 (state.origin)
  destKey?: string | null;         // 매트릭스 도착 키 (정규화 결과)
  tripType?: 'oneway' | 'roundtrip'; // charter_transfer 전용
  durationDays?: number;           // charter_multiday 전용 (1박+ 일수)
}

export function resolveProductType(state: WizardState): ResolvedPayment {
  const pax = state.paxCount ?? 1;
  const vehicle = state.vehicle ?? 'staria';
  const mult = VEHICLE_MULTIPLIER[vehicle] ?? 1.0;
  // 차터 즉시결제 플래그 (빌드타임, 기본 OFF). ON 일 때만 새 productType 활성 → OFF=현행 byte-identical.
  const MULTIDAY_CHECKOUT_ON = import.meta.env.VITE_FEATURE_MULTIDAY_CHECKOUT === 'true';
  const TOUR_HOURLY_ON = import.meta.env.VITE_FEATURE_TOUR_HOURLY === 'true';
  const TRANSFER_CHECKOUT_ON = import.meta.env.VITE_FEATURE_TRANSFER_CHECKOUT === 'true';

  // 공항 픽업 — 운영자 P0-Q2 (2026-05-12) 결정: ICN/PUS/GMP/CJU/TAE 4 공항 모두 PayPal 허용.
  //   조건: AIRPORT_TRANSFER_PRICES SSOT 에 등재된 destinationKey 만 결제 가능.
  //   ICN 외 공항은 SSOT 에 'busan-metro', 'gimpo-seoul-central', 'gimpo-seoul-gangnam', 'jeju-metro' 신규 등재됨.
  if (state.service === 'airport_transfer') {
    // 운영자 P0-Q4 (2026-05-12): Bus/VIP 차종은 결제 영수증·UI 에 가격 숫자 노출 금지 — 협의 라벨만.
    if (vehicle === 'bus' || vehicle === 'vip') {
      return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: 'Bus/VIP 별도 견적 (협의)' };
    }
    const dest = state.destinationKey;
    if (!dest || !(AIRPORT_TRANSFER_PRICES[dest])) {
      return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: '목적지 미선택' };
    }
    const base = AIRPORT_TRANSFER_PRICES[dest].priceKRW;
    // createPaypalOrder.js는 'airport_'+key(dash→underscore)로 매핑
    const productType = `airport_${dest.replace(/-/g, '_')}`;
    return { productType, priceKRW: Math.round(base * mult), passengers: pax, payable: vehicle === 'staria' };
    // sprinter는 별도 견적 — 가이드비 등 추가 계산 복잡해서 즉시결제 아님 (priceKRW 노출은 유지: 견적 화면 정상)
  }

  // 당일 투어
  if (state.service === 'day_tour') {
    // 운영자 P0-Q4 (2026-05-12): Bus/VIP 가격 숨김.
    if (vehicle === 'bus' || vehicle === 'vip') {
      return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: 'Bus/VIP 별도 견적 (협의)' };
    }
    // 투어 시간제 즉시결제 (2026-06-02). VITE_FEATURE_TOUR_HOURLY(프론트) + FEATURE_TOUR_HOURLY(백엔드) 둘 다 ON.
    // 매트릭스 해석 가능한 목적지(km>0) + staria/sprinter 만. 패키지(DAY_TOUR_PRODUCT_MAP, dmz 등)는 매트릭스 키가
    // 아니므로 아래 패키지 경로 유지(자동 fall-through). 가격 = calcTourQuote(쿠폰5%+VAT 포함) = backend SSOT (P311).
    if (TOUR_HOURLY_ON && (vehicle === 'staria' || vehicle === 'sprinter') && !DAY_TOUR_PRODUCT_MAP[state.destinationKey ?? '']) {
      const originKey = state.origin && state.origin !== 'CUSTOM' ? state.origin : null;
      const destKey = resolveDestMatrixKey(state);
      const km = originKey && destKey ? lookupMatrixKm(originKey, destKey) : null;
      if (km != null && km > 0) {
        const q = calcTourQuote({ km, vehicle });
        if (q) {
          return { productType: 'tour_hourly', priceKRW: q.total, passengers: pax, payable: true, originKey, destKey };
        }
      }
    }
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
    // 운영자 P0-Q4 (2026-05-12): Bus/VIP 가격 숨김.
    if (vehicle === 'bus' || vehicle === 'vip') {
      return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: 'Bus/VIP 별도 견적 (협의)' };
    }
    return {
      productType: 'kpop_shuttle_roundtrip',
      priceKRW: pax * KPOP_SHUTTLE.priceRoundTrip,
      passengers: pax,
      payable: true,
    };
  }

  // 도시간 transfer(편도/왕복 1회 이동) 즉시결제 (2026-06-02). VITE_FEATURE_TRANSFER_CHECKOUT(프론트) +
  // FEATURE_TRANSFER_CHECKOUT(백엔드) 둘 다 ON. 매트릭스 매칭 + staria/sprinter. 가격 = calcTransferQuote
  // (편도 km×1500 / 왕복 ×2, 쿠폰 5%/10% + VAT) = backend SSOT (P311). service='transfer' 는 항상 여기서 종료.
  if (state.service === 'transfer') {
    if (vehicle === 'bus' || vehicle === 'vip') {
      return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: 'Bus/VIP 별도 견적 (협의)' };
    }
    if (TRANSFER_CHECKOUT_ON && (vehicle === 'staria' || vehicle === 'sprinter')) {
      const originKey = state.origin && state.origin !== 'CUSTOM' ? state.origin : null;
      const destKey = resolveDestMatrixKey(state);
      // 2026-06-05 통일: curatedKRW = 매트릭스 priceKRW ‖ 4-tier(km)+톨 (백 charter-transfer-price 와 동일).
      const curatedKRW = originKey && destKey ? curatedStariaKRW(originKey, destKey) : null;
      if (curatedKRW != null) {
        const tripType: 'oneway' | 'roundtrip' = state.tripType === 'roundtrip' ? 'roundtrip' : 'oneway';
        const q = calcTransferQuote({ curatedKRW, tripType, vehicle }, { discountV2: discountV2Enabled() });
        if (q) {
          return { productType: 'charter_transfer', priceKRW: q.total, passengers: pax, payable: true, originKey, destKey, tripType };
        }
      }
    }
    return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: '도시간 이동 견적 (협의)' };
  }

  // 멀티데이(1박+) 차터 즉시결제 (2026-06-02). VITE_FEATURE_MULTIDAY_CHECKOUT(프론트) + FEATURE_MULTIDAY_CHECKOUT(백엔드)
  // 둘 다 ON 이어야 실제 결제 통과. 매트릭스 매칭 + staria/sprinter + 1박+ 만 결제 가능. 그 외 = 아래 WhatsApp.
  // 가격 = calcMultiDayCharterKrw (= backend SSOT, 3일+ durationDays>=3 시 10% 할인 반영) → 표시가==청구가 (P311). matrix km 으로 산출.
  if (MULTIDAY_CHECKOUT_ON && state.service === 'multi_day' && (vehicle === 'staria' || vehicle === 'sprinter')) {
    const originKey = state.origin && state.origin !== 'CUSTOM' ? state.origin : null;
    const destKey = resolveDestMatrixKey(state);
    const durationDays = state.startDate && state.endDate
      ? Math.max(1, Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000) + 1)
      : 1;
    const km = originKey && destKey ? lookupMatrixKm(originKey, destKey) : null;
    if (km != null && km > 0 && durationDays >= 2) {
      const price = calcMultiDayCharterKrw({ vehicle, km, durationDays }, { discountV2: discountV2Enabled() });
      if (price != null) {
        return {
          productType: 'charter_multiday', priceKRW: price, passengers: pax, payable: true,
          originKey, destKey, durationDays,
        };
      }
    }
  }

  // 1박 이상 장거리 — 위 즉시결제 조건 미충족(플래그 OFF / 비매트릭스 / bus·vip 등). WhatsApp 견적.
  return { productType: null, priceKRW: null, passengers: pax, payable: false, reason: '장거리 투어는 맞춤 견적' };
}
