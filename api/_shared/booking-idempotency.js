/**
 * booking-processor 멱등 가드 — retry/replay 중복(시트 row·로열티 포인트·확인메일) 방지.
 *
 * 배경: booking-processor 는 비멱등 — 같은 orderID 로 2회 호출되면(retry 큐 sweep,
 * admin-replay-booking-notifications, cart fan-out 재시도) Sheets append·로열티 적립·
 * voucher 메일이 매번 다시 실행돼 중복. bookings/{orderID} 의 단계별 완료 마커를 읽어
 * "이미 끝낸 단계는 스킵" 결정한다.
 *
 * ⚠️ 안전 기본: 마커 읽기 실패/없음 → 전부 처리(스킵 0). 즉 첫 처리는 항상 전 단계 실행
 *    (기존 단일상품 동작 100% 불변). 마커는 각 단계 "성공 후"에만 set → 첫 호출엔 없음.
 *    orderID 는 고유(PayPal order / ADMIN-BYPASS-)라 다른 예약 마커 오염 없음.
 *
 * 마커 필드 (bookings/{orderID}):
 *  - sheetsAppendedAt   : Google Sheets row append 성공
 *  - loyaltyEarnedAt    : 로열티 포인트 적립 성공
 *  - voucherSentAt      : 확인메일(+voucher) 발송 성공 (기존 필드 재사용)
 */

/**
 * @param {object|null|undefined} priorMarkers  bookings/{orderID} 문서 데이터 (없으면 {}/null)
 * @returns {{skipSheets:boolean, skipLoyalty:boolean, skipVoucher:boolean}}
 */
export function bookingStepGuards(priorMarkers) {
  const m = priorMarkers || {};
  return {
    skipSheets:  Boolean(m.sheetsAppendedAt),
    skipLoyalty: Boolean(m.loyaltyEarnedAt),
    skipVoucher: Boolean(m.voucherSentAt),
  };
}

/** 멱등 마커 필드명 상수 (booking-processor 가 set 시 사용). */
export const BOOKING_STEP_MARKERS = {
  sheets: 'sheetsAppendedAt',
  loyalty: 'loyaltyEarnedAt',
  voucher: 'voucherSentAt',
};
