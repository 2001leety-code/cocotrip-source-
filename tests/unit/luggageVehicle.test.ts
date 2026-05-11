/**
 * 캐리어 → 차량 수 동적 룰 검증 (2026-05-10 prod 검증 받아적기)
 *
 * 운영자 확정 룰:
 *   1-7개 → 1대 (Staria)
 *   8개 이상 → 2대
 *   14개 이상 → 3대
 *   +6 마다 +1대 (선형)
 *
 * 함수: vehicleCount = total <= 7 ? 1 : Math.ceil((total - 7) / 6) + 1
 */
import { describe, it, expect } from 'vitest';
import { calcVehicleCount } from '../../src/lib/luggageVehicle';

describe('calcVehicleCount — 캐리어 합계 → 차량 수', () => {
  it.each([
    [0, 1],   // 0개 → 1대 (input 기본)
    [1, 1],   // 1개 → 1대
    [7, 1],   // 7개 → 1대 (cutoff)
    [8, 2],   // 8개 → 2대
    [13, 2],  // 13개 → 2대 (8+5)
    [14, 3],  // 14개 → 3대 (8+6)
    [19, 3],  // 19개 → 3대 (14+5)
    [20, 4],  // 20개 → 4대 (14+6)
    [25, 4],  // 25개 → 4대 (20+5)
    [26, 5],  // 26개 → 5대 (20+6)
  ])('luggage=%i → %i vehicles', (total, expected) => {
    expect(calcVehicleCount(total)).toBe(expected);
  });

  it('음수/NaN/Infinity 방어 — 모두 1대 처리 (입력 무결성)', () => {
    expect(calcVehicleCount(-1)).toBe(1);
    expect(calcVehicleCount(NaN)).toBe(1);
    expect(calcVehicleCount(Infinity)).toBe(1);
    expect(calcVehicleCount(-100)).toBe(1);
  });

  it('cutoff 경계 (7 ↔ 8) 정확', () => {
    expect(calcVehicleCount(7)).toBe(1);
    expect(calcVehicleCount(8)).toBe(2);
  });

  it('+6 증분 정확 (선형 룰 검증)', () => {
    // 8 → 2대 시작. +6 마다 +1.
    expect(calcVehicleCount(8)).toBe(2);
    expect(calcVehicleCount(14)).toBe(3);  // +6
    expect(calcVehicleCount(20)).toBe(4);  // +12
    expect(calcVehicleCount(26)).toBe(5);  // +18
    expect(calcVehicleCount(32)).toBe(6);  // +24
  });
});
