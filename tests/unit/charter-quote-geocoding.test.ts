// charter-quote-geocoding — 정책 B (2026-05-07/08 사용자 확정) 검증
//
// 정책 B 흐름 (zone fallback 폐기 — 충청권 평균 200km로 모든 도시 균일 가격이 비현실적):
//   1. spec.daily_tour_prices key 매칭 → 기존 가격 (priceKRW × 차량 배수)
//   2. distance_matrix lookup → entry.priceKRW 우선, 없으면 km 기반 staria 공식
//   3. matrix miss → Geocoding API → calcSimpleByVehicle (km × 차량별 단순 공식)
//   4. Geocoding 실패 / 차량 협의 → null 또는 needsCustomQuote
//
// 본 파일은 동기 진입점 calculateQuote (=calculateQuoteWithKm with externalKm=null) 와
// 공용 가격 함수 calcSimpleByVehicle / tollEstimate 를 검증한다.
// 비동기 useQuoteCalculator 훅은 fetch 의존 — Playwright e2e 에서 커버.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../src/hooks/useQuoteCalculator';
import { calcSimpleByVehicle, tollEstimate } from '../../src/lib/calculator';
import type { WizardState } from '../../src/components/charter/types';

const baseState: WizardState = {
  vehicle: 'staria',
  paxCount: 4,
  adultCount: 4,
  childCount: 0,
  options: {},
};

// ─────────────────────────────────────────────────────────
// 1) calculateQuote — matrix / package hit 우선
// ─────────────────────────────────────────────────────────

describe('calculateQuote — matrix priceKRW 우선 (airport_transfer)', () => {
  it('ICN→강남: ICN→SEL_GANGNAM 매트릭스 priceKRW 145,600 그대로', () => {
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
    // staria 7인 캡틴 +33,000: 145,600 + 33,000 = 178,600 (2026-06-30).
    expect(q!.subtotalKRW).toBe(178_600);
    expect(q!.source).toBe('matrix');
  });

  it('ICN→서울 시내: ICN→SEL_METRO priceKRW 124,800', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '서울',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    // staria 7인 캡틴 +33,000: 124,800 + 33,000 = 157,800.
    expect(q!.subtotalKRW).toBe(157_800);
    expect(q!.source).toBe('matrix');
  });

  it('제주(JEJU_METRO): 도선료 별도 → needsCustomQuote', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '제주',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    // 제주는 매트릭스/airport_transfer_prices 미존재 + zone fallback 폐기 → needsCustomQuote
    expect(q!.needsCustomQuote).toBe(true);
  });
});

describe('calculateQuote — day_tour 매트릭스 hit', () => {
  it('경주 패키지(destinationKey="gyeongju-jeonju"): DAILY_TOUR_PRICES 600k SSOT', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      destinationKey: 'gyeongju-jeonju',
      origin: 'SEL_METRO',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    // staria 7인 캡틴 +33,000: 600,000 + 33,000 = 633,000.
    expect(q!.subtotalKRW).toBe(633_000);
    expect(q!.source).toBe('package');
  });

  it('SEL_METRO→GYEONGJU 매트릭스 km=370: km 기반 staria 공식 (50k+370×2×1k=790k)', () => {
    // destinationKey 없이 destinationCustom='경주'만 있을 때 → matrixLookup → km 기반
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '경주',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 50,000 + 370km × 2 × 1000 = 790,000 (왕복 모델) + staria 7인 캡틴 33,000 = 823,000.
    expect(q!.subtotalKRW).toBe(823_000);
    expect(q!.source).toBe('formula');
  });
});

