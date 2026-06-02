/**
 * 멀티데이 견적 프론트(src/lib/multidayQuote) == 백엔드(api/_shared/charter-multiday-price) SSOT 일치 가드
 * (2026-06-02, 멀티데이 결제 wiring). 표시 견적가 ≠ 결제가 = 고객 분쟁/금전 사고 → 절대 깨지면 안 됨 (P311).
 *
 * 이 테스트는 두 pricing_spec(프론트 src/data/pricing_spec.json ↔ 백엔드 api/_pricing_spec.json)의
 * vehicles.*.intercity 동기화까지 자동 가드한다 (프론트 lib 은 VEHICLE_INTERCITY=프론트 spec, 백엔드는 api spec).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calcMultiDayCharterKrw as feMultiday, calcMultiDayQuote as feQuote } from '../../src/lib/multidayQuote';
import { calcMultiDayCharterKrw as beMultiday, lookupMatrixKm } from '../../api/_shared/charter-multiday-price.js';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

describe('멀티데이 견적 — 프론트 == 백엔드 (byte-identical, 3일+ 10% 할인 포함)', () => {
  for (const vehicle of ['staria', 'sprinter']) {
    for (const km of [50, 120, 325, 450]) {
      for (const days of [2, 3, 5, 7]) {
        it(`${vehicle} km=${km} days=${days} → 일치`, () => {
          expect(feMultiday({ vehicle, km, durationDays: days }))
            .toBe(beMultiday(SPEC, { vehicle, km, durationDays: days }));
        });
      }
    }
  }

  it('알려진 matrix 케이스 ICN→BUSAN staria 3일 (프론트 == 백엔드)', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    expect(km).toBeGreaterThan(0);
    expect(feMultiday({ vehicle: 'staria', km, durationDays: 3 }))
      .toBe(beMultiday(SPEC, { vehicle: 'staria', km, durationDays: 3 }));
  });

  it('bus/vip → null (inquiry-only, 즉시결제 불가)', () => {
    expect(feMultiday({ vehicle: 'bus', km: 100, durationDays: 2 })).toBeNull();
    expect(feMultiday({ vehicle: 'vip', km: 100, durationDays: 2 })).toBeNull();
  });

  it('km 0/음수/NaN → null (client 변조 방어)', () => {
    expect(feMultiday({ vehicle: 'staria', km: 0, durationDays: 2 })).toBeNull();
    expect(feMultiday({ vehicle: 'staria', km: -5, durationDays: 2 })).toBeNull();
    expect(feMultiday({ vehicle: 'staria', km: NaN, durationDays: 2 })).toBeNull();
  });

  it('durationDays 1~30 cap (거대값 방어, 프론트 == 백엔드)', () => {
    expect(feMultiday({ vehicle: 'staria', km: 100, durationDays: 35 }))
      .toBe(feMultiday({ vehicle: 'staria', km: 100, durationDays: 30 }));
    expect(feMultiday({ vehicle: 'staria', km: 100, durationDays: 35 }))
      .toBe(beMultiday(SPEC, { vehicle: 'staria', km: 100, durationDays: 35 }));
  });

  it('3일 이상 10% 할인 (운영자 정책 2026-06-02): 2일=무할인, 3일=base×0.9, 프론트==백엔드', () => {
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    // 2일: 할인 0 (base == total)
    const q2 = feQuote({ vehicle: 'staria', km, durationDays: 2 })!;
    expect(q2.discountPct).toBe(0);
    expect(q2.discount).toBe(0);
    expect(q2.total).toBe(q2.base);
    expect(q2.total).toBe(beMultiday(SPEC, { vehicle: 'staria', km, durationDays: 2 }));
    // 3일: base×0.9, 프론트 lib total == 백엔드
    const q3 = feQuote({ vehicle: 'staria', km, durationDays: 3 })!;
    expect(q3.discountPct).toBe(10);
    expect(q3.total).toBe(Math.round(q3.base * 0.9));
    expect(q3.total).toBe(beMultiday(SPEC, { vehicle: 'staria', km, durationDays: 3 }));
  });
});
