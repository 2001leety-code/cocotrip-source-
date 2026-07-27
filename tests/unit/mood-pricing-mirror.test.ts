import { describe, it, expect } from 'vitest';
import {
  MOOD_RATES as FE_RATES,
  MOOD_MAX_DURATION_HOURS as FE_MAX,
  MOOD_FIXED_PRICE_KRW as FE_FIXED,
  MOOD_AIRPORT_PRICE_KRW as FE_AIRPORT,
  normalizeAirportCode as feNormAirport,
  computeDistanceSurchargeKRW as feSurcharge,
  computeMoodTotalKRW as feTotal,
  estimateMoodAmountKRW,
} from '../../src/lib/moodPricing';
// @ts-expect-error — ESM .js (Vercel serverless 공유 모듈, 백엔드 SSOT)
import { MOOD_RATES as BE_RATES, MOOD_MAX_DURATION_HOURS as BE_MAX, MOOD_FIXED_PRICE_KRW as BE_FIXED, MOOD_AIRPORT_PRICE_KRW as BE_AIRPORT, normalizeAirportCode as beNormAirport, computeDistanceSurchargeKRW as beSurcharge, computeMoodTotalKRW as beTotal } from '../../api/_shared/mood-pricing.js';

// 🔴 프론트 미러(src/lib/moodPricing.ts)가 백엔드 SSOT(api/_shared/mood-pricing.js)와
//    동일한 단가·공식을 유지하는지 검증. 어긋나면 "표시가 ≠ 청구가" → 신뢰 붕괴(P311).
describe('mood-pricing 미러 — 프론트 ↔ 백엔드 동등성', () => {
  it('단가 상수 동일 (차량 30,000 / 공항 30,000 / 매니저 40,000)', () => {
    expect(FE_RATES.vehicle).toBe(BE_RATES.vehicle);
    expect(FE_RATES.airport).toBe(BE_RATES.airport);
    expect(FE_RATES.manager).toBe(BE_RATES.manager);
    expect(FE_RATES.vehicle).toBe(30000);
    expect(FE_RATES.airport).toBe(30000);
    expect(FE_RATES.manager).toBe(40000);
  });

  it('공항 = 정액 110,000 — 시간/거리/톨비 전부 무시 (위조 방지, FE=BE)', () => {
    expect(FE_FIXED.airport).toBe(BE_FIXED.airport);
    expect(FE_FIXED.airport).toBe(110000);
    const cases = [
      { durationHours: 1, km: 0, tollKRW: 0 },
      { durationHours: 2, km: 60, tollKRW: 3300 },
      { durationHours: 99, km: 250, tollKRW: 9000 }, // 시간/거리 조작해도 정액
      { durationHours: 0, km: 0, tollKRW: 0 },
    ];
    for (const c of cases) {
      const fe = feTotal({ serviceType: 'airport', ...c });
      const be = beTotal({ serviceType: 'airport', ...c });
      expect(fe.amountKRW).toBe(110000);
      expect(be.amountKRW).toBe(110000);
      expect(fe.distanceSurchargeKRW).toBe(0);
      expect(fe.tollKRW).toBe(0);
      expect(fe.amountKRW).toBe(be.amountKRW);
    }
  });

  it('공항별 정액 동일 (FE=BE) — 인천 110,000 / 김포 80,000 (2026-07-27)', () => {
    expect(FE_AIRPORT.ICN).toBe(BE_AIRPORT.ICN);
    expect(FE_AIRPORT.GMP).toBe(BE_AIRPORT.GMP);
    expect(FE_AIRPORT.ICN).toBe(110000);
    expect(FE_AIRPORT.GMP).toBe(80000);
    for (const c of [{ durationHours: 0 }, { durationHours: 9, km: 300, tollKRW: 9000 }]) {
      // 김포 = 8만 정액 (시간/거리/톨비 조작 무시)
      expect(feTotal({ serviceType: 'airport', airportCode: 'GMP', ...c }).amountKRW).toBe(80000);
      expect(beTotal({ serviceType: 'airport', airportCode: 'GMP', ...c }).amountKRW).toBe(80000);
      // 인천 = 11만
      expect(feTotal({ serviceType: 'airport', airportCode: 'ICN', ...c }).amountKRW).toBe(110000);
      expect(beTotal({ serviceType: 'airport', airportCode: 'ICN', ...c }).amountKRW).toBe(110000);
    }
  });

  it('🔴 알 수 없는/미지정 공항 코드 = 인천(비싼 쪽) 폴백 — 과소청구 방지, FE=BE', () => {
    // 소문자·공백은 정상 해석, 그 외 쓰레기 값은 전부 ICN.
    for (const code of ['gmp', ' GMP ', 'icn', 'CJU', '', null, undefined, 'GMP; DROP', 0 as unknown as string]) {
      expect(feNormAirport(code)).toBe(beNormAirport(code));
    }
    expect(feNormAirport('gmp')).toBe('GMP');
    expect(feNormAirport('CJU')).toBe('ICN');
    expect(feNormAirport(undefined)).toBe('ICN');
    // 코드 미지정 예약(레거시) = 기존 11만 그대로
    expect(feTotal({ serviceType: 'airport', durationHours: 0 }).amountKRW).toBe(110000);
    expect(beTotal({ serviceType: 'airport', durationHours: 0 }).amountKRW).toBe(110000);
    // 조작된 코드로 싸게 받는 경로 없음
    expect(beTotal({ serviceType: 'airport', durationHours: 0, airportCode: 'FREE' }).amountKRW).toBe(110000);
  });

  it('김포도 경유 우회거리 요금 동일 공식 (8만 + 우회km×600, FE=BE)', () => {
    const c = { serviceType: 'airport' as const, durationHours: 0, airportCode: 'GMP', airportDetourKm: 15 };
    expect(feTotal(c).amountKRW).toBe(89000);
    expect(beTotal(c).amountKRW).toBe(89000);
    expect(feTotal(c).baseKRW).toBe(80000);
    expect(feTotal(c).distanceSurchargeKRW).toBe(beTotal(c).distanceSurchargeKRW);
  });

  it('공항 경유 우회거리 요금 동일 (FE=BE, 2026-07-05) — 정액 + 우회km×600', () => {
    const cases = [
      { serviceType: 'airport' as const, durationHours: 0, airportDetourKm: 15 },
      { serviceType: 'airport' as const, durationHours: 0, airportDetourKm: 0 },   // 직행 = 정액
      { serviceType: 'airport' as const, durationHours: 0, airportDetourKm: 5 },   // 임계값 없음
      { serviceType: 'airport' as const, durationHours: 2, km: 250, tollKRW: 9000, airportDetourKm: 20 }, // km/toll 무시, detour만
    ];
    for (const c of cases) {
      const fe = feTotal(c);
      const be = beTotal(c);
      expect(fe.amountKRW).toBe(be.amountKRW);
      expect(fe.distanceSurchargeKRW).toBe(be.distanceSurchargeKRW);
      expect(fe.km).toBe(be.km);
      expect(fe.tollKRW).toBe(be.tollKRW);
    }
    expect(feTotal({ serviceType: 'airport', durationHours: 0, airportDetourKm: 15 }).amountKRW).toBe(119000);
  });

  it('최대 시간 한도 동일', () => {
    expect(FE_MAX).toBe(BE_MAX);
    expect(FE_MAX).toBe(15);
  });

  it('거리 추가요금 공식 동일 (여러 km)', () => {
    for (const km of [0, 30, 49, 49.9, 50, 75, 100, 120, 250]) {
      expect(feSurcharge(km)).toBe(beSurcharge(km));
    }
    // 절대값 sanity
    expect(feSurcharge(50)).toBe(30000);
    expect(feSurcharge(100)).toBe(60000);
  });

  it('총액 분해 동일 — 시급×시간 + 거리추가 + 톨비 (여러 케이스)', () => {
    const cases = [
      { serviceType: 'manager' as const, durationHours: 2, km: 100, tollKRW: 5000 },
      { serviceType: 'vehicle' as const, durationHours: 3, km: 20, tollKRW: 0 },
      { serviceType: 'vehicle' as const, durationHours: 1.5, km: 60, tollKRW: 3300 },
      { serviceType: 'manager' as const, durationHours: 8, km: 0, tollKRW: 0 },
      { serviceType: 'manager' as const, durationHours: 5, km: 49, tollKRW: 1000 },
      { serviceType: 'airport' as const, durationHours: 2, km: 60, tollKRW: 3300 },
      { serviceType: 'airport' as const, durationHours: 1, km: 0, tollKRW: 0 },
    ];
    for (const c of cases) {
      const fe = feTotal(c);
      const be = beTotal(c);
      expect(fe.amountKRW).toBe(be.amountKRW);
      expect(fe.baseKRW).toBe(be.baseKRW);
      expect(fe.distanceSurchargeKRW).toBe(be.distanceSurchargeKRW);
      expect(fe.tollKRW).toBe(be.tollKRW);
      expect(fe.km).toBe(be.km);
    }
  });

  it('경로 없음(거리/톨비 0) = base 만 — 톨비/거리 0 폴백', () => {
    const fe = feTotal({ serviceType: 'manager', durationHours: 4 });
    expect(fe.amountKRW).toBe(160000); // 40000 × 4
    expect(fe.distanceSurchargeKRW).toBe(0);
    expect(fe.tollKRW).toBe(0);
    // base helper 와도 일치
    expect(fe.baseKRW).toBe(estimateMoodAmountKRW('manager', 4));
  });

  it('표시 미러는 invalid 입력에 throw 하지 않고 안전 폴백 (ok:false)', () => {
    // @ts-expect-error — 의도적 invalid serviceType
    const r = feTotal({ serviceType: 'bus', durationHours: 2 });
    expect(r.ok).toBe(false);
    expect(r.baseKRW).toBe(0);
    expect(r.amountKRW).toBe(0);
  });
});
