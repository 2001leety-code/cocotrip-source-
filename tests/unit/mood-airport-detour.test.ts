/**
 * 공항 경유 우회거리 요금 배선 불변식 (2026-07-05 운영자).
 *
 * 규칙: 공항 직행 = 11만 정액. 경유 1개+ = 11만 + (경유포함 − 직행)km × 600원.
 * 잘못되면 과다/과소 청구라 소스 불변식 + 순수함수 경계값을 잠근다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('공항 우회거리 — 백엔드 배선 불변식', () => {
  it('mood-book.js: 공항+경유 시 via/direct 2회 측정해 우회거리 산출', () => {
    const src = readFileSync(resolve(__dirname, '../../api/mood-book.js'), 'utf8');
    // 공항 분기에서 경유 포함/직행 각각 computeRoute 호출
    expect(src).toMatch(/if \(isFixedPrice\)/);
    expect(src).toMatch(/computeRoute\(\{ origin, destination, waypoints \}\)/);
    expect(src).toMatch(/computeRoute\(\{ origin, destination \}\)/); // 직행(경유 제외)
    expect(src).toMatch(/airportDetourKm = Math\.max\(0, viaRoute\.km - directRoute\.km\)/);
    // computeMoodTotalKRW 에 airportDetourKm 전달
    expect(src).toMatch(/computeMoodTotalKRW\(\{[^}]*airportDetourKm/s);
  });

  it('실패 폴백 — via/direct 둘 중 하나라도 실패면 우회요금 제외(정액만, 과소청구 안전측)', () => {
    const src = readFileSync(resolve(__dirname, '../../api/mood-book.js'), 'utf8');
    // detour 는 0 으로 초기화되고, 성공 시에만 대입 (실패 시 정액 유지)
    expect(src).toMatch(/let airportDetourKm = 0/);
    expect(src).toMatch(/if \(viaRoute\.ok && directRoute\.ok\)/);
  });
});

describe('공항 우회거리 — 순수함수 경계값', () => {
  it('computeAirportDetourSurchargeKRW: 우회분 첫 km부터 600원, 임계값 없음', async () => {
    const { computeAirportDetourSurchargeKRW } = await import('../../api/_shared/mood-pricing.js');
    expect(computeAirportDetourSurchargeKRW(0)).toBe(0);
    expect(computeAirportDetourSurchargeKRW(1)).toBe(600);
    expect(computeAirportDetourSurchargeKRW(15)).toBe(9000);
    expect(computeAirportDetourSurchargeKRW(49)).toBe(29400); // 50km 임계값 없음 (차량과 다름)
    expect(computeAirportDetourSurchargeKRW(-5)).toBe(0);     // 음수(경유가 더 짧음) 방어
    expect(computeAirportDetourSurchargeKRW(NaN)).toBe(0);
  });

  it('공항 예시 시나리오 — 집→용산역→공항: 우회 15km면 119,000원', async () => {
    const { computeMoodTotalKRW } = await import('../../api/_shared/mood-pricing.js');
    // 직행 50km, 경유포함 65km → 우회 15km
    const detour = 65 - 50;
    const r = computeMoodTotalKRW({ serviceType: 'airport', durationHours: 0, airportDetourKm: detour });
    expect(r.amountKRW).toBe(110000 + 15 * 600);
    expect(r.amountKRW).toBe(119000);
  });
});
