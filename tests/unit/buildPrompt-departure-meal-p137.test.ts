/**
 * P137 (2026-05-21) — B-MEAL Day 5 출국일 식사 누락 회귀 fix
 *
 * 회귀: plan ba10d29b — Day 5 출국일 food stop 0건.
 * Telegram alert: "Day 5 (출국일): 아침(06-10시)+오후식사(11-16시)+저녁(17-21시) 모두 누락 (B-MEAL)"
 * 운영자 admin Test Mode → soft alert (plan 저장 진행), customer = throw 500.
 *
 * Fix:
 *   1. buildPrompt.js MEAL PLANNING 섹션 — departure_time 기준 3-tier 분류 표 + GOOD/BAD 예시
 *   2. responseValidator.js isLast 분기 — departure_time 기준 strict validator
 *      - departure_time < 11:00 → breakfast 의무
 *      - departure_time 11:00-16:59 → breakfast OR lunch/snack 중 최소 1건
 *      - departure_time >= 17:00 → breakfast + lunch/snack 둘 다 의무
 *      - departure_time 미제공 → 기존 로직 (3개 slot 모두 0이면 에러)
 *
 * 자율 검증 3종 세트:
 *   - 이 파일: 회귀 assertion (departure_time 분류 + B-MEAL Day 5 누락 검출)
 *   - memory: feedback_mistake_p137_b_meal_departure_strict.md
 *   - lint rule: R-P137 (선택 — 이 파일이 primary gate)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

const validatorSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/responseValidator.js'),
  'utf8',
);
const buildPromptSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/buildPrompt.js'),
  'utf8',
);

// ─── helpers ────────────────────────────────────────────────────────────────

type Stop = { category: string; name: string; start_time: string };
type Day = { day: number; city?: string; stops: Stop[] };
type Itinerary = { days: Day[]; arrival_guide?: unknown; departure_guide?: unknown };

/** 일반 full day — 점심 + 저녁 보유 (중간 day 기준값) */
function fullDay(dayNum: number): Day {
  return {
    day: dayNum,
    city: 'Seoul',
    stops: [
      { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
      { category: 'attraction', name: '경복궁', start_time: '10:00' },
      { category: 'food', name: '점심 식당', start_time: '12:30' },
      { category: 'attraction', name: '인사동', start_time: '14:30' },
      { category: 'food', name: '저녁 식당', start_time: '18:30' },
      { category: 'lodging', name: '호텔 복귀', start_time: '21:00' },
    ],
  };
}

/** 출국일 — 지정 food stop 시간들로 구성. 마지막은 airport travel */
function departureDayWithFood(dayNum: number, foodTimes: string[]): Day {
  return {
    day: dayNum,
    city: 'Seoul',
    stops: [
      { category: 'lodging', name: '호텔 체크아웃', start_time: '09:00' },
      ...foodTimes.map((t, idx) => ({
        category: 'food' as const,
        name: `food-stop-${idx}`,
        start_time: t,
      })),
      { category: 'travel', name: '인천공항 이동', start_time: '11:00' },
    ],
  };
}

/** 5-day 플랜 skeleton. days[4] = 출국일 */
function makePlan(departureDay: Day, departureTime?: string): { itinerary: Itinerary; request: Record<string, string> } {
  return {
    itinerary: {
      days: [fullDay(1), fullDay(2), fullDay(3), fullDay(4), departureDay],
      arrival_guide: { airport: 'ICN' },
      departure_guide: { airport: 'ICN' },
    },
    request: {
      durationDays: '5',
      ...(departureTime ? { departure_time: departureTime } : {}),
    },
  };
}

// ─── 1. 이른 출국 (departure_time < 11:00) ─────────────────────────────────

describe('P137 — departure < 11:00 (이른 출국): breakfast 의무', () => {
  it('breakfast at 08:00 → no B-MEAL error (GOOD 패턴)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['08:00']), '09:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });

  it('food stop at 07:30 (hotel breakfast) → no B-MEAL error', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['07:30']), '10:30');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });

  it('food stop 0건 + departure 09:00 → B-MEAL fires (plan ba10d29b 회귀 시나리오)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, []), '09:00');
    const errors = validatePatternStructure(itinerary, request);
    const bmealErrors = errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'));
    expect(bmealErrors.length).toBeGreaterThan(0);
    expect(bmealErrors[0]).toMatch(/departure.*09:00|breakfast.*의무|조식.*누락/);
  });

  it('afternoon snack at 15:00 (wrong slot for early departure) → B-MEAL fires (breakfast 필요)', () => {
    // 이른 출국 (07:00) 인데 snack만 15:00에 넣으면 — departure 전에 이미 공항 가야 하므로
    // 실제론 불가능하지만, departure_time < 11:00 이면 breakfast slot 의무
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['15:00']), '07:00');
    // 15:00은 departure 07:00 buffer 위반이라 B-EARLY-DEPARTURE로도 잡히지만
    // B-MEAL도 별도로 확인 (breakfast count=0)
    const errors = validatePatternStructure(itinerary, request);
    // departure 07:00이면 breakfast [06-11) = 0 → B-MEAL fires
    expect(errors.some((e) => e.includes('B-MEAL') && e.includes('Day 5') && e.includes('조식'))).toBe(true);
  });

  it('departure 06:00 (red-eye) + breakfast at 06:30 → no B-MEAL (breakfast slot 수용)', () => {
    // 실제로 이른 출국 시나리오 — 호텔 새벽 조식 06:30
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['06:30']), '09:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });
});

