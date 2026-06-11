/**
 * MOOD 포털 — 프론트 가격 미러 (표시용 예상 금액 계산).
 *
 * 🔴 백엔드 SSOT = api/_shared/mood-pricing.js. 이 파일은 "예상 금액 실시간 표시"
 *     UX 용 미러일 뿐이며, 실제 청구/잔액 차감은 항상 백엔드 computeAmountKRW 가
 *     재계산한다 (api/mood-book.js). 두 단가는 반드시 동일하게 유지할 것.
 */

export type MoodServiceType = 'vehicle' | 'manager';

/** 서비스별 시급 (원). 부가세 포함. 백엔드 MOOD_RATES 와 동일해야 함. */
export const MOOD_RATES: Record<MoodServiceType, number> = {
  vehicle: 33000,
  manager: 44000,
};

export const MOOD_MAX_DURATION_HOURS = 15;

/** 예상 금액 (원). 표시 전용 — 실제 청구는 백엔드 재계산. */
export function estimateMoodAmountKRW(serviceType: MoodServiceType, durationHours: number): number {
  const rate = MOOD_RATES[serviceType] || 0;
  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(rate * hours);
}

export function formatKRW(n: number): string {
  return `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
}
