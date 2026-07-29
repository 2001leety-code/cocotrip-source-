/**
 * Booking cutoff policy — 예약 마감 시각 SSOT.
 *
 * 정책 (2026-07-28 운영자 확정 — 상품군별 분리. 이전 "전 상품 12h 통일"은 폐기):
 *  - 전세차량(차량 배차만 하면 되는 상품): 출발 **1시간** 전 마감
 *      공항 픽업/샌딩 · 편도/왕복 이동 · 다일 · 시간제 · K-pop 셔틀 · 위저드 맞춤견적
 *  - 투어(코스·기사·가이드가 붙는 상품): 출발 **8시간** 전 마감
 *      서울 시내/근교 · DMZ · 강원 · 스키 · 경주/전주 · 부산 데이투어 등
 *  - bus / vip (협의 폼): 검증 X — InquiryForm 별도 endpoint
 *  - AI 플래너: 검증 X — 디지털 상품, 출발 일정 무관 (호출부가 isAiPlannerProduct 로 skip)
 *
 * ⚠️ 상품군은 **productType 으로만** 판별한다. 투어 카탈로그도 결제 시에는
 *    `charter_seoul_city` 같은 charter_* 코드로 들어오기 때문에(getTourProductType),
 *    "어느 화면에서 눌렀나"로는 서버가 구분할 수 없다 — 화면 정보는 위조도 가능하다.
 *
 * ⚠️ 하이픈/언더바 혼용 주의 (결제 100% 거부 사고 이력): 비교 전에 반드시 정규화한다.
 *    단 `tour_hourly`(시간제 차터)와 `tour-seoul-city`(투어 카탈로그 id)는 정규화하면
 *    둘 다 `tour_...` 가 되므로, 시간제 차터를 **명시 집합으로 먼저** 걸러낸다.
 *
 * 기준: KST timezone, 픽업 시각 기준.
 *  예: 2026-05-15 09:00 KST 출발 투어 → 2026-05-15 01:00 KST 마감.
 *
 * 의도적으로 luxon/dayjs 도입 X — Date + +09:00 offset 직접 처리.
 *
 * 프론트 미러 = src/lib/bookingCutoff.ts (위저드·투어 다이얼로그가 소비).
 * 변경 시 두 곳 동기 필수 — tests/unit/booking-cutoff-parity.test.ts 가 가드.
 */

/** 전세차량 마감 (시간). 배차만 하면 되는 상품. */
export const CHARTER_VEHICLE_CUTOFF_HOURS = 1;
/** 투어 마감 (시간). 코스·기사·가이드 준비가 필요한 상품. */
export const TOUR_CUTOFF_HOURS = 8;

/**
 * 전세차량(=차량 배차형) 상품 집합.
 * 여기에 없으면 투어로 본다 — 모르는 코드는 **더 엄격한 8h** 로 떨어져
 * "못 채울 예약을 받아버리는" 쪽 사고를 막는다(과소제약 금지).
 */
const CHARTER_VEHICLE_EXACT = new Set([
  'charter_transfer',       // 편도/왕복 이동
  'charter_multiday',       // 다일 대절
  'tour_hourly',            // 시간제 대절 (이름만 tour_ 이고 실체는 차량 대절)
  'charter_custom_estimate',// 위저드 맞춤견적 (차량 기준 견적)
  'kpop_shuttle_oneway',
  'kpop_shuttle_roundtrip',
]);

/** productType 정규화 — 하이픈/대문자 혼용 흡수. */
function normalizeProductType(productType) {
  return String(productType || '').toLowerCase().replace(/-/g, '_');
}

/**
 * 전세차량 상품인가? (아니면 투어)
 * @param {string} productType
 * @returns {boolean}
 */
export function isCharterVehicleProduct(productType) {
  const pt = normalizeProductType(productType);
  if (!pt) return false;                       // 미상 → 투어(엄격) 쪽으로
  if (CHARTER_VEHICLE_EXACT.has(pt)) return true;
  if (pt.startsWith('airport_')) return true;  // 공항 픽업/샌딩 전 노선
  return false;
}

/**
 * 마감 시간 (시간 단위) 결정.
 * @param {string} productType
 * @param {number} [_durationDays]  (reserved — multi_day 별도 마감 폐기)
 * @returns {number} 1 (전세차량) 또는 8 (투어)
 */
export function getCutoffHours(productType, _durationDays) {
  return isCharterVehicleProduct(productType)
    ? CHARTER_VEHICLE_CUTOFF_HOURS
    : TOUR_CUTOFF_HOURS;
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