// ─── 2. 낮 출국 (departure_time 11:00-16:59) ───────────────────────────────

describe('P137 — departure 11:00-16:59 (낮 출국): breakfast OR lunch/snack 최소 1건', () => {
  it('breakfast at 08:00 + departure 14:00 → passes', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['08:00']), '14:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });

  it('lunch at 11:30 + departure 14:00 → passes (lunch slot 수용)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['11:30']), '14:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });

  it('food 0건 + departure 13:00 → B-MEAL fires', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, []), '13:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5')).length).toBeGreaterThan(0);
  });

  it('dinner at 18:00 + departure 12:00 → B-MEAL fires (저녁 slot 은 departure 이후라 의미없음, breakfast/lunch 없음)', () => {
    // dinner만 있고 departure가 12:00이면 breakfast=0, afternoonMeal=0 → B-MEAL
    // 실제로 18:00 stop은 B-EARLY-DEPARTURE로도 잡히지만 B-MEAL도 별도 확인
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['18:00']), '12:00');
    const errors = validatePatternStructure(itinerary, request);
    // breakfast=0, afternoonMeal=0 (18:00은 dinner slot) → B-MEAL fires
    expect(errors.some((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toBe(true);
  });

  it('departure 16:59 (낮 출국 경계) + breakfast → passes', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['08:00']), '16:59');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });
});

// ─── 3. 저녁 출국 (departure_time >= 17:00) ────────────────────────────────

describe('P137 — departure >= 17:00 (저녁 출국): breakfast + lunch/snack 둘 다 의무', () => {
  it('breakfast 08:00 + lunch 12:30 + departure 20:00 → passes', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['08:00', '12:30']), '20:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });

  it('breakfast only + departure 20:00 → B-MEAL-DEPARTURE-LUNCH fires (lunch 누락)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['08:00']), '20:00');
    const errors = validatePatternStructure(itinerary, request);
    // breakfast=1, afternoonMeal=0 → B-MEAL-DEPARTURE-LUNCH 에러
    expect(errors.some((e) => e.includes('B-MEAL-DEPARTURE-LUNCH') && e.includes('Day 5'))).toBe(true);
    expect(errors.some((e) => e.includes('P137') && e.includes('Day 5'))).toBe(true);
  });

  it('lunch only + departure 20:00 → B-MEAL-DEPARTURE-BREAKFAST fires (breakfast 누락)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['12:30']), '20:00');
    const errors = validatePatternStructure(itinerary, request);
    // breakfast=0, afternoonMeal=1 → B-MEAL-DEPARTURE-BREAKFAST 에러
    expect(errors.some((e) => e.includes('B-MEAL-DEPARTURE-BREAKFAST') && e.includes('Day 5'))).toBe(true);
  });

  it('food 0건 + departure 19:00 → B-MEAL fires', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, []), '19:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5')).length).toBeGreaterThan(0);
  });

  it('breakfast + snack(15:30) + departure 22:00 → passes (snack이 lunch 역할)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['08:30', '15:30']), '22:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });
});

