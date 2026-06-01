/**
 * PR-C2 (2026-06-01): Charter CTA per-day real-route prefill -- feature flag.
 *
 * Source: src/pages/PlanDetailPage/lib/charterCtaPrefill.ts
 *
 * Covers:
 *   (a) Flag OFF (unset) -> hardcoded URL (origin=SEL_METRO, service=day_tour) byte-identical
 *   (b) Flag ON + busan plan.input.area -> destinationKey=busan-day
 *   (c) Flag ON + day.city=jeju -> no mapping -> falls back to detectedTourType
 *   (d) Flag ON + unmapped region + no detectedTourType -> destinationKey absent (origin preserved)
 *   (e) regionToDestinationKey -- per-region case verification
 *   (f) extractDayRegion -- day.city priority, planInput.area fallback
 *   (g) Flag ON + pax/date prefill
 *
 * NOTE: imports only the pure module (charterCtaPrefill.ts).
 *   Direct import of CharterCTA component is FORBIDDEN
 *   (firebase/React pulls crash CI with "0 test" -- R_Phase1 guard pattern).
 */
import { describe, it, expect } from 'vitest';

import {
  buildCharterCTAUrl,
  extractDayRegion,
  regionToDestinationKey,
  type DayLike,
  type PlanInputLike,
} from '../../src/pages/PlanDetailPage/lib/charterCtaPrefill';

// -- helpers --
function parseQS(url: string): URLSearchParams {
  const idx = url.indexOf('?');
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '');
}

function makeDay(overrides: Partial<DayLike> = {}): DayLike {
  return { day: 2, date: '2026-07-15', ...overrides };
}

// -- (a) Flag OFF -- hardcoded byte-identical --
describe('Flag OFF -- hardcoded fallback', () => {
  it('origin=SEL_METRO, service=day_tour fixed', () => {
    const result = buildCharterCTAUrl({
      day: makeDay(),
      featureEnabled: false,
    });
    expect(result.isRealRoute).toBe(false);
    const qs = parseQS(result.url);
    expect(qs.get('origin')).toBe('SEL_METRO');
    expect(qs.get('service')).toBe('day_tour');
    expect(qs.get('from')).toBe('planDetail');
  });

  it('detectedTourType present -> destinationKey included', () => {
    const result = buildCharterCTAUrl({
      day: makeDay({ day: 3 }),
      detectedTourType: 'seoul-city',
      pricingHours: 8,
      featureEnabled: false,
    });
    const qs = parseQS(result.url);
    expect(qs.get('destinationKey')).toBe('seoul-city');
    expect(qs.get('hours')).toBe('8');
  });

  it('day number reflected in query', () => {
    const result = buildCharterCTAUrl({
      day: makeDay({ day: 5 }),
      featureEnabled: false,
    });
    const qs = parseQS(result.url);
    expect(qs.get('day')).toBe('5');
  });
});

// -- (b) Flag ON + busan plan.input.area -> busan-day --
describe('Flag ON -- busan plan.input.area', () => {
  it('destinationKey=busan-day, isRealRoute=true', () => {
    const planInput: PlanInputLike = { area: 'busan', adults: 2 };
    const result = buildCharterCTAUrl({
      day: makeDay(),
      planInput,
      featureEnabled: true,
    });
    expect(result.isRealRoute).toBe(true);
    const qs = parseQS(result.url);
    expect(qs.get('destinationKey')).toBe('busan-day');
    expect(qs.get('pax')).toBe('2');
  });

  it('day.city=busan also maps to busan-day', () => {
    const result = buildCharterCTAUrl({
      day: makeDay({ city: 'busan' }),
      featureEnabled: true,
    });
    const qs = parseQS(result.url);
    expect(qs.get('destinationKey')).toBe('busan-day');
  });
});

// -- (c) Flag ON + jeju -- no mapping -> detectedTourType fallback --
describe('Flag ON -- jeju fallback', () => {
  it('jeju unmapped -> falls back to detectedTourType', () => {
    const result = buildCharterCTAUrl({
      day: makeDay({ city: 'jeju' }),
      detectedTourType: 'seoul-city',
      featureEnabled: true,
    });
    expect(result.isRealRoute).toBe(true);
    const qs = parseQS(result.url);
    // jeju has no mapping -> use detectedTourType
    expect(qs.get('destinationKey')).toBe('seoul-city');
  });

  it('jeju + no detectedTourType -> destinationKey absent', () => {
    const result = buildCharterCTAUrl({
      day: makeDay({ city: 'jeju' }),
      featureEnabled: true,
    });
    const qs = parseQS(result.url);
    expect(qs.get('destinationKey')).toBeNull();
    // origin is still preserved
    expect(qs.get('origin')).toBe('SEL_METRO');
  });
});

