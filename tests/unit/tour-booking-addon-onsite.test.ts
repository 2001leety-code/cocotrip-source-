/**
 * 투어 애드온 = 무료/현장결제 (운영자 확정 2026-06-30) — 순수 헬퍼 테스트.
 *
 * 배경: 투어 productType(charter_*) 백엔드 createPaypalOrder.resolveKrwAmount 는
 *   `dailyPrice × days` (= baseKRW) 만 청구하고 애드온(한복/카시트/가이드)은 합산하지 않음.
 *   기존 프론트는 totalKRW = baseKRW + addonKRW + slotModifierKRW 로 표시 → 표시가 > 청구가
 *   (P311 위반). 운영자 확정대로 표시에서 애드온을 빼 표시가 == 청구가 정합.
 *
 * 검증 항목:
 *   computeTourBookingTotalKRW (P311 — 표시가 = 청구가):
 *     1. 애드온은 인자에 없음 → base + slot 만 반환 (애드온 미합산).
 *     2. slot 0 이면 base 와 동일.
 *     3. slot 음수(시간대 할인 등)도 그대로 반영.
 *   clampHanbokCount (한복 인원 카운터 0~pax):
 *     4. 범위 내(0~pax)는 그대로.
 *     5. pax 초과는 pax 로 clamp (pax 감소 시).
 *     6. 음수/NaN/Infinity 는 0 으로 방어.
 *     7. 소수는 floor.
 */
import { describe, it, expect } from 'vitest';
import { computeTourBookingTotalKRW, clampHanbokCount } from '../../src/components/tours/tourBookingValidation';

describe('computeTourBookingTotalKRW — P311 표시가=청구가 (애드온 제외)', () => {
  it('1. 애드온 미합산 — base + slot 만 반환', () => {
    // 청구가(백엔드)는 base(=dailyPrice×days)만. 표시 총액도 base + slot 이어야 정합.
    expect(computeTourBookingTotalKRW(160000, 0)).toBe(160000);
  });

  it('2. slot 0 이면 base 와 동일', () => {
    expect(computeTourBookingTotalKRW(249000, 0)).toBe(249000);
  });

  it('3. slot 양수(공항 새벽 등) 반영', () => {
    expect(computeTourBookingTotalKRW(160000, 30000)).toBe(190000);
  });

  it('4. slot 음수(시간대 할인) 반영', () => {
    expect(computeTourBookingTotalKRW(160000, -20000)).toBe(140000);
  });

  it('5. 애드온 금액이 totalKRW 에 절대 새지 않음 (회귀 가드 — 인자 자체가 없음)', () => {
    // 한복 30000/인 × pax 가 있어도 함수 시그니처상 합산 경로가 없음을 명시.
    const base = 200000;
    const slot = 0;
    expect(computeTourBookingTotalKRW(base, slot)).toBe(base);
  });
});

describe('clampHanbokCount — 한복 인원 카운터 (0~pax, 가격 미반영)', () => {
  it('6. 범위 내(0~pax)는 그대로', () => {
    expect(clampHanbokCount(0, 4)).toBe(0);
    expect(clampHanbokCount(2, 4)).toBe(2);
    expect(clampHanbokCount(4, 4)).toBe(4);
  });

  it('7. pax 초과는 pax 로 clamp (pax 감소 시 — 4명→2명)', () => {
    expect(clampHanbokCount(4, 2)).toBe(2);
    expect(clampHanbokCount(10, 3)).toBe(3);
  });

  it('8. 음수/NaN/Infinity 는 0 으로 방어 (비유한값=안전하게 0)', () => {
    expect(clampHanbokCount(-1, 4)).toBe(0);
    expect(clampHanbokCount(NaN, 4)).toBe(0);
    expect(clampHanbokCount(Infinity, 4)).toBe(0); // !Number.isFinite → 0 (방어)
  });

  it('9. 소수는 floor', () => {
    expect(clampHanbokCount(2.9, 4)).toBe(2);
  });

  it('10. pax 0 이면 항상 0', () => {
    expect(clampHanbokCount(3, 0)).toBe(0);
  });
});
