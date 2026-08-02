/**
 * 플랜 판촉 규칙의 단일 기준(src/config/promotionRules.ts) 잠금 테스트. (2026-08-02)
 *
 * 🔒 `PLAN_PROMOTION_LIMITS` 를 상수끼리 비교하면 아무것도 지켜지지 않는다
 *    (숫자를 고치면 테스트도 같이 통과한다). 그래서 여기서는 **실제 `buildSlides()`
 *    결과를 세어** 그 값과 대조한다 — 슬라이드 조립을 바꿔 광고가 늘면 깨진다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { adApplies, PLAN_PROMOTION_LIMITS } from '../../src/config/promotionRules';
import { buildSlides, getOutroExtras } from '../../src/pages/PlanDetailPage/lib/buildSlides';
import type { PlanDocument } from '../../src/pages/PlanDetailPage/types';

/** 최소한의 플랜 — 일정 일수만 바꿔 가며 슬라이드 구성을 확인한다. */
function planWithDays(dayCount: number, input: Record<string, unknown> = {}): PlanDocument {
  return {
    input,
    itinerary: { days: Array.from({ length: dayCount }, (_, i) => ({ day: i + 1 })) },
  } as unknown as PlanDocument;
}

afterEach(() => { vi.useRealTimers(); });

describe('PLAN_PROMOTION_LIMITS — 실제 슬라이드 구성과 대조', () => {
  // 1일~7일 플랜 전부에서 한도가 지켜져야 한다. 예전 사고가 "일수가 늘수록 광고가 늘어난" 것이었다.
  for (const dayCount of [1, 2, 4, 7]) {
    it(`${dayCount}일 플랜 — 중간 광고 슬라이드 0, PreTrip 1, Outro 1`, () => {
      const slides = buildSlides(planWithDays(dayCount));
      const count = (type: string) => slides.filter((s) => s.type === type).length;

      expect(count('ad')).toBe(PLAN_PROMOTION_LIMITS.interruptingSlides);
      expect(count('preTrip')).toBe(PLAN_PROMOTION_LIMITS.preTripSection);
      expect(count('outro')).toBe(PLAN_PROMOTION_LIMITS.outroSection);
      // 일정 슬라이드는 그대로 남아 있어야 한다 (판촉을 줄이다 일정을 지우면 안 된다).
      expect(count('day')).toBe(dayCount);
      // PreTrip 은 일정 뒤, Outro 직전 — 일정 흐름을 끊지 않는다.
      expect(slides.findIndex((s) => s.type === 'preTrip')).toBeGreaterThan(
        slides.map((s) => s.type).lastIndexOf('day'),
      );
      expect(slides[slides.length - 1].type).toBe('outro');
    });
  }
});

describe('adApplies — 이미 해결한 문제를 다시 팔지 않는다', () => {
  it('호텔 주소가 있으면 호텔 판촉을 숨긴다', () => {
    expect(adApplies('hotel', planWithDays(1, { hotel_address: 'Seoul Hotel' }))).toBe(false);
    expect(adApplies('hotel', planWithDays(1))).toBe(true);
  });

  it('출발이 7일 이내면 항공 판촉을 숨긴다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T00:00:00Z'));
    expect(adApplies('flight', planWithDays(1, { startDate: '2026-08-06' }))).toBe(false);
    expect(adApplies('flight', planWithDays(1, { startDate: '2026-08-20' }))).toBe(true);
    // 날짜가 없거나 해석 불가면 막지 않는다 (판단 근거가 없으면 기본 노출).
    expect(adApplies('flight', planWithDays(1))).toBe(true);
    expect(adApplies('flight', planWithDays(1, { startDate: 'not-a-date' }))).toBe(true);
  });

  it('7일 경계는 exclusive — 딱 7일 남은 출발은 숨기고 8일은 보인다', () => {
    vi.useFakeTimers();
    // 기준 시각을 자정에 고정해야 경계가 소수점으로 흔들리지 않는다.
    vi.setSystemTime(new Date('2026-08-02T00:00:00Z'));
    // startDate 는 여행 첫날(inclusive) — 그 날까지 남은 일수를 잰다.
    expect(adApplies('flight', planWithDays(1, { startDate: '2026-08-09' }))).toBe(false); // 정확히 7.0일
    expect(adApplies('flight', planWithDays(1, { startDate: '2026-08-10' }))).toBe(true);  // 8.0일
    // 1박2일·2박3일처럼 짧은 일정도 규칙은 출발일 하나로만 판단한다(일수와 무관).
    expect(adApplies('flight', planWithDays(2, { startDate: '2026-08-09' }))).toBe(false);
    expect(adApplies('flight', planWithDays(3, { startDate: '2026-08-10' }))).toBe(true);
  });

  it('차터를 이미 예약·문의했으면 다시 권하지 않는다', () => {
    expect(adApplies('charter', planWithDays(1, { charter_booked: true }))).toBe(false);
    expect(adApplies('charter', planWithDays(1, { charter_inquiry_id: 'inq-1' }))).toBe(false);
    expect(adApplies('charter', planWithDays(1))).toBe(true);
  });

  it('기차는 다도시 일정에만 노출한다', () => {
    expect(adApplies('train', planWithDays(1, { regions: ['seoul'] }))).toBe(false);
    expect(adApplies('train', planWithDays(1, { regions: ['seoul', 'busan'] }))).toBe(true);
  });

  it('Outro 보조 카드도 같은 규칙을 그대로 따른다', () => {
    // 규칙이 두 벌이 되면 화면마다 다른 광고가 뜬다 — 같은 함수를 쓰는지 확인한다.
    expect(getOutroExtras(planWithDays(2, { hotel_address: 'X', charter_booked: true })))
      .toEqual(['flight', 'carRental']);
  });
});