// -- (d) Fully unmapped region + no detectedTourType -> no destinationKey --
describe('Flag ON -- fully unmapped region', () => {
  it('gwangju unmapped + no tourType -> no destinationKey', () => {
    const result = buildCharterCTAUrl({
      day: makeDay({ city: 'gwangju' }),
      featureEnabled: true,
    });
    const qs = parseQS(result.url);
    expect(qs.get('destinationKey')).toBeNull();
    expect(qs.get('origin')).toBe('SEL_METRO');
    expect(qs.get('service')).toBe('day_tour');
  });
});

// -- (e) regionToDestinationKey per-region cases --
describe('regionToDestinationKey mapping table', () => {
  const cases: Array<[string, string | undefined]> = [
    ['seoul', 'seoul-city'],
    ['seoul_city', 'seoul-city'],
    ['incheon', 'seoul-city'],
    ['suwon', 'seoul-suburb'],
    ['dmz', 'dmz'],
    ['gangwon', 'gangwon'],
    ['gangneung', 'gangwon'],
    ['sokcho', 'gangwon'],
    ['chuncheon', 'gangwon'],
    ['pyeongchang', 'ski-resort'],
    ['ski', 'ski-resort'],
    ['gyeongju', 'gyeongju-jeonju'],
    ['jeonju', 'gyeongju-jeonju'],
    ['busan', 'busan-day'],
    ['yeosu', 'busan-day'],
    ['daegu', 'busan-day'],
    ['jeju', undefined],      // no operator charter product
    ['gwangju', undefined],   // unregistered
    ['andong', undefined],    // unregistered
  ];

  for (const [region, expected] of cases) {
    it(`${region} => ${expected !== undefined ? expected : 'undefined'}`, () => {
      expect(regionToDestinationKey(region)).toBe(expected);
    });
  }

  it('undefined input => undefined', () => {
    expect(regionToDestinationKey(undefined)).toBe(undefined);
  });
});

// -- (f) extractDayRegion priority --
describe('extractDayRegion -- day.city priority', () => {
  it('day.city present -> use it first', () => {
    const day = makeDay({ city: 'Busan' });
    const result = extractDayRegion(day, { area: 'seoul' });
    expect(result).toBe('busan'); // lowercased
  });

  it('no day.city -> fallback to planInput.area', () => {
    const day = makeDay({ city: undefined });
    const result = extractDayRegion(day, { area: 'Gangwon' });
    expect(result).toBe('gangwon');
  });

  it('both absent -> undefined', () => {
    const day = makeDay({ city: undefined });
    const result = extractDayRegion(day, undefined);
    expect(result).toBeUndefined();
  });

  it('spaces converted to underscores', () => {
    const day = makeDay({ city: 'Seoul City' });
    const result = extractDayRegion(day);
    expect(result).toBe('seoul_city');
  });
});

// -- (g) pax / date prefill --
describe('Flag ON -- pax and date prefill', () => {
  it('adults prefilled as pax', () => {
    const result = buildCharterCTAUrl({
      day: makeDay({ date: '2026-08-01' }),
      planInput: { adults: 4 },
      featureEnabled: true,
    });
    const qs = parseQS(result.url);
    expect(qs.get('pax')).toBe('4');
    expect(qs.get('date')).toBe('2026-08-01');
  });

  it('planInput.pax used as alternative', () => {
    const result = buildCharterCTAUrl({
      day: makeDay(),
      planInput: { pax: 3 },
      featureEnabled: true,
    });
    const qs = parseQS(result.url);
    expect(qs.get('pax')).toBe('3');
  });

  it('no pax -> omitted from query', () => {
    const result = buildCharterCTAUrl({
      day: makeDay(),
      planInput: {},
      featureEnabled: true,
    });
    const qs = parseQS(result.url);
    expect(qs.get('pax')).toBeNull();
  });
});
