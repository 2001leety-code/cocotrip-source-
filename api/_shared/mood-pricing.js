/**
 * MOOD B2B 선불 예약 포털 — 가격 SSOT (Single Source of Truth)
 *
 * 운영자 MOOD brand consulting (매니저업) 이 광고사에 시급 매니저/차량 제공.
 * 광고사는 선불 충전 후 예약마다 잔액에서 차감.
 *
 * 🔴 금액 계산은 무조건 백엔드 (이 모듈) 에서만. 클라이언트가 보낸 amountKRW 는
 *     절대 신뢰하지 않는다 (위조 가능). api/mood-book.js 가 이 함수로 재계산해서
 *     트랜잭션 안에서 잔액 차감 → 클라이언트가 금액을 조작해도 무력화.
 *
 * 단가 (부가세 포함, 원/시간):
 *   - vehicle : 33,000원/시간 (차량)
 *   - manager : 44,000원/시간 (매니저)
 *
 * ESM — Vercel serverless (api/*) + Vitest 양쪽에서 import 가능.
 */

/** @typedef {'vehicle' | 'manager'} MoodServiceType */

/** 서비스별 시급 (원). 부가세 포함. */
export const MOOD_RATES = Object.freeze({
  vehicle: 33000,
  manager: 44000,
});

/** 예약 1건 최대 시간 (mood-book.js maxDuration 가드와 동일 의미의 비즈 한도). */
export const MOOD_MAX_DURATION_HOURS = 15;

/** 유효 서비스 타입인지 검사. */
export function isValidServiceType(serviceType) {
  return serviceType === 'vehicle' || serviceType === 'manager';
}

/** 서비스 타입의 시급 (원). 유효하지 않으면 null. */
export function rateForServiceType(serviceType) {
  return isValidServiceType(serviceType) ? MOOD_RATES[serviceType] : null;
}

/**
 * 예약 금액 계산 — rate × hours.
 *
 * @param {MoodServiceType} serviceType - 'vehicle' | 'manager'
 * @param {number} durationHours - 시간 (양의 정수/소수, 0 초과 ~ 15 이하)
 * @returns {{ ok: true, amountKRW: number, ratePerHour: number } | { ok: false, error: string }}
 *
 * 실패 케이스 (호출자가 400 으로 반환):
 *   - 알 수 없는 serviceType
 *   - durationHours 가 숫자 아님 / NaN / 0 이하 / 15 초과
 */
export function computeAmountKRW(serviceType, durationHours) {
  const ratePerHour = rateForServiceType(serviceType);
  if (ratePerHour === null) {
    return { ok: false, error: `INVALID_SERVICE_TYPE: ${String(serviceType)}` };
  }
  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return { ok: false, error: 'INVALID_DURATION: must be a positive number' };
  }
  if (hours > MOOD_MAX_DURATION_HOURS) {
    return { ok: false, error: `INVALID_DURATION: max ${MOOD_MAX_DURATION_HOURS}h` };
  }
  // rate × hours. 소수 시간 (예: 1.5h) 도 허용 — 반올림해 정수 원 단위.
  const amountKRW = Math.round(ratePerHour * hours);
  return { ok: true, amountKRW, ratePerHour };
}
