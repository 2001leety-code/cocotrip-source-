/**
 * PR #466 — Audit X-H8 regression slot.
 *
 * Pre-fix: api/_ai_core/dbMatcher.js's three-tier matcher checked
 * `city` only in the 3rd tier (chain brand). The 1st (exact name)
 * and 2nd (partial name) tiers ignored city entirely. Common chain
 * names like "본가" / "원조김밥" exist in many cities — a Seoul plan
 * stop named "본가" would silently get the Busan-branch's address +
 * lat/lng written onto it. The map link took the user to the wrong
 * city. Symptom for users: they travel toward the address on the
 * plan and arrive at a completely different city.
 *
 * Post-fix:
 *  1. `findFoodIndexMatch(foodIndex, name, displayName, cityFilter)`
 *     extracted helper that applies the city filter to ALL THREE
 *     tiers when cityFilter is provided.
 *  2. `applyDBMatcher` calls it once with the requested city. If no
 *     match, it falls back to a no-city call — but if THAT match's
 *     city differs from the requested city, the stop is flagged
 *     `_db_city_mismatch` and the DB's address/lat/lng/mapUrl are
 *     NOT overwritten (Gemini's intent is preserved so the user
 *     isn't led to the wrong city).
 *  3. Per-call summary tracks city-mismatch count + samples. When
 *     the mismatch ratio crosses 30% (with at least 3 matched
 *     food stops, to filter tiny-plan noise), an admin Telegram
 *     alert fires dedup'd by requested city.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/dbMatcher.js'),
  'utf8',
);

const alertCalls: any[] = [];
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async (args: any) => {
    alertCalls.push(args);
    return { ok: true, alerted: true };
  }),
}));

import { applyDBMatcher } from '../../api/_ai_core/dbMatcher.js';

type Stop = any;
function foodStop(name: string, extras: Record<string, any> = {}): Stop {
  return { category: 'food', name, address: `Gemini address for ${name}`, ...extras };
}
function makePlan(stops: Stop[]) {
  return { days: [{ day: 1, stops }] };
}

describe('PR #466 X-H8 — same-city match preferred over other-city', () => {
  beforeEach(() => { alertCalls.length = 0; });

  it('exact-name match in DIFFERENT city is flagged + address preserved', () => {
    const stop = foodStop('본가');
    const itinerary = makePlan([stop]);
    const foodIndex = [
      { name: '본가', city: 'busan', address: 'Busan address', lat: 35.1, lng: 129.0, googleMapsUrl: 'https://maps?busan' },
    ];
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(stop._db_city_mismatch).toEqual({ dbCity: 'busan', requestedCity: 'seoul' });
    expect(stop.address).toBe('Gemini address for 본가'); // NOT overwritten
    expect(stop.lat).toBeUndefined(); // NOT overwritten
    expect(stop.lng).toBeUndefined();
    expect(stop.googleMapsUrl).toBeUndefined();
    expect(stop.verified).toBe(false); // city-mismatch ≠ fully verified
    expect(stop._dbMatchedName).toBe('본가');
  });

  it('exact-name match in SAME city overrides address + coords (happy path)', () => {
    const stop = foodStop('본가');
    const itinerary = makePlan([stop]);
    const foodIndex = [
      { name: '본가', city: 'seoul', address: '서울 강남 본가 주소', lat: 37.5, lng: 127.0, googleMapsUrl: 'https://maps?seoul' },
      { name: '본가', city: 'busan', address: 'Busan address', lat: 35.1, lng: 129.0 },
    ];
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(stop._db_city_mismatch).toBeUndefined();
    expect(stop.address).toBe('서울 강남 본가 주소'); // Seoul match overrode
    expect(stop.lat).toBe(37.5);
    expect(stop.lng).toBe(127.0);
    expect(stop.verified).toBe(true);
  });

  it('partial-name match in DIFFERENT city is flagged (X-H8 specifically targeted tier 2)', () => {
    const stop = foodStop('맛있는 본가 강남점');
    const itinerary = makePlan([stop]);
    const foodIndex = [
      { name: '본가', city: 'busan', address: 'Busan', lat: 35.1, lng: 129.0 },
    ];
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(stop._db_city_mismatch).toEqual({ dbCity: 'busan', requestedCity: 'seoul' });
    expect(stop.lat).toBeUndefined();
  });

  it('chain-brand match in DIFFERENT city is flagged (covers BHC-Busan when Seoul plan)', () => {
    const stop = foodStop('BHC 치킨 해운대점');
    const itinerary = makePlan([stop]);
    const foodIndex = [
      { name: 'BHC 해운대점', city: 'busan', address: 'Busan', lat: 35.1, lng: 129.0 },
    ];
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(stop._db_city_mismatch).toEqual({ dbCity: 'busan', requestedCity: 'seoul' });
  });

  it('no city provided (legacy/edge) → no mismatch flag even for cross-city match', () => {
    const stop = foodStop('본가');
    const itinerary = makePlan([stop]);
    const foodIndex = [
      // address must start with a Korean city for the legacy override regex to fire.
      { name: '본가', city: 'busan', address: '부산 해운대구 본가 주소', lat: 35.1, lng: 129.0 },
    ];
    applyDBMatcher(itinerary, foodIndex, '', 'ko');
    // When matchCity is empty, all results count as same-city (no mismatch to detect).
    expect(stop._db_city_mismatch).toBeUndefined();
    expect(stop.address).toBe('부산 해운대구 본가 주소'); // legacy fallback override
    expect(stop.lat).toBe(35.1);
    expect(stop.verified).toBe(true);
  });

  it('no match at all → unmatched + no flag + no alert', () => {
    const stop = foodStop('완전히 새로운 식당');
    const itinerary = makePlan([stop]);
    const foodIndex = [
      { name: '본가', city: 'seoul', address: 'Seoul' },
    ];
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(stop.verified).toBe(false);
    expect(stop._db_city_mismatch).toBeUndefined();
    expect(alertCalls.length).toBe(0);
  });
});

describe('PR #466 X-H8 — admin alert fires when mismatch ratio crosses threshold', () => {
  beforeEach(() => { alertCalls.length = 0; });

  function plan(N: number, busanRatio: number) {
    // N total food stops, busanRatio of them get a Busan-only DB entry.
    const stops: Stop[] = [];
    const foodIndex: any[] = [];
    const busanCount = Math.round(N * busanRatio);
    for (let i = 0; i < N; i++) {
      const name = `식당-${i}`;
      stops.push(foodStop(name));
      if (i < busanCount) {
        foodIndex.push({ name, city: 'busan', address: 'Busan' });
      } else {
        foodIndex.push({ name, city: 'seoul', address: 'Seoul' });
      }
    }
    return { itinerary: { days: [{ day: 1, stops }] }, foodIndex };
  }

  it('5 matches / 2 mismatches (40%) → alert fires', () => {
    const { itinerary, foodIndex } = plan(5, 0.4);
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].key).toBe('dbmatcher-city-mismatch:seoul');
    expect(alertCalls[0].channel).toBe('admin');
    expect(alertCalls[0].severity).toBe('high');
    expect(alertCalls[0].message).toMatch(/city-mismatch/);
    expect(alertCalls[0].message).toMatch(/40%/);
  });

  it('P180 (2026-05-24): 10 matches / 2 mismatches (20%) → ALERT (threshold 30%→20% 강화 + >= 변경)', () => {
    const { itinerary, foodIndex } = plan(10, 0.2);
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].message).toMatch(/20%/);
  });

  it('P180: 10 matches / 1 mismatch (10%) → NO alert (below 20%)', () => {
    const { itinerary, foodIndex } = plan(10, 0.1);
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(alertCalls.length).toBe(0);
  });

  it('2 matches / 2 mismatches (100% but BELOW MIN=3) → NO alert (tiny-plan edge)', () => {
    const { itinerary, foodIndex } = plan(2, 1.0);
    applyDBMatcher(itinerary, foodIndex, 'seoul', 'ko');
    expect(alertCalls.length).toBe(0);
  });

  it('alert dedup is per-city (busan plan and seoul plan are separate signals)', () => {
    const { itinerary: i1, foodIndex: f1 } = plan(5, 0.6);
    applyDBMatcher(i1, f1, 'seoul', 'ko');
    // Different city — different dedup bucket.
    const { itinerary: i2, foodIndex: f2 } = plan(5, 0.6);
    // Swap the cities so Seoul-only entries become other-city for a busan plan.
    f2.forEach((r: any) => { r.city = r.city === 'seoul' ? 'jeju' : r.city; });
    applyDBMatcher(i2, f2, 'busan', 'ko');
    expect(alertCalls.map((a) => a.key).sort()).toEqual([
      'dbmatcher-city-mismatch:busan',
      'dbmatcher-city-mismatch:seoul',
    ]);
  });
});

describe('PR #466 X-H8 — source-level invariants', () => {
  it('imports throttledTelegramAlert', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/);
  });

  it('declares the canonical threshold constants (P180: 0.3 → 0.2 강화)', () => {
    expect(src).toMatch(/CITY_MISMATCH_RATIO_THRESHOLD\s*=\s*0\.2\b/);
    expect(src).toMatch(/CITY_MISMATCH_MIN_MATCHES\s*=\s*3/);
    // 30% 회귀 차단
    expect(src).not.toMatch(/CITY_MISMATCH_RATIO_THRESHOLD\s*=\s*0\.3\b/);
  });

  it('extracts findFoodIndexMatch helper with cityFilter parameter', () => {
    expect(src).toMatch(/function\s+findFoodIndexMatch\s*\(\s*foodIndex\s*,\s*stopName\s*,\s*stopDisplayName\s*,\s*cityFilter\s*\)/);
  });

  it('cityOk filter applies to ALL THREE tiers (cityOk(r) check)', () => {
    // Count cityOk references in the helper — must appear in 1차/2차/3차.
    const helper = src.slice(src.indexOf('function findFoodIndexMatch'), src.indexOf('export function applyDBMatcher'));
    const matches = helper.match(/cityOk\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('applyDBMatcher calls findFoodIndexMatch twice: with city then without', () => {
    expect(src).toMatch(/findFoodIndexMatch\(foodIndex,\s*stopName,\s*stopDisplayName,\s*matchCity\)/);
    expect(src).toMatch(/findFoodIndexMatch\(foodIndex,\s*stopName,\s*stopDisplayName,\s*null\)/);
  });

  it('city-mismatch path skips address/lat/lng/mapUrl override', () => {
    // address override guarded by !isCityMismatch
    expect(src).toMatch(/if\s*\(\s*match\.address\s*&&\s*!isCityMismatch\s*\)/);
    // coord/url block also guarded
    expect(src).toMatch(/if\s*\(\s*!isCityMismatch\s*\)\s*\{[\s\S]*?match\.lat[\s\S]*?match\.googleMapsUrl/);
  });

  it('stop is annotated _db_city_mismatch with both cities', () => {
    expect(src).toMatch(/stop\._db_city_mismatch\s*=\s*\{[\s\S]*?dbCity[\s\S]*?requestedCity/);
  });

  it('alert key follows canonical dedup form', () => {
    // P114 (2026-05-20): per-day matchCity 도입으로 alert key 는 trip-level
    // tripMatchCity 사용. matchCity (구 변수명) 또는 tripMatchCity (신 변수명)
    // 둘 다 허용 — 기존 PR #466 호환 + P114 호환.
    expect(src).toMatch(/dbmatcher-city-mismatch:\$\{(matchCity|tripMatchCity)\s*\|\|\s*['"]unknown['"]\}/);
  });

  it('alert is fire-and-forget (.catch swallow)', () => {
    expect(src).toMatch(/throttledTelegramAlert\(\{[\s\S]*?dbmatcher-city-mismatch[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });

  it('city-mismatched stop has verified=false (NOT verified for requested city)', () => {
    expect(src).toMatch(/stop\.verified\s*=\s*!isCityMismatch/);
  });
});
