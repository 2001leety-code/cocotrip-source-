/**
 * 회귀 가드 — 멀티데이 견적 할인 임계값 불일치 수정 (LOW 버그, 2026-06-14)
 *
 * 버그: useQuoteCalculator.ts multi_day 분기가 dayDiff >= 1 (1박=2일)에서 할인을 적용해
 *   백엔드 SSOT (multidayQuote.ts MULTIDAY_DISCOUNT_MIN_DAYS=3, 즉 3일+=2박+) 보다
 *   10% 과도한 할인 표시(2일=1박 견적이 실제 결제가보다 10% 낮게 보임).
 *
 * 수정: dayDiff >= 1 → dayDiff >= 2 (MULTIDAY_DISCOUNT_MIN_NIGHTS=2)
 *   dayDiff = 박수. endDate 는 inclusive(마지막 여행일) → dayDiff = endDate - startDate 일수
 *   체류일(durationDays) = dayDiff + 1
 *   2박 = dayDiff 2 = durationDays 3 = 백엔드 days >= 3 할인 ↔ dayDiff >= 2
 *
 * 고정하는 것:
 *   1. 2박(dayDiff=2) 이상에서만 할인 적용.
 *   2. 1박(dayDiff=1) — 할인 없음 (수정 전 = 10% 적용으로 표시/청구 불일치).
 *   3. 경계 dayDiff=0 — 할인 없음.
 *   4. 3박(dayDiff=3) 이상 — 할인 적용.
 */
import { describe, it, expect } from 'vitest';

// ── 수정된 useQuoteCalculator multi_day 할인 로직 재현 ──
// src/hooks/useQuoteCalculator.ts L341-362 (multi_day 분기)
// 테스트는 훅 내부 순수 연산만 추출해 검증. React 훅 의존성 없음.

const MULTIDAY_DISCOUNT_MIN_NIGHTS = 2; // multidayQuote.ts MULTIDAY_DISCOUNT_MIN_DAYS(3) - 1

function computeMultiDayDiscount(
  baseKRW: number,
  startDate: string,
  endDate: string,
  discountPct = 10,
): { discountKRW: number; discountPercent: number } {
  const dayDiff = startDate && endDate
    ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000)
    : 0;

  if (dayDiff >= MULTIDAY_DISCOUNT_MIN_NIGHTS) {
    const discountKRW = Math.round(baseKRW * (discountPct / 100));
    return { discountKRW, discountPercent: discountPct };
  }
  return { discountKRW: 0, discountPercent: 0 };
}

// ── 테스트 ──

describe('멀티데이 견적 할인 임계값 — dayDiff >= 2 (2박 = 체류 3일)', () => {
  const BASE = 1_000_000; // 100만원 기준

  it('dayDiff=0 (당일/미입력) — 할인 없음', () => {
    const { discountKRW, discountPercent } = computeMultiDayDiscount(BASE, '2026-07-01', '2026-07-01');
    expect(discountKRW).toBe(0);
    expect(discountPercent).toBe(0);
  });

  it('dayDiff=1 (1박=2일) — 할인 없음 [버그 수정 핵심]', () => {
    // 수정 전: dayDiff >= 1 → 10% 할인 적용(표시/청구 불일치)
    // 수정 후: dayDiff >= 2 → 할인 없음 = 백엔드 SSOT 일치
    const { discountKRW, discountPercent } = computeMultiDayDiscount(BASE, '2026-07-01', '2026-07-02');
    expect(discountKRW).toBe(0);
    expect(discountPercent).toBe(0);
  });

  it('dayDiff=2 (2박=3일) — 10% 할인 적용 [경계값 ON]', () => {
    // 백엔드: durationDays=3 >= MULTIDAY_DISCOUNT_MIN_DAYS(3) → 10% 할인
    const { discountKRW, discountPercent } = computeMultiDayDiscount(BASE, '2026-07-01', '2026-07-03');
    expect(discountPercent).toBe(10);
    expect(discountKRW).toBe(100_000); // 1,000,000 × 10%
  });

  it('dayDiff=3 (3박=4일) — 10% 할인 적용', () => {
    const { discountKRW, discountPercent } = computeMultiDayDiscount(BASE, '2026-07-01', '2026-07-04');
    expect(discountPercent).toBe(10);
    expect(discountKRW).toBe(100_000);
  });

  it('dayDiff=6 (6박=7일) — 10% 할인 적용', () => {
    const { discountKRW } = computeMultiDayDiscount(BASE, '2026-07-01', '2026-07-07');
    expect(discountKRW).toBe(100_000);
  });

  it('startDate/endDate 미입력 — 할인 없음 (dayDiff=0 폴백)', () => {
    const { discountKRW } = computeMultiDayDiscount(BASE, '', '');
    expect(discountKRW).toBe(0);
  });

  it('백엔드 MULTIDAY_DISCOUNT_MIN_DAYS 대조: dayDiff === MULTIDAY_DISCOUNT_MIN_NIGHTS - 1 = 할인 없음', () => {
    // dayDiff=1 = durationDays=2 < MULTIDAY_DISCOUNT_MIN_DAYS(3) → 백엔드도 할인 없음
    const { discountKRW } = computeMultiDayDiscount(BASE, '2026-08-10', '2026-08-11');
    expect(discountKRW).toBe(0);
  });

  it('백엔드 MULTIDAY_DISCOUNT_MIN_DAYS 대조: dayDiff === MULTIDAY_DISCOUNT_MIN_NIGHTS = 할인 있음', () => {
    // dayDiff=2 = durationDays=3 >= MULTIDAY_DISCOUNT_MIN_DAYS(3) → 백엔드도 할인 있음
    const { discountKRW } = computeMultiDayDiscount(BASE, '2026-08-10', '2026-08-12');
    expect(discountKRW).toBe(100_000);
  });
});
