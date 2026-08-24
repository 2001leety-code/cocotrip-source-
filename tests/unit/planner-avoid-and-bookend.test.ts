// 2026-08-24 (planner-intent-v1 server follow-up): locks the avoid-list removal
// semantics (exact match, reindex, protected markers, fail-closed empty day,
// assert-only final stage, recommended_restaurants filtering) and the 1-day
// conflicting-bookend fail-closed gate. See CLAUDE.md .claude/rules for why
// these are safety-relevant (dietary/money boundaries are separate files —
// this one is about "the traveller paid a revision credit to remove a place").
import { describe, it, expect } from 'vitest';
import {
  isAvoidedStop,
  filterAvoidedStops,
  removeAvoidedStopsOrThrow,
  assertNoAvoidedStopsRemain,
  filterAvoidedRestaurantBuckets,
  AVOID_UNSATISFIABLE_CODE,
} from '../../api/_ai_core/avoidStops.js';
import { normalizePlannerIntentV1, avoidKey } from '../../api/_shared/plannerIntentV1.js';

function stop(overrides: Record<string, unknown> = {}) {
  return { category: 'attraction', name: '경복궁', order: 1, ...overrides };
}

describe('isAvoidedStop — exact match only', () => {
  it('matches the exact normalized name', () => {
    expect(isAvoidedStop(stop({ name: '경복궁' }), ['경복궁'])).toBe(true);
  });

  it('does NOT match on substring containment either direction', () => {
    // avoided = "경복궁", stop = "경복궁 근처 카페" — must NOT be removed.
    expect(isAvoidedStop(stop({ name: '경복궁 근처 카페' }), ['경복궁'])).toBe(false);
    // avoided = "광장시장 근처 노점", stop = "광장시장" — must NOT be removed.
    expect(isAvoidedStop(stop({ name: '광장시장' }), ['광장시장근처노점'])).toBe(false);
  });

  it('NFKC/case-fold still absorbs punctuation-only spelling variance', () => {
    // Same name, different separator — normalization makes both sides equal.
    expect(isAvoidedStop(stop({ name: '광장 시장' }), [avoidKey('광장시장')])).toBe(true);
  });

  it('does NOT match a translated-suffix variant (exact-match tradeoff)', () => {
    // 2026-08-24: exact equality (no substring) was chosen deliberately to stop
    // over-removal (avoiding "명동" must not also strip "명동교자") — the cost is
    // that a Gemini re-emission with an appended English translation, e.g.
    // "광장시장 (Gwangjang Market)", is no longer caught by name-matching alone.
    expect(isAvoidedStop(stop({ name: '광장시장 (Gwangjang Market)' }), [avoidKey('광장시장')])).toBe(false);
  });

  it('never matches protected categories', () => {
    expect(isAvoidedStop(stop({ category: 'lodging', name: '경복궁' }), ['경복궁'])).toBe(false);
    expect(isAvoidedStop(stop({ category: 'airport', name: '경복궁' }), ['경복궁'])).toBe(false);
    expect(isAvoidedStop(stop({ category: 'travel', name: '경복궁' }), ['경복궁'])).toBe(false);
  });
});

describe('filterAvoidedStops — removal + reindex', () => {
  it('removes the avoided stop and reindexes remaining order 1..n', () => {
    const itinerary = {
      days: [{
        day: 1,
        stops: [
          { category: 'lodging', name: 'Hotel', order: 1 },
          { category: 'attraction', name: '경복궁', order: 2 },
          { category: 'food', name: '광장시장', order: 3 },
          { category: 'lodging', name: 'Hotel', order: 4 },
        ],
      }],
    };
    const result = filterAvoidedStops(itinerary, ['경복궁']);
    expect(result.removed).toBe(1);
    expect(result.invalidDays).toEqual([]);
    expect(itinerary.days[0].stops.map((s: { name: string }) => s.name)).toEqual(['Hotel', '광장시장', 'Hotel']);
    expect(itinerary.days[0].stops.map((s: { order: number }) => s.order)).toEqual([1, 2, 3]);
  });

  it('fails closed when removal leaves a day with zero activity stops', () => {
    const itinerary = {
      days: [{
        day: 2,
        stops: [
          { category: 'lodging', name: 'Hotel', order: 1 },
          { category: 'attraction', name: '경복궁', order: 2 },
          { category: 'lodging', name: 'Hotel', order: 3 },
        ],
      }],
    };
    const result = filterAvoidedStops(itinerary, ['경복궁']);
    expect(result.invalidDays).toHaveLength(1);
    expect(result.invalidDays[0].day).toBe(2);
  });

  it('never removes lodging/airport/travel markers', () => {
    const itinerary = {
      days: [{
        day: 1,
        stops: [
          { category: 'lodging', name: '경복궁', order: 1 },
          { category: 'attraction', name: '남산타워', order: 2 },
        ],
      }],
    };
    const result = filterAvoidedStops(itinerary, ['경복궁']);
    expect(result.removed).toBe(0);
    expect(itinerary.days[0].stops).toHaveLength(2);
  });
});