describe('calculateQuote — multi_day 매트릭스 hit + 10% 할인', () => {
  it('여수 2박3일 from 서울: 1,485k (매트릭스 km=370)', () => {
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
    // 매트릭스 SEL_METRO→YEOSU 370km — calcIntercityFormula = 50k + 370×2×1000 = 790k
    // + staria 7인 캡틴 33k + daily 200k×3 = 600k + overnight 100k×2 = 200k → 1,623k
    // -10% 할인 → 1,460,700 (2026-07-14 숙박료 10만원).
    expect(q!.subtotalKRW).toBe(1_460_700);
    expect(q!.multiDayDiscountPercent).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────
// 2) calculateQuote — matrix miss + 좌표/Geocoding 미보유
//                   → needsCustomQuote (정책 B 4단계)
// ─────────────────────────────────────────────────────────

describe('calculateQuote — matrix miss + 외부 km 없음 → needsCustomQuote', () => {
  it('단양(매트릭스 미존재): 매트릭스 miss + externalKm null → needsCustomQuote', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '단양',
      startDate: '2026-04-29',
      startTime: '17:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(true);
  });

  it('포항(매트릭스 미존재): day_tour matrix miss → needsCustomQuote', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '포항',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(true);
  });

  it('알 수 없는 도시: needsCustomQuote', () => {
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

// ─────────────────────────────────────────────────────────
// 3) calculateQuote — Bus/VIP → 결제 불가, 항상 needsCustomQuote
// ─────────────────────────────────────────────────────────

describe('calculateQuote — Bus 는 항상 needsCustomQuote (협의 폼), staria_9 는 결제 가능', () => {
  it('Bus + 매트릭스 hit 도시(강남): needsCustomQuote=true', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'bus',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationCustom: '강남',
      startDate: '2026-04-29',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(true);
    // vehicleChargeKRW은 0 — 가격 노출 X
    expect(q!.vehicleChargeKRW).toBe(0);
  });

  it('staria_9(9인승) + day_tour: 결제 가능(needsCustomQuote=false) + 캡틴 0 = 현 staria 원가', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria_9',
      service: 'day_tour',
      destinationKey: 'gyeongju-jeonju',
      origin: 'SEL_METRO',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 9인승 = 캡틴 0 → 패키지 원가 600,000 그대로.
    expect(q!.vehicleChargeKRW).toBe(600_000);
  });
});

// ─────────────────────────────────────────────────────────
// 4) calcSimpleByVehicle — 정책 B 차량별 단순 공식
// ─────────────────────────────────────────────────────────

describe('calcSimpleByVehicle — 정책 B (matrix miss → Geocoding km × 공식)', () => {
  it('Staria 100km: 50,000 + 100×2,000 = 250,000 + toll(100×100=10,000)', () => {
    const r = calcSimpleByVehicle('staria', 100);
    expect(r).not.toBeNull();
    expect(r!.breakdown.base).toBe(50_000);
    expect(r!.breakdown.perKm).toBe(200_000);
    expect(r!.toll).toBe(10_000);
    expect(r!.total).toBe(260_000);
    expect(r!.krw).toBe(260_000);
  });

  it('Sprinter 100km: 100,000 + 100×4,000 = 500,000 + toll(100×100=10,000)', () => {
    const r = calcSimpleByVehicle('sprinter', 100);
    expect(r).not.toBeNull();
    expect(r!.breakdown.base).toBe(100_000);
    expect(r!.breakdown.perKm).toBe(400_000);
    expect(r!.toll).toBe(10_000);
    expect(r!.total).toBe(510_000);
  });

  it('Bus → null (협의 폼 트리거)', () => {
    expect(calcSimpleByVehicle('bus', 100)).toBeNull();
  });

  it('staria_9(9인승) → staria 와 동일 (자동 견적, 캡틴 프리미엄은 formula 밖)', () => {
    const s9 = calcSimpleByVehicle('staria_9', 100);
    const s7 = calcSimpleByVehicle('staria', 100);
    expect(s9).not.toBeNull();
    expect(s9!.krw).toBe(s7!.krw); // 9인승 거리공식 = staria
  });

  it('음수 km은 0 처리', () => {
    const r = calcSimpleByVehicle('staria', -10);
    expect(r).not.toBeNull();
    expect(r!.breakdown.perKm).toBe(0);
    expect(r!.toll).toBe(0);
    expect(r!.total).toBe(50_000);
  });

  it('NaN km은 0 처리', () => {
    const r = calcSimpleByVehicle('staria', NaN);
    expect(r).not.toBeNull();
    expect(r!.total).toBe(50_000);
  });
});

// ─────────────────────────────────────────────────────────
// 5) tollEstimate — 정책 B 단계별 톨비
//   km <  50  → 0
//   50–199 km → km × 100
//   km >= 200 → km × 150
// ─────────────────────────────────────────────────────────

describe('tollEstimate — 정책 B 거리 구간별 톨비', () => {
  it('km < 50 → 0 (시내 한정)', () => {
    expect(tollEstimate(0)).toBe(0);
    expect(tollEstimate(30)).toBe(0);
    expect(tollEstimate(49)).toBe(0);
  });

  it('50 ≤ km < 200 → km × 100 (도시간 단거리)', () => {
    expect(tollEstimate(50)).toBe(5_000);
    expect(tollEstimate(100)).toBe(10_000);
    expect(tollEstimate(199)).toBe(19_900);
  });

  it('km ≥ 200 → km × 150 (장거리 고속도로)', () => {
    expect(tollEstimate(200)).toBe(30_000);
    expect(tollEstimate(370)).toBe(55_500);
    expect(tollEstimate(420)).toBe(63_000);
  });

  it('음수/NaN은 0', () => {
    expect(tollEstimate(-50)).toBe(0);
    expect(tollEstimate(NaN)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────
// 6) VAT/할인 기본값 — pricing_spec.json 동기화 회귀 방지
// ─────────────────────────────────────────────────────────

describe('calculateQuote — VAT 표기 + day_tour 다일 할인 미적용', () => {
  it('VAT 정보 — pricing_spec.json 동기화 (vatPercent=10)', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '경주',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q!.vatPercent).toBe(10);
  });

  it('day_tour 는 multi-day 할인 미적용', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      origin: 'SEL_METRO',
      destinationCustom: '경주',
      startDate: '2026-04-29',
      startTime: '08:00',
    });
    expect(q!.multiDayDiscountKRW).toBe(0);
    expect(q!.multiDayDiscountPercent).toBe(0);
  });
});
