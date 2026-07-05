import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js (Vercel serverless 공유 모듈)
import { MOOD_RATES, computeAmountKRW, isValidServiceType, rateForServiceType, MOOD_MAX_DURATION_HOURS, computeDistanceSurchargeKRW, computeMoodTotalKRW } from '../../api/_shared/mood-pricing.js';

// MOOD B2B 포털 가격 SSOT — mood-book.js 가 이 함수로 잔액 차감액 재계산(클라이언트 금액 무시).
describe('mood-pricing — 단가 SSOT (부가세 포함)', () => {
  it('단가: 차량 30,000 / 매니저 40,000', () => {
    expect(MOOD_RATES.vehicle).toBe(30000);
    expect(MOOD_RATES.manager).toBe(40000);
  });
  it('computeAmountKRW = rate × max(3, hours) — 최소 3시간 고정', () => {
    expect(computeAmountKRW('vehicle', 3)).toEqual({ ok: true, amountKRW: 90000, ratePerHour: 30000 });   // 3h
    expect(computeAmountKRW('manager', 5)).toEqual({ ok: true, amountKRW: 200000, ratePerHour: 40000 });  // 5h
  });
  it('3시간 미만은 3시간 청구(floor), 그 이상만 추가', () => {
    expect(computeAmountKRW('vehicle', 1).amountKRW).toBe(90000);    // 1h → 3h 청구
    expect(computeAmountKRW('vehicle', 2).amountKRW).toBe(90000);    // 2h → 3h 청구
    expect(computeAmountKRW('manager', 1.5).amountKRW).toBe(120000); // 1.5h → 3h 청구
    expect(computeAmountKRW('vehicle', 4.5).amountKRW).toBe(135000); // 4.5h → 30000×4.5 (floor 무관, 소수 허용)
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

// 거리 추가요금 + 총액 (운영자 2026-06-12: 50km↑ km×600 비례 + 톨비, 부가세 포함)
describe('mood-pricing — 거리 추가요금 + 총액', () => {
  it('50km 미만 = 추가요금 0', () => {
    expect(computeDistanceSurchargeKRW(0)).toBe(0);
    expect(computeDistanceSurchargeKRW(49)).toBe(0);
    expect(computeDistanceSurchargeKRW(49.9)).toBe(0);
  });
  it('50km 이상 = km × 600 (비례)', () => {
    expect(computeDistanceSurchargeKRW(50)).toBe(30000);
    expect(computeDistanceSurchargeKRW(100)).toBe(60000);
    expect(computeDistanceSurchargeKRW(75)).toBe(45000);
    expect(computeDistanceSurchargeKRW(120)).toBe(72000);
  });
  it('총액 = 시급×max(3,시간) + 거리추가 + 톨비', () => {
    const r = computeMoodTotalKRW({ serviceType: 'manager', durationHours: 2, km: 100, tollKRW: 5000 });
    expect(r.ok).toBe(true);
    expect(r.baseKRW).toBe(120000);           // 40000 × max(3,2) = 40000×3 (최소 3시간)
    expect(r.distanceSurchargeKRW).toBe(60000); // 100km
    expect(r.tollKRW).toBe(5000);
    expect(r.amountKRW).toBe(185000);          // 120000 + 60000 + 5000
  });
  it('단거리(50km 미만)·톨비 0 = base 만', () => {
    const r = computeMoodTotalKRW({ serviceType: 'vehicle', durationHours: 3, km: 20 });
    expect(r.amountKRW).toBe(90000);           // 30000 × 3, 추가 0
    expect(r.distanceSurchargeKRW).toBe(0);
  });
  it('잘못된 serviceType → ok:false 전파', () => {
    expect(computeMoodTotalKRW({ serviceType: 'bus', durationHours: 1 }).ok).toBe(false);
  });
});

describe('정산 단가 보존 — ratePerHourOverride (2026-07-04 요율 개정 33k→30k)', () => {
  it('override 있으면 예약 당시 단가로 계산 (옛 33,000 예약 정산 보존)', async () => {
    const { computeMoodTotalKRW } = await import('../../api/_shared/mood-pricing.js');
    const r = computeMoodTotalKRW({ serviceType: 'vehicle', durationHours: 9, km: 0, tollKRW: 0, ratePerHourOverride: 33000 });
    expect(r.ok).toBe(true);
    expect(r.ratePerHour).toBe(33000);
    expect(r.baseKRW).toBe(297000); // 33,000 × 9 — 새 단가(270,000) 아님
  });

  it('override 없거나 불량(0/NaN/음수)이면 현행 단가', async () => {
    const { computeMoodTotalKRW } = await import('../../api/_shared/mood-pricing.js');
    expect(computeMoodTotalKRW({ serviceType: 'vehicle', durationHours: 3 }).ratePerHour).toBe(30000);
    expect(computeMoodTotalKRW({ serviceType: 'vehicle', durationHours: 3, ratePerHourOverride: 0 }).ratePerHour).toBe(30000);
    expect(computeMoodTotalKRW({ serviceType: 'vehicle', durationHours: 3, ratePerHourOverride: NaN }).ratePerHour).toBe(30000);
  });

  it('공항 정액(110,000)은 override·시간 무관 그대로 (직행)', async () => {
    const { computeMoodTotalKRW } = await import('../../api/_shared/mood-pricing.js');
    const r = computeMoodTotalKRW({ serviceType: 'airport', durationHours: 2, ratePerHourOverride: 33000 });
    expect(r.amountKRW).toBe(110000);
    expect(r.distanceSurchargeKRW).toBe(0);
  });

  it('공항 경유 우회거리 요금 (2026-07-05) — 정액 + 우회km×600, 임계값 없음', async () => {
    const { computeMoodTotalKRW, computeAirportDetourSurchargeKRW } = await import('../../api/_shared/mood-pricing.js');
    // 우회 15km → 110,000 + 15×600 = 119,000
    const r = computeMoodTotalKRW({ serviceType: 'airport', durationHours: 0, airportDetourKm: 15 });
    expect(r.amountKRW).toBe(119000);
    expect(r.baseKRW).toBe(110000);
    expect(r.distanceSurchargeKRW).toBe(9000);
    expect(r.km).toBe(15); // breakdown.km = 우회 km
    // 우회 0(직행) → 순수 정액
    expect(computeMoodTotalKRW({ serviceType: 'airport', durationHours: 0, airportDetourKm: 0 }).amountKRW).toBe(110000);
    // 임계값 없음 — 우회 5km도 과금 (차량 50km 임계값과 다름)
    expect(computeAirportDetourSurchargeKRW(5)).toBe(3000);
    expect(computeAirportDetourSurchargeKRW(0)).toBe(0);
    expect(computeAirportDetourSurchargeKRW(-3)).toBe(0); // 음수 방어
    // km/tollKRW(전체 거리)는 공항에서 무시 — 우회만 반영 (위조 방지)
    const r2 = computeMoodTotalKRW({ serviceType: 'airport', durationHours: 99, km: 250, tollKRW: 9000, airportDetourKm: 20 });
    expect(r2.amountKRW).toBe(110000 + 20 * 600); // 122,000 — km/toll 무시, detour만
    expect(r2.tollKRW).toBe(0);
  });

  it('mood-settle 배선 소스 불변식 — pre.ratePerHour 전달', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/mood-settle.js'), 'utf8');
    expect(src).toMatch(/ratePerHourOverride: Number\(pre\.ratePerHour\)/);
  });
});
