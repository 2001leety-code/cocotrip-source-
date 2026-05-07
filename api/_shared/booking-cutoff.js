/**
 * Booking cutoff policy (2026-05-07 통일).
 *
 * 정책 (사용자 확정):
 *  - 모든 일반 차터 케이스: 출발 12시간 전 마감 (24h/48h → 12h 통일)
 *  - bus / vip (협의 폼): 검증 X — InquiryForm 별도 endpoint
 *  - AI 플래너: 검증 X — 디지털 상품, 출발 일정 무관
 *
 * 기준: KST timezone, 픽업 시각 정확히 -12h.
 *  예: 2026-05-15 09:00 KST 출발 → 2026-05-14 21:00 KST 마감.
 *
 * 의도적으로 luxon/dayjs 도입 X — Date + +09:00 offset 직접 처리.
 */

/**
 * 마감 시간 (시간 단위) 결정.
 * @param {string} _productType  (reserved — 현재 정책은 모든 타입 12h 통일)
 * @param {number} [_durationDays]  (reserved — multi_day 구분 폐기, 12h 통일)
 * @returns {number} 12
 */
export function getCutoffHours(_productType, _durationDays) {
  // 2026-05-07: 모든 차터 케이스 12h 통일 (이전: 일반 24h / multi_day 48h).
  return 12;
}

/**
 * 마감 시간 (밀리초 단위) — getCutoffHours × 3600000.
 */
export function getCutoffMs(productType, durationDays) {
  return getCutoffHours(productType, durationDays) * 3600 * 1000;
}

/**
 * KST(+09:00) 기준 출발 시각이 cutoff를 지났는지 검사.
 *
 * tourDate + pickupTime 을 KST 절대 시점으로 해석한다 (시간대 명시: +09:00).
 * 이렇게 하면 서버가 어느 타임존에서 실행되든 동일한 cutoff 가 계산된다.
 *
 * @param {string} tourDate    YYYY-MM-DD (KST 기준 출발 날짜)
 * @param {string} pickupTime  HH:mm (KST 기준 픽업 시각)
 * @param {string} productType
 * @param {number} [durationDays]
 * @param {Date}   [now]       테스트용 현재 시각 주입. 미전달 시 new Date()
 * @returns {boolean} true = 마감 지남, false = 아직 가능
 */
export function isPastCutoff(tourDate, pickupTime, productType, durationDays, now) {
  if (!tourDate || typeof tourDate !== 'string') {
    throw new Error('isPastCutoff: tourDate (YYYY-MM-DD) is required');
  }
  // pickupTime 누락 시 보수적으로 09:00 KST 가정 (silent fail 금지지만 실용적 fallback).
  // 호출처에서 명시적으로 pickupTime을 전달해야 함 — 이 fallback은 마지막 안전망.
  const time = pickupTime && /^\d{2}:\d{2}$/.test(pickupTime) ? pickupTime : '09:00';

  // YYYY-MM-DDTHH:mm:00+09:00 → KST 절대 시점
  const departureIso = `${tourDate}T${time}:00+09:00`;
  const departure = new Date(departureIso);
  if (isNaN(departure.getTime())) {
    throw new Error(`isPastCutoff: invalid tourDate/pickupTime: ${tourDate} ${pickupTime}`);
  }

  const cutoff = new Date(departure.getTime() - getCutoffMs(productType, durationDays));
  const current = now instanceof Date ? now : new Date();
  return current.getTime() > cutoff.getTime();
}

/**
 * 출발까지 남은 시간 (시간 단위, 양수). 마감 안내용.
 * @returns {number} 시간 (소수점 포함). 음수면 출발 지남.
 */
export function hoursUntilDeparture(tourDate, pickupTime, now) {
  if (!tourDate) return Number.POSITIVE_INFINITY;
  const time = pickupTime && /^\d{2}:\d{2}$/.test(pickupTime) ? pickupTime : '09:00';
  const departure = new Date(`${tourDate}T${time}:00+09:00`);
  if (isNaN(departure.getTime())) return Number.POSITIVE_INFINITY;
  const current = now instanceof Date ? now : new Date();
  return (departure.getTime() - current.getTime()) / 3600000;
}