describe('removeAvoidedStopsOrThrow', () => {
  it('throws AVOID_UNSATISFIABLE_CODE / 422 on an empty resulting day', () => {
    const itinerary = {
      days: [{
        day: 1,
        stops: [
          { category: 'lodging', name: 'Hotel', order: 1 },
          { category: 'attraction', name: '경복궁', order: 2 },
        ],
      }],
    };
    expect(() => removeAvoidedStopsOrThrow(itinerary, ['경복궁'], 'test')).toThrow();
    try {
      removeAvoidedStopsOrThrow(itinerary, ['경복궁'], 'test');
    } catch (e) {
      const err = e as { code?: string; statusCode?: number };
      expect(err.code).toBe(AVOID_UNSATISFIABLE_CODE);
      expect(err.statusCode).toBe(422);
    }
  });

  it('is a no-op when avoidStopNames is empty', () => {
    const itinerary = { days: [{ day: 1, stops: [stop()] }] };
    const result = removeAvoidedStopsOrThrow(itinerary, [], 'test');
    expect(result.removed).toBe(0);
    expect(itinerary.days[0].stops).toHaveLength(1);
  });
});

describe('assertNoAvoidedStopsRemain — final stage, never mutates', () => {
  it('throws (does not remove) when an avoided stop is still present', () => {
    const itinerary = { days: [{ day: 1, stops: [stop({ name: '경복궁' })] }] };
    expect(() => assertNoAvoidedStopsRemain(itinerary, ['경복궁'], 'test')).toThrow();
    // no mutation — the throw is the only effect.
    expect(itinerary.days[0].stops).toHaveLength(1);
  });

  it('passes silently when nothing avoided remains', () => {
    const itinerary = { days: [{ day: 1, stops: [stop({ name: '남산타워' })] }] };
    expect(() => assertNoAvoidedStopsRemain(itinerary, ['경복궁'], 'test')).not.toThrow();
  });
});

describe('filterAvoidedRestaurantBuckets', () => {
  it('filters an avoided restaurant out of every bucket without mutating the input', () => {
    const buckets = {
      general: [{ name: '경복궁 맛집', category: 'food' }, { name: '다른 식당', category: 'food' }],
      vegan: [{ name: '경복궁 맛집', category: 'food' }],
    };
    const out = filterAvoidedRestaurantBuckets(buckets, ['경복궁 맛집']);
    expect(out.general.map((r: { name: string }) => r.name)).toEqual(['다른 식당']);
    expect(out.vegan).toEqual([]);
    expect(buckets.general).toHaveLength(2); // original untouched
  });
});

describe('1-day conflicting arrival/departure — fails closed', () => {
  it('throws when durationDays=1 and arrival/departure cities differ (explicit v1)', () => {
    const body = {
      planner_intent_v1: {
        cityKeys: ['seoul', 'busan'],
        arrivalCityKey: 'seoul',
        departureCityKey: 'busan',
      },
    };
    const legacyShaped = { durationDays: 1, startDate: '2026-09-01', pax: 2 };
    expect(() => normalizePlannerIntentV1(body, legacyShaped)).toThrow(/departureCityKey/);
  });

  it('does not throw when arrival === departure on a 1-day trip', () => {
    const body = {
      planner_intent_v1: {
        cityKeys: ['seoul'],
        arrivalCityKey: 'seoul',
        departureCityKey: 'seoul',
      },
    };
    const legacyShaped = { durationDays: 1, startDate: '2026-09-01', pax: 2 };
    expect(() => normalizePlannerIntentV1(body, legacyShaped)).not.toThrow();
  });

  it('does not throw for multi-day trips with differing bookends', () => {
    const body = {
      planner_intent_v1: {
        cityKeys: ['seoul', 'busan'],
        arrivalCityKey: 'seoul',
        departureCityKey: 'busan',
      },
    };
    const legacyShaped = { durationDays: 5, startDate: '2026-09-01', pax: 2 };
    const intent = normalizePlannerIntentV1(body, legacyShaped);
    expect(intent.arrivalCityKey).toBe('seoul');
    expect(intent.departureCityKey).toBe('busan');
  });
});