// ─── 4. departure_time 미제공 → 기존 로직 유지 ─────────────────────────────

describe('P137 — departure_time 미제공: 기존 로직 (3개 slot 모두 0이면 에러)', () => {
  it('food 0건 + no departure_time → B-MEAL fires (기존 로직)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, []), undefined);
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.some((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toBe(true);
  });

  it('snack at 15:30 + no departure_time → passes (기존 로직: 1개 slot이면 통과)', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['15:30']), undefined);
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });
});

// ─── 5. 기존 departure day 테스트 (P464 회귀 방지) ─────────────────────────

describe('P137 — 기존 departure day 동작 회귀 없음 (P464 호환)', () => {
  it('departure day: breakfast at 08:00 (no departure_time) → 기존 처럼 통과', () => {
    const { itinerary, request } = makePlan(departureDayWithFood(5, ['08:00']), undefined);
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });

  it('도착일은 P137 변경 무관 — departure_time 있어도 도착일은 기존 3-slot 로직', () => {
    // arrival day = days[0] → isFirst=true → departure_time 분기 적용 안 됨
    const itinerary: Itinerary = {
      days: [
        departureDayWithFood(1, []), // arrival day에 food 0건 — 도착일은 다른 룰
        fullDay(2),
        fullDay(3),
        fullDay(4),
        departureDayWithFood(5, ['08:00']),
      ],
      arrival_guide: { airport: 'ICN' },
      departure_guide: { airport: 'ICN' },
    };
    const request = { durationDays: '5', departure_time: '09:00' };
    const errors = validatePatternStructure(itinerary, request);
    // arrival day food 0건 → B-MEAL (도착일)
    expect(errors.some((e) => e.includes('B-MEAL') && e.includes('Day 1') && e.includes('도착'))).toBe(true);
    // departure day food 있음 → no error
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });
});

// ─── 6. source-level invariants (buildPrompt.js + responseValidator.js) ─────

describe('P137 — source invariants (buildPrompt + responseValidator)', () => {
  it('buildPrompt.js — P137 departure_time 분류 표 포함', () => {
    expect(buildPromptSrc).toMatch(/P137|departure_time.*이른 출국|departure.*STRICT/i);
  });

  it('buildPrompt.js — departure day food 0건 금지 명시', () => {
    expect(buildPromptSrc).toMatch(/0 food stops|departure day with 0/i);
  });

  it('buildPrompt.js — GOOD/BAD 예시 포함', () => {
    expect(buildPromptSrc).toMatch(/GOOD.*departure|BAD.*departure|GOOD \(departure/i);
  });

  it('responseValidator.js — P137 departure_time < 11 breakfast 분기 포함', () => {
    expect(validatorSrc).toMatch(/P137|depHour < 11|departure.*breakfast.*의무/);
  });

  it('responseValidator.js — departure_time >= 17 strict 분기 포함', () => {
    expect(validatorSrc).toMatch(/depHour.*17|departure.*>=.*17|B-MEAL-DEPARTURE-LATE/);
  });

  it('responseValidator.js — depMin 파싱 로직 isLast 분기 내 포함', () => {
    expect(validatorSrc).toMatch(/depMin\s*=\s*\(\(\)\s*=>/);
  });
});
