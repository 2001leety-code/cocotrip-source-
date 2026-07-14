/**
 * 멀티데이 차터 결제 금액 backend SSOT 무결성 가드 (2026-06-02, OPUS 멀티데이 결제).
 *
 * P311 SAFETY: 결제 금액은 backend 가 SSOT 에서 재계산(client priceKRW 불신). 이 backend
 * 모듈이 프론트 useQuoteCalculator.ts multi_day 공식과 byte-identical 한지 회귀 가드한다.
 * 불일치 시 = 표시 견적가 ≠ 실제 결제가 → 고객 분쟁/금전 사고. 절대 깨지면 안 됨.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calcMultiDayCharterKrw, lookupMatrixKm, resolveMultiDayCheckoutKrw } from '../../api/_shared/charter-multiday-price.js';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

// ── 프론트 src/hooks/useQuoteCalculator.ts multi_day 공식 재현 (L139-142, L255-287) ──
const STARIA_BASE_FEE = 50_000;     // useQuoteCalculator.ts:47
const STARIA_RATE_PER_KM = 1000;    // useQuoteCalculator.ts:48
const VEHICLE_MULTIPLIER: Record<string, number> = { staria: 1.0, sprinter: 2.0 }; // :38

function frontendMultiDay(spec: any, vehicle: string, km: number, tourDays: number): number {
  // calcIntercityFormula (L139-142)
  const staria = STARIA_BASE_FEE + km * 2 * STARIA_RATE_PER_KM;
  const intercity = Math.round(staria * VEHICLE_MULTIPLIER[vehicle]);
  // multi_day 분기 (L261-282)
  const ic = spec.vehicles[vehicle].intercity;
  const nights = Math.max(0, tourDays - 1);
  // 7인승 캡틴시트 프리미엄 정액(SSOT) — 거리부 직후 가산(9인승=0). 백/프론트 calc 와 동일 위치.
  const captain = Number(spec.vehicles[vehicle].captain_premium_krw) > 0 ? Number(spec.vehicles[vehicle].captain_premium_krw) : 0;
  const base = intercity + captain + ic.daily_service_fee * tourDays + ic.overnight_driver_fee * nights;
  // 운영자 정책 2026-06-02: 3일(durationDays>=3) 이상 10% 할인.
  return tourDays >= 3 ? Math.round(base * 0.9) : base;
}

describe('calcMultiDayCharterKrw — 프론트 공식 1:1 일치 (P311 backend SSOT)', () => {
  for (const vehicle of ['staria', 'sprinter']) {
    for (const km of [50, 120, 325, 450]) {
      for (const days of [2, 3, 5, 7]) {
        it(`${vehicle} km=${km} days=${days} → 프론트 == backend`, () => {
          expect(calcMultiDayCharterKrw(SPEC, { vehicle, km, durationDays: days }))
            .toBe(frontendMultiDay(SPEC, vehicle, km, days));
        });
      }
    }
  }

  it('SSOT 일치: STARIA_BASE_FEE(50000)/RATE(1000) == spec.vehicles.staria.intercity (하드코딩 동기화 확인)', () => {
    expect(SPEC.vehicles.staria.intercity.base_fee).toBe(STARIA_BASE_FEE);
    expect(SPEC.vehicles.staria.intercity.rate_per_km).toBe(STARIA_RATE_PER_KM);
  });

  it('3일 이상 10% 할인 (운영자 정책 2026-06-02): 3일=base×0.9, 2일=무할인', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    const ic = SPEC.vehicles.staria.intercity;
    const distancePart = Math.round((STARIA_BASE_FEE + km * 2 * STARIA_RATE_PER_KM) * 1.0);
    // staria 7인 캡틴 프리미엄 정액(33,000) — 거리부 직후 가산(2026-06-30).
    const captain = SPEC.vehicles.staria.captain_premium_krw || 0;
    const base3 = distancePart + captain + ic.daily_service_fee * 3 + ic.overnight_driver_fee * 2;
    const base2 = distancePart + captain + ic.daily_service_fee * 2 + ic.overnight_driver_fee * 1;
    expect(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km, durationDays: 3 })).toBe(Math.round(base3 * 0.9));
    expect(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km, durationDays: 2 })).toBe(base2); // 2일 무할인
  });

  it('알려진 matrix 케이스: ICN→BUSAN staria 3일 (회귀 고정 + 프론트 일치)', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN');
    expect(km).toBeGreaterThan(0);
    const price = calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: km!, durationDays: 3 });
    expect(price).toBe(frontendMultiDay(SPEC, 'staria', km!, 3));
  });

  it('편도 대칭: lookupMatrixKm(A→B) == (B→A) (프론트 rev 폴백 동일)', () => {
    const fwd = lookupMatrixKm(SPEC, 'ICN', 'BUSAN');
    const rev = lookupMatrixKm(SPEC, 'BUSAN', 'ICN');
    if (fwd != null && rev != null) expect(fwd).toBe(rev);
  });

  it('bus/vip → null (inquiry-only, 즉시결제 불가)', () => {
    expect(calcMultiDayCharterKrw(SPEC, { vehicle: 'bus', km: 100, durationDays: 2 })).toBeNull();
    expect(calcMultiDayCharterKrw(SPEC, { vehicle: 'vip', km: 100, durationDays: 2 })).toBeNull();
  });

  it('km 누락/0/음수 → null (client 변조 방어)', () => {
    expect(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: 0, durationDays: 2 })).toBeNull();
    expect(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: -5, durationDays: 2 })).toBeNull();
    expect(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: NaN, durationDays: 2 })).toBeNull();
  });

  it('matrix 미존재 키 → null (custom 목적지 = 결제 불가, WhatsApp 협의 유지)', () => {
    expect(lookupMatrixKm(SPEC, 'NOWHERE', 'VOID')).toBeNull();
  });

  it('durationDays 1~30 cap (거대값/0 방어)', () => {
    const d35 = calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: 100, durationDays: 35 });
    const d30 = calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: 100, durationDays: 30 });
    expect(d35).toBe(d30); // 30 으로 cap
  });
});

describe('resolveMultiDayCheckoutKrw — 결제 핸들러 게이트 (플래그 + matrix + client 불신)', () => {
  const validBody = { originKey: 'ICN', destKey: 'BUSAN', vehicle: 'staria', durationDays: 3 };

  it('플래그 OFF(featureEnabled=false) → null (현행 WhatsApp 협의 유지, prod 기본값)', () => {
    expect(resolveMultiDayCheckoutKrw(SPEC, validBody, false)).toBeNull();
  });

  it('플래그 ON + matrix 키 → 가격 (calcMultiDayCharterKrw 와 동일)', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    expect(resolveMultiDayCheckoutKrw(SPEC, validBody, true))
      .toBe(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km, durationDays: 3 }));
  });

  it('플래그 ON + custom 목적지(matrix 미존재) → null (협의)', () => {
    expect(resolveMultiDayCheckoutKrw(SPEC, { ...validBody, destKey: 'VOID_CITY' }, true)).toBeNull();
  });

  it('플래그 ON + client priceKRW/km 변조 무시 (body 의 km/priceKRW 안 씀)', () => {
    const honest = resolveMultiDayCheckoutKrw(SPEC, validBody, true);
    const tampered = resolveMultiDayCheckoutKrw(SPEC, { ...validBody, km: 99999, priceKRW: 1 } as never, true);
    expect(tampered).toBe(honest); // backend matrix km 만 사용
  });

  it('플래그 ON + bus/vip → null (inquiry-only)', () => {
    expect(resolveMultiDayCheckoutKrw(SPEC, { ...validBody, vehicle: 'bus' }, true)).toBeNull();
  });

  it('빈 body / 키 누락 → null', () => {
    expect(resolveMultiDayCheckoutKrw(SPEC, {}, true)).toBeNull();
    expect(resolveMultiDayCheckoutKrw(SPEC, null, true)).toBeNull();
  });

  it('v2(discountV2=true): 3일+ 기본할인 5% (플래그 ON 시)', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    const v1 = resolveMultiDayCheckoutKrw(SPEC, validBody, true);
    const v2 = resolveMultiDayCheckoutKrw(SPEC, validBody, true, { discountV2: true });
    // v2 = 5% < v1 = 10% (= 더 저렴)
    expect(v2).toBeDefined();
    expect(v2!).toBeGreaterThan(v1!); // 5% 할인 < 10% 할인 → 청구가 더 큼
    expect(v2).toBe(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km, durationDays: 3, discountPct: 5 }));
  });

  it('v2 플래그 OFF(기본)=현행 10% 무영향 (opts 없음 / discountV2=false)', () => {
    const r1 = resolveMultiDayCheckoutKrw(SPEC, validBody, true);
    const r2 = resolveMultiDayCheckoutKrw(SPEC, validBody, true, { discountV2: false });
    const r3 = resolveMultiDayCheckoutKrw(SPEC, validBody, true, {});
    expect(r1).toBe(r2);
    expect(r1).toBe(r3);
  });
});

describe('resolveMultiDayCheckoutKrw — 경유지 routeKm override (FEATURE_CHARTER_WAYPOINTS)', () => {
  const validBody = { originKey: 'ICN', destKey: 'BUSAN', vehicle: 'staria', durationDays: 3 };

  it('opts.routeKm 없음(기본) → matrix km 그대로 (무영향, 무경유 예약)', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    const withMatrix = resolveMultiDayCheckoutKrw(SPEC, validBody, true);
    const explicitNull = resolveMultiDayCheckoutKrw(SPEC, validBody, true, { routeKm: null });
    expect(explicitNull).toBe(withMatrix);
    expect(withMatrix).toBe(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km, durationDays: 3 }));
  });

  it('opts.routeKm(경유지 경로) → matrix 대신 routeKm 으로 계산 (detour 반영)', () => {
    const matrixKm = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    const routeKm = matrixKm + 80; // 경유지로 80km 더 돎
    const priced = resolveMultiDayCheckoutKrw(SPEC, validBody, true, { routeKm });
    expect(priced).toBe(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: routeKm, durationDays: 3 }));
    // detour 가 더 길므로 청구가도 더 큼
    expect(priced!).toBeGreaterThan(resolveMultiDayCheckoutKrw(SPEC, validBody, true)!);
  });

  it('opts.routeKm 는 custom(matrix 미존재) 목적지도 결제 가능케 함 (좌표만 있으면)', () => {
    const custom = { originKey: 'NOWHERE', destKey: 'VOID', vehicle: 'staria', durationDays: 2 };
    expect(resolveMultiDayCheckoutKrw(SPEC, custom, true)).toBeNull(); // matrix 없음 → null
    const withRoute = resolveMultiDayCheckoutKrw(SPEC, custom, true, { routeKm: 210 });
    expect(withRoute).toBe(calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km: 210, durationDays: 2 }));
  });

  it('opts.routeKm 0/음수/NaN → 무시하고 matrix 폴백 (방어)', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    const expected = calcMultiDayCharterKrw(SPEC, { vehicle: 'staria', km, durationDays: 3 });
    expect(resolveMultiDayCheckoutKrw(SPEC, validBody, true, { routeKm: 0 })).toBe(expected);
    expect(resolveMultiDayCheckoutKrw(SPEC, validBody, true, { routeKm: -10 })).toBe(expected);
    expect(resolveMultiDayCheckoutKrw(SPEC, validBody, true, { routeKm: NaN })).toBe(expected);
  });
});
