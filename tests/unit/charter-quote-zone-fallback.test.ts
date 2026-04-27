// useQuoteCalculator/calculateQuote — 권역 fallback + 매트릭스 hit 통합 시나리오
// 각 권역 대표 도시로 모든 mode (airport_transfer/day_tour/multi_day) 검증.
// 단양 PaymentPanel 버그(P1) 회귀 방지 + 다른 지역도 동일하게 동작하는지 보증.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../src/hooks/useQuoteCalculator';
import type { WizardState } from '../../src/components/charter/types';

// 기본 state — 각 테스트가 override
const baseState: WizardState = {
  vehicle: 'staria',
  paxCount: 4,
  adultCount: 4,
  childCount: 0,
  options: {},
};

describe('calculateQuote — airport_transfer 권역 fallback', () => {
  it('단양 (충청권 fallback): destinationCustom + ICN → 450k 추정', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '단양',
      startDate: '2026-04-29',
      startTime: '17:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 50,000 + 200km × 2 × 1000 = 450,000
    expect(q!.vehicleChargeKRW).toBe(450_000);
    expect(q!.subtotalKRW).toBe(450_000);
  });

  it('포항 (영남권 fallback): ICN → 890k 추정', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '포항',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 50,000 + 420km × 2 × 1000 = 890,000
    expect(q!.subtotalKRW).toBe(890_000);
  });

  it('광주 (호남권 fallback): ICN → 790k 추정', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '광주',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 50,000 + 370km × 2 × 1000 = 790,000
    expect(q!.subtotalKRW).toBe(790_000);
  });

  it('강남 (custom 입력): ICN → 매트릭스 hit 145,600', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '강남',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // ICN→SEL_GANGNAM 매트릭스 priceKRW = 145,600
    expect(q!.subtotalKRW).toBe(145_600);
  });

  it('제주 (도선료 별도): ICN → needsCustomQuote', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '제주',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(true);
    expect(q!.subtotalKRW).toBe(0);
  });

  it('알 수 없는 도시: ICN → needsCustomQuote', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '존재하지않는지역명',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(true);
  });
});

describe('calculateQuote — day_tour 권역 fallback', () => {
  it('단양 day_tour from Seoul: 450k', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '단양',
      startDate: '2026-04-29',
      startTime: '09:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    expect(q!.subtotalKRW).toBe(450_000);
  });

  it('포항 day_tour from Seoul: 890k', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '포항',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    expect(q!.subtotalKRW).toBe(890_000);
  });

  it('경주 (매트릭스): destinationKey="gyeongju-jeonju" → 600k SSOT', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      destinationKey: 'gyeongju-jeonju',
      origin: 'SEL_METRO',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    expect(q!.subtotalKRW).toBe(600_000);
  });

  it('제주 day_tour: zone fallback null → needsCustomQuote', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '제주',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(true);
  });
});

describe('calculateQuote — multi_day 권역 fallback (-10% 할인)', () => {
  it('여수 2박3일 from Seoul: 1,488k (호남권 매트릭스 매핑)', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '여수',
      startDate: '2026-04-29',
      endDate: '2026-05-01',
      startTime: '08:00',
      lodgingLocation: 'local',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 매트릭스 SEL_METRO→YEOSU 370km
    // intercity = 50k + 370×2×1000 = 790k
    // + daily 200k×3 = 600k + overnight 130k×2 = 260k = 1,650k
    // -10% 할인 = 165k → 1,485k
    expect(q!.subtotalKRW).toBe(1_485_000);
    expect(q!.multiDayDiscountPercent).toBe(10);
  });

  it('단양 2박3일 (충청권 fallback): 1,179k', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '단양',
      startDate: '2026-04-29',
      endDate: '2026-05-01',
      startTime: '08:00',
      lodgingLocation: 'local',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 200km × 2 × 1000 + 50k = 450k + 200×3 + 130×2 = 1,310k → -10% = 1,179k
    expect(q!.subtotalKRW).toBe(1_179_000);
  });

  it('포항 2박3일 (영남권 fallback): 1,575k', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '포항',
      startDate: '2026-04-29',
      endDate: '2026-05-01',
      startTime: '08:00',
      lodgingLocation: 'local',
    });
    expect(q).not.toBeNull();
    // 420km × 2 × 1000 + 50k = 890k + 200×3 + 130×2 = 1,750k → -10% = 1,575k
    expect(q!.subtotalKRW).toBe(1_575_000);
  });

  it('제주 2박3일 + lodgingLocation=seoul: needsCustomQuote (정책 차단)', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '제주',
      startDate: '2026-04-29',
      endDate: '2026-05-01',
      startTime: '08:00',
      lodgingLocation: 'seoul', // 제주는 'local'만 허용
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(true);
  });

  it('1박2일 (단양): 858k (200km × 2 + 50k = 450k + 200×2 + 130×1 = 980k → -10% = 882k)', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '단양',
      startDate: '2026-04-29',
      endDate: '2026-04-30',
      startTime: '08:00',
      lodgingLocation: 'local',
    });
    expect(q).not.toBeNull();
    // 450k + 400k + 130k = 980k → -10% = 882k
    expect(q!.subtotalKRW).toBe(882_000);
  });
});

describe('calculateQuote — VAT/할인 기본값', () => {
  it('VAT 별도 표기 정상 노출', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '단양',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q!.vatExcluded).toBe(true);
    expect(q!.vatPercent).toBe(10);
  });

  it('day_tour는 multi-day 할인 미적용', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '단양',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q!.multiDayDiscountKRW).toBe(0);
    expect(q!.multiDayDiscountPercent).toBe(0);
  });
});
