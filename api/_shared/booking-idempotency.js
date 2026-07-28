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
 *
 * 🔴 2026-07-29 (2단계 상태): 마커를 "선점"과 "완료" 두 단계로 나눈다.
 *   이전에는 작업 **전에** 마커를 박고(선점) 실패 시 지웠다. 그래서 선점과 해제 사이에
 *   함수가 죽으면(타임아웃·콜드스타트 종료·배포 중단) 마커가 남아 **retry 가 영원히 스킵**했다.
 *   실제로는 시트 row 도 메일도 바우처도 안 나갔는데 "완료"로 보였다.
 *   → 선점은 `<field>State = 'in_progress'` + 시각으로 기록하고,
 *     **성공했을 때만** `<field>` 타임스탬프 + `<field>State='completed'` 를 쓴다.
 *     스킵 판정은 `completed` 만 본다. 오래된 in_progress 는 좀비로 보고 재선점을 허용한다.
 */

/** 선점 상태 필드명 = 완료 필드명 + 'State' (예: sheetsAppendedAtState). */
export const stepStateField = (field) => `${field}State`;

/** 좀비 선점 판정 시간 — 함수 최대 실행시간(60s)의 여유 배수. */
export const STEP_CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * 이 단계가 **실제로 완료**됐는가? (선점만 된 것은 완료가 아니다)
 * 레거시 문서 호환: State 필드가 없고 완료 타임스탬프만 있으면 완료로 본다.
 */
export function isStepCompleted(markers, field) {
  const m = markers || {};
  const state = m[stepStateField(field)];
  if (state === 'completed') return true;
  if (state === 'in_progress') return false;
  return Boolean(m[field]);   // 레거시(State 없음)
}

/**
 * @param {object|null|undefined} priorMarkers  bookings/{orderID} 문서 데이터 (없으면 {}/null)
 * @returns {{skipSheets:boolean, skipLoyalty:boolean, skipVoucher:boolean}}
 */
export function bookingStepGuards(priorMarkers) {
  const m = priorMarkers || {};
  // 🔴 completed 만 스킵한다. in_progress(선점 후 죽은 경우)는 다시 처리해야 한다.
  return {
    skipSheets:  isStepCompleted(m, 'sheetsAppendedAt'),
    skipLoyalty: isStepCompleted(m, 'loyaltyEarnedAt'),
    skipVoucher: isStepCompleted(m, 'voucherSentAt'),
  };
}

/** 멱등 마커 필드명 상수 (booking-processor 가 set 시 사용). */
export const BOOKING_STEP_MARKERS = {
  sheets: 'sheetsAppendedAt',
  loyalty: 'loyaltyEarnedAt',
  voucher: 'voucherSentAt',
};
