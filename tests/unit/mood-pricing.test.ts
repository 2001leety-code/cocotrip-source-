import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js (Vercel serverless 공유 모듈)
import { MOOD_RATES, computeAmountKRW, isValidServiceType, rateForServiceType, MOOD_MAX_DURATION_HOURS, computeDistanceSurchargeKRW, computeMoodTotalKRW } from '../../api/_shared/mood-pricing.js';

// MOOD B2B 포털 가격 SSOT — mood-book.js 가 이 함수로 잔액 차감액 재계산(클라이언트 금액 무시).
describe('mood-pricing — 단가 SSOT (부가세 포함)', () => {
  it('단가: 차량 33,000 / 매니저 44,000', () => {
    expect(MOOD_RATES.vehicle).toBe(33000);
    expect(MOOD_RATES.manager).toBe(44000);
  });
  it('computeAmountKRW = rate × max(3, hours) — 최소 3시간 고정', () => {
    expect(computeAmountKRW('vehicle', 3)).toEqual({ ok: true, amountKRW: 99000, ratePerHour: 33000 });   // 3h
    expect(computeAmountKRW('manager', 5)).toEqual({ ok: true, amountKRW: 220000, ratePerHour: 44000 });  // 5h
  });
  it('3시간 미만은 3시간 청구(floor), 그 이상만 추가', () => {
    expect(computeAmountKRW('vehicle', 1).amountKRW).toBe(99000);    // 1h → 3h 청구
    expect(computeAmountKRW('vehicle', 2).amountKRW).toBe(99000);    // 2h → 3h 청구
    expect(computeAmountKRW('manager', 1.5).amountKRW).toBe(132000); // 1.5h → 3h 청구
    expect(computeAmountKRW('vehicle', 4.5).amountKRW).toBe(148500); // 4.5h → 33000×4.5 (floor 무관, 소수 허용)
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

// 거리 추가요금 + 총액 (운영자 2026-06-12: 50km↑ km×660 비례 + 톨비, 부가세 포함)
describe('mood-pricing — 거리 추가요금 + 총액', () => {
  it('50km 미만 = 추가요금 0', () => {
    expect(computeDistanceSurchargeKRW(0)).toBe(0);
    expect(computeDistanceSurchargeKRW(49)).toBe(0);
    expect(computeDistanceSurchargeKRW(49.9)).toBe(0);
  });
  it('50km 이상 = km × 660 (비례)', () => {
    expect(computeDistanceSurchargeKRW(50)).toBe(33000);
    expect(computeDistanceSurchargeKRW(100)).toBe(66000);
    expect(computeDistanceSurchargeKRW(75)).toBe(49500);
    expect(computeDistanceSurchargeKRW(120)).toBe(79200);
  });
  it('총액 = 시급×max(3,시간) + 거리추가 + 톨비', () => {
    const r = computeMoodTotalKRW({ serviceType: 'manager', durationHours: 2, km: 100, tollKRW: 5000 });
    expect(r.ok).toBe(true);
    expect(r.baseKRW).toBe(132000);           // 44000 × max(3,2) = 44000×3 (최소 3시간)
    expect(r.distanceSurchargeKRW).toBe(66000); // 100km
    expect(r.tollKRW).toBe(5000);
    expect(r.amountKRW).toBe(203000);          // 132000 + 66000 + 5000
  });
  it('단거리(50km 미만)·톨비 0 = base 만', () => {
    const r = computeMoodTotalKRW({ serviceType: 'vehicle', durationHours: 3, km: 20 });
    expect(r.amountKRW).toBe(99000);           // 33000 × 3, 추가 0
    expect(r.distanceSurchargeKRW).toBe(0);
  });
  it('잘못된 serviceType → ok:false 전파', () => {
    expect(computeMoodTotalKRW({ serviceType: 'bus', durationHours: 1 }).ok).toBe(false);
  });
});
