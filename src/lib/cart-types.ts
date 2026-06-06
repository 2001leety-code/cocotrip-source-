/**
 * 장바구니(cart) 타입 + 플래그 — 멀티상품 "한번에 결제" FOUNDATION.
 *
 * 설계 (2026-06-06 cart-architecture-design 에이전시, 11에이전트 적대검증):
 * 최종 목표 = sum-one-order(총액 1주문 → 예약 N건). 1차 PR = 저장/UI/플래그만,
 * 결제 경로 0줄 수정 (cart 인프라 greenfield). 플래그 OFF 기본 = 현행 100% 무영향.
 *
 * ⚠️ priceKRW/priceUSD 는 표시 전용 — 결제 금액 아님.
 *    결제(2차 PR)는 booking 식별 키로 backend 가 _pricing_spec.json 에서 재계산 (P311).
 *    client 가 priceKRW 를 위조해도 청구액 영향 0 (resolveLineItemKrw).
 */

/**
 * 결제 식별 + fulfillment 페이로드 — createCartOrder(PR2c)가 productType+가격키로 backend
 * 재계산, captureCartOrder(PR2d)가 fulfillment 필드를 booking-processor 로 fan-out.
 * ⚠️ 표시가(CartItem.priceKRW)는 불신, 이 식별자만 신뢰 (P311 변조 차단).
 *
 * productType = 실제 결제 productType (예약 dialog 의 getTourProductType 결과:
 *   charter_seoul_city · airport_* · charter_transfer · charter_multiday · tour_hourly ·
 *   combo_* · kpop_shuttle_* 등). 'tour' 같은 표시 카테고리가 아니라 backend 가 가격을
 *   해석하는 실제 키. AI 플래너(ai_planner_full)는 cart 제외(isAiPlannerProduct 가드).
 */
export interface CartItemBooking {
  productType: string;
  passengers?: number;
  durationDays?: number;
  dateStart?: string;
  dateEnd?: string;
  // 차터 transfer/multiday (distance_matrix 키)
  originKey?: string;
  destKey?: string;
  vehicle?: string;
  tripType?: string;
  // 투어 슬롯
  tourId?: string;
  tourSlotId?: string;
  bookingDate?: string;
  slotCapacity?: number;
  // fulfillment (booking-processor 전달)
  pickupLocation?: string;
  vehicleType?: string;
  memo?: string;
}

export interface CartItem {
  /** cart line 고유 id (상품 id 또는 productType+식별키 합성) */
  id: string;
  /** 결제 식별 (SSOT 재계산 입력 — 2차 PR). 표시가 불신, 이 키만 신뢰. */
  booking: CartItemBooking;
  /** UI 표시명 (사용자 언어) */
  displayName: string;
  thumbnailUrl?: string;
  /** ⚠️ 표시 전용. 결제 금액 아님 (booking 키로 backend 재계산). */
  priceKRW?: number;
  /** ⚠️ 표시 전용. */
  priceUSD?: number;
  /** 추가 시각 (ms) */
  addedAt: number;
}

export interface Cart {
  items: CartItem[];
}

/**
 * 프론트 장바구니 플래그. OFF 기본 — 켜야 담기 버튼/패널 노출.
 * 백 FEATURE_CART 와 쌍 (2차 PR 결제 경로). VITE_FEATURE_CART='true' 시 활성.
 */
export function isCartEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_CART === 'true';
}

/** AI 플래너 상품 여부 — cart 담기 제외 가드 (위 주석 사유). */
export function isAiPlannerProduct(productType: string): boolean {
  return String(productType || '').replace(/-/g, '_') === 'ai_planner_full';
}
