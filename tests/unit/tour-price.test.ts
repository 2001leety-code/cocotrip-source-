/**
 * 투어(시간제) 가격 backend SSOT 무결성 가드 (2026-06-02, 운영자 요금 개편 1단계).
 *
 * 운영자 확정 정책: 기본 9h 40.5만 + 오버타임 54,000/h(+20%) + 거리추가(50km당 5만, 30km 이내 0).
 * 운영자 거리추가 예시(파주45→5만 / 여주70·춘천85→10만)를 회귀 고정. 결제가≠표시가 사고 방지.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calcTourKrw, tourDistanceSurcharge, resolveTourCheckoutKrw } from '../../api/_shared/tour-price.js';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

describe('tourDistanceSurcharge — 운영자 예시(50km당 5만, 30km 이내 0)', () => {
  it('서울 시내(0~30km) → 0', () => {
    expect(tourDistanceSurcharge(0)).toBe(0);
    expect(tourDistanceSurcharge(30)).toBe(0);
  });
  it('파주 45km → 5만', () => {
    expect(tourDistanceSurcharge(45)).toBe(50_000);
  });
  it('수원 40km → 5만 / 50km 경계 → 5만', () => {
    expect(tourDistanceSurcharge(40)).toBe(50_000);
    expect(tourDistanceSurcharge(50)).toBe(50_000);
  });
  it('여주 70km·춘천 85km → 10만 (운영자 예시)', () => {
    expect(tourDistanceSurcharge(70)).toBe(100_000);
    expect(tourDistanceSurcharge(85)).toBe(100_000);
  });
  it('51km 경계 → 10만 / 100km → 10만 / 101km → 15만', () => {
    expect(tourDistanceSurcharge(51)).toBe(100_000);
    expect(tourDistanceSurcharge(100)).toBe(100_000);
    expect(tourDistanceSurcharge(101)).toBe(150_000);
  });
  it('속초 210km → 25만 (50km당 +5만)', () => {
    expect(tourDistanceSurcharge(210)).toBe(250_000);
  });
});

describe('calcTourKrw — 기본 9h + 오버타임 + 거리추가 (VAT·쿠폰 전)', () => {
  it('서울 시내 9h staria → 40.5만', () => {
    expect(calcTourKrw({ km: 0, hours: 9, vehicle: 'staria' })).toBe(405_000);
  });
  it('파주 DMZ 45km 9h staria → 40.5만 + 5만 = 45.5만 (운영자 예시)', () => {
    expect(calcTourKrw({ km: 45, hours: 9, vehicle: 'staria' })).toBe(455_000);
  });
  it('춘천 85km 9h staria → 40.5만 + 10만 = 50.5만 (운영자 예시)', () => {
    expect(calcTourKrw({ km: 85, hours: 9, vehicle: 'staria' })).toBe(505_000);
  });
  it('서울 시내 12h staria → 40.5만 + 오버타임 3h×54,000 = 56.7만', () => {
    expect(calcTourKrw({ km: 0, hours: 12, vehicle: 'staria' })).toBe(405_000 + 3 * 54_000);
  });
  it('스프린터: 기본/오버타임은 ×2.0, 거리추가는 정액(무관)', () => {
    // 춘천 85km 9h sprinter = 405,000×2 + 0 + 100,000(정액) = 910,000
    expect(calcTourKrw({ km: 85, hours: 9, vehicle: 'sprinter' })).toBe(405_000 * 2 + 100_000);
  });
  it('9시간 이하/미만 입력 → 오버타임 0 (기본 9h 적용)', () => {
    expect(calcTourKrw({ km: 0, hours: 8, vehicle: 'staria' })).toBe(405_000);
    expect(calcTourKrw({ km: 0, hours: 5, vehicle: 'staria' })).toBe(405_000);
  });
  it('bus/vip/unknown 차종 → null (협의, 즉시결제 불가)', () => {
    expect(calcTourKrw({ km: 50, hours: 9, vehicle: 'bus' })).toBeNull();
    expect(calcTourKrw({ km: 50, hours: 9, vehicle: 'vip' })).toBeNull();
  });
  it('hours 24 초과 cap', () => {
    expect(calcTourKrw({ km: 0, hours: 30, vehicle: 'staria' }))
      .toBe(calcTourKrw({ km: 0, hours: 24, vehicle: 'staria' }));
  });
});

describe('resolveTourCheckoutKrw — 결제 게이트 (플래그 + matrix backend + client 불신)', () => {
  const body = { originKey: 'SEL_METRO', destKey: 'CHUNCHEON', hours: 9, vehicle: 'staria' };

  it('플래그 OFF → null (현행 권역 고정가 유지, prod 기본)', () => {
    expect(resolveTourCheckoutKrw(SPEC, body, false)).toBeNull();
  });

  it('플래그 ON + matrix 목적지(춘천 85km) → 기본9h + 거리추가 = 50.5만', () => {
    // SEL_METRO→CHUNCHEON 85km → calcTourKrw(85,9,staria)=405,000+100,000
    expect(resolveTourCheckoutKrw(SPEC, body, true)).toBe(505_000);
  });

  it('플래그 ON + 시내/matrix 미존재 → 거리추가 0(기본 9h만)', () => {
    expect(resolveTourCheckoutKrw(SPEC, { ...body, destKey: 'VOID_CITY' }, true)).toBe(405_000);
  });

  it('client km/priceKRW 변조 무시 (backend matrix km만)', () => {
    const honest = resolveTourCheckoutKrw(SPEC, body, true);
    const tampered = resolveTourCheckoutKrw(SPEC, { ...body, km: 9999, priceKRW: 1 } as never, true);
    expect(tampered).toBe(honest);
  });

  it('bus/vip → null (협의)', () => {
    expect(resolveTourCheckoutKrw(SPEC, { ...body, vehicle: 'bus' }, true)).toBeNull();
  });

  it('빈 body → null', () => {
    expect(resolveTourCheckoutKrw(SPEC, null, true)).toBeNull();
  });
});
