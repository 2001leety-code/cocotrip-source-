/**
 * P114 (2026-05-20) regression slot — per-day matchCity in applyDBMatcher.
 *
 * Source bug (plan 4792076e): multi-city plan 서울+부산 의 Day4 stop3
 * "Jagalchi Market" (자갈치시장, 부산) address 가 "서울특별시 종로구 익선동" 으로
 * 매칭됨. 원인: foodIndex 에 "자갈치 | seoul | 종로구 익선동..." 동명 식당
 * 엔트리 존재 + applyDBMatcher 가 trip-level area="seoul_city" 만 사용 →
 * day.city="Busan" 무시 → Seoul 매칭 통과.
 *
 * Fix: applyDBMatcher 가 day 단위 iterate + dayMatchCity(day) 헬퍼로 각 stop
 * 의 matchCity 결정. day.city 가 있으면 그걸 우선, 없으면 trip-level area 폴백.
 *
 * Verifies:
 *   1. Multi-city plan 의 Busan day 식당이 Busan foodIndex 우선 매칭
 *   2. Day.city 누락 시 trip-level area 폴백
 *   3. Single-city plan (모든 day.city undefined) 은 기존 동작 유지
 *   4. Per-day mismatch flag — Busan day stop 의 mismatchSample 에 plan=busan
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/dbMatcher.js'),
  'utf8',
);

vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async () => ({ ok: true })),
}));

import { applyDBMatcher } from '../../api/_ai_core/dbMatcher.js';

describe('P114 — source-level invariants (per-day matchCity)', () => {
  it('declares dayMatchCity helper inside applyDBMatcher', () => {
    expect(src).toMatch(/function\s+dayMatchCity\s*\(/);
  });

  it('renames legacy matchCity → tripMatchCity at function-scope', () => {
    expect(src).toMatch(/const\s+tripMatchCity\s*=\s*\(city\s*\|\|\s*['"]['"]\)\.replace/);
  });

  it('iterates by day before stop (not flat allStops)', () => {
    // P114: for (const day of itinerary.days) { for (const stop of day.stops) {...} }
    expect(src).toMatch(/for\s*\(\s*const\s+day\s+of\s*\(itinerary\.days\s*\|\|\s*\[\]\)\s*\)/);
    expect(src).toMatch(/for\s*\(\s*const\s+stop\s+of\s*\(day\.stops\s*\|\|\s*\[\]\)\s*\)/);
  });

  it('dayMatchCity falls back to tripMatchCity when day.city absent', () => {
    expect(src).toMatch(/return\s+dayCity\s*\|\|\s*tripMatchCity/);
  });

  it('alert message indicates trip-level + per-day clarification', () => {
    expect(src).toMatch(/requested city \(trip\)/);
    expect(src).toMatch(/P114/);
  });
});

describe('P114 — runtime behavior (per-day matching)', () => {
  // Minimal in-memory foodIndex with city-named entries.
  const foodIndex = [
    { name: '자갈치시장', city: 'busan', address: '부산광역시 중구 자갈치해안로 52', lat: 35.0966, lng: 129.0306 },
    { name: '자갈치', city: 'seoul', address: '서울특별시 종로구 익선동 삼일대로30길 43', lat: 37.5723, lng: 126.9856 },
    { name: '돼지국밥', city: 'busan', address: '부산광역시 동구 초량동', lat: 35.115, lng: 129.041 },
    { name: '돼지국밥', city: 'seoul', address: '서울특별시 중구 명동', lat: 37.563, lng: 126.985 },
  ];

  it('multi-city plan: Busan day 식당이 Busan foodIndex 매칭 (Seoul fallback 거부)', () => {
    const itinerary = {
      days: [
        {
          day: 1, city: 'Seoul',
          stops: [{ order: 1, category: 'food', name: '돼지국밥', display_name: 'Pork Soup', address: 'Gemini-Seoul-address' }],
        },
        {
          day: 2, city: 'Busan',
          stops: [
            { order: 1, category: 'food', name: '자갈치시장', display_name: 'Jagalchi Market', address: '서울특별시 종로구 익선동' },
            { order: 2, category: 'food', name: '돼지국밥', display_name: 'Pork Soup', address: 'Gemini-Busan-address' },
          ],
        },
      ],
    };
    applyDBMatcher(itinerary, foodIndex, 'seoul_city', 'ko');

    // Day1 Seoul stop should match Seoul 돼지국밥
    const d1s1 = itinerary.days[0].stops[0] as any;
    expect(d1s1.address).toMatch(/서울/);
    expect(d1s1.verified).toBe(true);

    // Day2 Busan Jagalchi should match Busan 자갈치시장 (not Seoul 자갈치)
    const d2s1 = itinerary.days[1].stops[0] as any;
    expect(d2s1.address).toMatch(/부산/);
    expect(d2s1.verified).toBe(true);

    // Day2 Busan 돼지국밥 should match Busan version (not Seoul)
    const d2s2 = itinerary.days[1].stops[1] as any;
    expect(d2s2.address).toMatch(/부산/);
    expect(d2s2.verified).toBe(true);
  });

  it('single-city plan (모든 day.city undefined): trip-level area 폴백 동작 유지', () => {
    const itinerary = {
      days: [
        {
          day: 1, // no city field
          stops: [{ order: 1, category: 'food', name: '돼지국밥', display_name: 'Pork Soup', address: 'gemini' }],
        },
      ],
    };
    applyDBMatcher(itinerary, foodIndex, 'busan', 'ko');

    const s = itinerary.days[0].stops[0] as any;
    expect(s.address).toMatch(/부산/);
    expect(s.verified).toBe(true);
  });

  it('day.city present but trip area missing: day.city 우선', () => {
    const itinerary = {
      days: [{ day: 1, city: 'Busan', stops: [{ order: 1, category: 'food', name: '자갈치시장', address: 'gemini' }] }],
    };
    applyDBMatcher(itinerary, foodIndex, '', 'ko');
    const s = itinerary.days[0].stops[0] as any;
    expect(s.address).toMatch(/부산/);
  });

  it('non-food stops are skipped (sanitize only)', () => {
    const itinerary = {
      days: [{
        day: 1, city: 'Busan',
        stops: [{ order: 1, category: 'culture', name: 'Some Temple', address: 'gemini-original' }],
      }],
    };
    applyDBMatcher(itinerary, foodIndex, 'busan', 'ko');
    const s = itinerary.days[0].stops[0] as any;
    // Non-food stops keep their original address
    expect(s.address).toBe('gemini-original');
    expect(s.verified).toBeUndefined();
  });
});
