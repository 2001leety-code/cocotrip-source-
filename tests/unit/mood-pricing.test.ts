import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js (Vercel serverless 공유 모듈)
import { MOOD_RATES, computeAmountKRW, isValidServiceType, rateForServiceType, MOOD_MAX_DURATION_HOURS } from '../../api/_shared/mood-pricing.js';

// MOOD B2B 포털 가격 SSOT — mood-book.js 가 이 함수로 잔액 차감액 재계산(클라이언트 금액 무시).
describe('mood-pricing — 단가 SSOT (부가세 포함)', () => {
  it('단가: 차량 33,000 / 매니저 44,000', () => {
    expect(MOOD_RATES.vehicle).toBe(33000);
    expect(MOOD_RATES.manager).toBe(44000);
  });
  it('computeAmountKRW = rate × hours', () => {
    expect(computeAmountKRW('vehicle', 2)).toEqual({ ok: true, amountKRW: 66000, ratePerHour: 33000 });
    expect(computeAmountKRW('manager', 3)).toEqual({ ok: true, amountKRW: 132000, ratePerHour: 44000 });
  });
  it('소수 시간 허용 + 정수 원 반올림 (1.5h)', () => {
    expect(computeAmountKRW('vehicle', 1.5).amountKRW).toBe(49500);
    expect(computeAmountKRW('manager', 1.5).amountKRW).toBe(66000);
  });
  it('잘못된 serviceType → ok:false', () => {
    expect(computeAmountKRW('bus', 1).ok).toBe(false);
    expect(rateForServiceType('bus')).toBeNull();
    expect(isValidServiceType('vehicle')).toBe(true);
    expect(isValidServiceType('manager')).toBe(true);
    expect(isValidServiceType('bus')).toBe(false);
  });
  it('duration 범위: 0 이하 / 최대 초과 → ok:false', () => {
    expect(computeAmountKRW('vehicle', 0).ok).toBe(false);
    expect(computeAmountKRW('vehicle', -1).ok).toBe(false);
    expect(computeAmountKRW('vehicle', MOOD_MAX_DURATION_HOURS + 1).ok).toBe(false);
    expect(computeAmountKRW('vehicle', MOOD_MAX_DURATION_HOURS).ok).toBe(true); // 경계 OK
  });
});
