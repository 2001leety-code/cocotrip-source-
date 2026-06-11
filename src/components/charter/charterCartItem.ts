// charterCartItem — 차터 위저드 state + resolveProductType 결과 → 장바구니 항목(CartItemBooking).
//
// 2026-06-11: 결제화면(PaymentPanel) PayPal 버튼 옆 "장바구니 담기" 진입점. TourBookingDialog 패턴 차용.
// 🔴 P311: booking 필드는 backend resolve-line-item.js(resolveLineItemKrw)가 읽는 키와 1:1 매핑 —
//    표시가(priceKRW)는 무시되고 이 키로 SSOT 재계산. 잘못 매핑하면 표시가≠청구가 → parity 단위테스트로 가드.
//    백엔드 분기: charter_transfer=originKey/destKey/tripType/vehicle · charter_multiday=+durationDays ·
//    tour_hourly=originKey/destKey/vehicle · airport_*/charter_*(day)/kpop/combo=productType/passengers/durationDays.
import { isAiPlannerProduct, type CartItemBooking } from '@/lib/cart-types';
import type { ResolvedPayment } from './resolveProductType';
import type { WizardState } from './types';

export interface CharterCartItem {
  id: string;
  booking: CartItemBooking;
  displayName: string;
  priceKRW: number;
}

/**
 * 차터 결제 가능 항목 → 장바구니 항목. 부적합이면 null(담기 버튼 미노출).
 * 제외: 비결제(payable=false) / 견적문의(charter_custom_estimate, backend SSOT 미해석=INVALID_LINE) / AI플래너(정책).
 */
export function buildCharterCartItem(state: WizardState, resolved: ResolvedPayment): CharterCartItem | null {
  if (!resolved.payable || !resolved.productType || resolved.priceKRW == null || resolved.priceKRW <= 0) return null;
  if (resolved.productType === 'charter_custom_estimate') return null; // backend 미해석 → cart 전체거부 회피
  if (isAiPlannerProduct(resolved.productType)) return null;            // 방어적(차터엔 미발생)

  const vehicle = state.vehicle || 'staria';
  const durationDays = resolved.durationDays
    || (state.service === 'multi_day' && state.endDate && state.startDate
      ? Math.max(1, Math.round((new Date(state.endDate).getTime() - new Date(state.startDate).getTime()) / 86_400_000) + 1)
      : 1);
  const origin = state.origin || state.originCustom || '';
  const dest = state.destinationKey || state.destinationCustom || '';
  const routeLabel = origin && dest ? `${origin} → ${dest}` : (origin || dest || resolved.productType);

  // 2026-06-11: 검수 화면 일관성(운영자) — 투어처럼 풍부한 memo(경로·차종·항공편·연락처·메모)로
  //   번호 리스트 표시. 구조적 booking 필드와 일부 중복은 투어 포맷과 동일. memo 는 가격 키 아님(P311 무관).
  const memo = [
    `Charter: ${routeLabel}`,
    resolved.passengers ? `${resolved.passengers} pax` : '',
    `Vehicle: ${vehicle}`,
    state.startDate ? `Date: ${state.startDate}` : '',
    state.airport?.terminal ? `Terminal: ${state.airport.terminal}` : '',
    state.airport?.flightNumber ? `Flight: ${state.airport.flightNumber}` : '',
    state.customerName ? `Name: ${state.customerName}` : '',
    state.customerPhone ? `Phone: ${state.customerPhone}` : '',
    state.customerMessenger ? `Messenger: ${state.customerMessenger}` : '',
    state.notes ? `Notes: ${state.notes}` : '',
  ].filter(Boolean).join(' | ');

  // ⚠️ backend resolveLineItemKrw 가 읽는 키만 신뢰됨 (priceKRW 는 표시 전용 = 재계산 시 무시).
  const booking: CartItemBooking = {
    productType: resolved.productType,
    passengers: resolved.passengers,
    durationDays,
    dateStart: state.startDate || undefined,
    dateEnd: state.endDate || state.startDate || undefined,
    originKey: resolved.originKey || undefined,
    destKey: resolved.destKey || undefined,
    vehicle,
    tripType: resolved.tripType,
    pickupLocation: origin,
    vehicleType: vehicle,
    memo,
  };

  // 같은 조건 중복 담기 방지 합성 키 (TourBookingDialog `${tour.id}-${date}-${pax}` 패턴 따름).
  const id = `charter-${resolved.productType}-${origin}-${dest}-${state.startDate || ''}-${state.paxCount || ''}`;
  const displayName = state.startDate ? `${routeLabel} (${state.startDate})` : routeLabel;

  return { id, booking, displayName, priceKRW: resolved.priceKRW };
}
