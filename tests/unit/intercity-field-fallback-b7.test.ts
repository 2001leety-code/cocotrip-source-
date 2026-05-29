// ─────────────────────────────────────────────────────────────────────────────
// B7 (P308, 2026-05-30) — intercity_transit 필드명 정합 회귀 테스트
//
// 배경: P291 PR #703 이 Gemini responseSchema 의 intercity_transit 를
//   method/duration_min/cost_krw 로 잘못 명명 → frontend (mode/est_min/est_fare_krw)
//   와 불일치 → 다도시 KTX 카드 빈칸/미노출.
//
// P308 fix:
//   1. schema 를 mode/est_min/est_fare_krw 로 통일 (gemini-schema-p291.test.ts 에서 검증)
//   2. frontend (planToMarkdown / DayTimeline / pdfGenerator) 에 legacy 폴백 추가
//      — P291~P308 사이 저장된 오명명 plan 흡수.
//
// 본 테스트: planToMarkdown (순수 함수) 이 두 필드명 모두 렌더하는지 검증.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { planToMarkdown } from '../../src/pages/PlanDetailPage/lib/planToMarkdown';

function makePlan(intercity: Record<string, unknown>) {
  return {
    itinerary: {
      tour_title: 'Seoul + Busan Trip',
      days: [
        {
          day: 2,
          theme: 'Move to Busan',
          intercity_transit: intercity,
          stops: [],
        },
      ],
    },
    input: { guestName: 'Test', language: 'ko' },
  };
}

describe('B7 (P308) — intercity_transit 필드명 폴백', () => {
  it('신 스키마 (mode/est_min/est_fare_krw) 를 정상 렌더', () => {
    const md = planToMarkdown(
      makePlan({
        from_city: 'Seoul',
        to_city: 'Busan',
        mode: 'KTX',
        est_min: 165,
        est_fare_krw: 59800,
      }) as never,
      { language: 'ko' },
    );
    expect(md).toContain('도시 간 이동');
    expect(md).toContain('KTX');
    expect(md).toContain('165분');
    expect(md).toContain('59,800원');
  });

  it('legacy 오명명 (method/duration_min/cost_krw) 도 폴백으로 렌더', () => {
    // P291~P308 사이 Gemini 가 schema 힌트 따라 저장한 plan 시뮬레이션.
    const md = planToMarkdown(
      makePlan({
        from_city: 'Seoul',
        to_city: 'Busan',
        method: 'KTX',
        duration_min: 165,
        cost_krw: 59800,
      }) as never,
      { language: 'ko' },
    );
    expect(md).toContain('도시 간 이동');
    expect(md).toContain('KTX');     // method → mode 폴백
    expect(md).toContain('165분');   // duration_min → est_min 폴백
    expect(md).toContain('59,800원'); // cost_krw → est_fare_krw 폴백
  });

  it('신 스키마가 legacy 보다 우선 (둘 다 있으면 mode/est_min/est_fare_krw)', () => {
    const md = planToMarkdown(
      makePlan({
        from_city: 'Seoul',
        to_city: 'Busan',
        mode: 'SRT',
        est_min: 150,
        est_fare_krw: 52000,
        // legacy 잔재 (무시되어야 함)
        method: 'KTX',
        duration_min: 999,
        cost_krw: 99999,
      }) as never,
      { language: 'ko' },
    );
    expect(md).toContain('SRT');
    expect(md).toContain('150분');
    expect(md).toContain('52,000원');
    expect(md).not.toContain('999분');
    expect(md).not.toContain('99,999원');
  });

  it('intercity_transit 자체가 없으면 도시 간 이동 섹션 미출력', () => {
    const md = planToMarkdown(
      {
        itinerary: { tour_title: 'Single City', days: [{ day: 1, stops: [] }] },
        input: { guestName: 'Test', language: 'ko' },
      } as never,
      { language: 'ko' },
    );
    expect(md).not.toContain('도시 간 이동');
  });
});
