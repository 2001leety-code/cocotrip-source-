/**
 * 2026-10-10 — two dietary-safety gaps found in the offline Gemini/DB comparison:
 *  1. The vegan/vegetarian conflict regex had no lamb/mutton/한우/duck/seafood words, so the REAL busan row
 *     "364 Grilled Lamb&Hanwoo Dumplings" (vegan_options grade) passed a vegan request with 0 violations.
 *     Vegetarian also accepted fish/seafood.
 *  2. The replacer picked substitutes by an 8km radius around the MODEL's coordinates with no city check, so a
 *     Busan day whose stop carried Seoul coordinates received Seoul restaurants (final gate blocked → paid retry).
 * Offline: synthetic rows only (no network, no model).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => ({ ok: true, alerted: false })) }));

import { validateResponse } from '../../api/_ai_core/responseValidator.js';
import { replaceViolatingFoodStops } from '../../api/_ai_core/dietaryStopReplacer.js';

type Row = Record<string, unknown>;
const BUSAN_LAMB: Row = {
  name: '364 Grilled Lamb&Hanwoo Dumplings', nameEn: '364 Grilled Lamb&Hanwoo Dumplings', city: 'busan', tag: 'vegan',
  verification_status: 'vegan_options', address: '부산광역시 해운대구 합성로 1', lat: 35.16, lng: 129.16, rating: 4.5, reviewCount: 300,
};
const BUSAN_VEGAN: Row = {
  name: '합성부산비건', nameEn: 'Synthetic Busan Vegan', city: 'busan', tag: 'vegan',
  verification_status: 'vegan_restaurant', address: '부산광역시 해운대구 합성로 9', lat: 35.161, lng: 129.161, rating: 4.7, reviewCount: 500,
};
const SEOUL_VEGAN: Row = {
  name: '합성서울비건', nameEn: 'Synthetic Seoul Vegan', city: 'seoul', tag: 'vegan',
  verification_status: 'vegan_restaurant', address: '서울특별시 용산구 합성로 9', lat: 37.534, lng: 126.995, rating: 4.7, reviewCount: 500,
};
const FI = [BUSAN_LAMB, BUSAN_VEGAN, SEOUL_VEGAN];

const dietaryIssues = (plan: unknown, dietary: string[]) =>
  (validateResponse(plan, { lang: 'en', dietary }, FI) as { type: string; diet?: string; stop?: string }[]).filter((i) => i.type === 'dietary_violation');

describe('1. vegan / vegetarian conflict words', () => {
  it('a vegan request flags a DB-matched "Lamb & Hanwoo" row (name alone is a conflict)', () => {
    const plan = { days: [{ day: 1, city: 'Busan', stops: [{ category: 'food', name: '364 Grilled Lamb&Hanwoo Dumplings', lat: 35.16, lng: 129.16 }] }] };
    const issues = dietaryIssues(plan, ['Vegan']);
    expect(issues.map((i) => i.diet)).toContain('vegan');
  });

  it('한우 / 양고기 / 장어 / 새우 in the tip are conflicts for vegan; fish is a conflict for vegetarian', () => {
    for (const tip of ['한우 구이가 유명', '양고기 전문', '장어 덮밥', '새우 튀김']) {
      const plan = { days: [{ day: 1, city: 'Busan', stops: [{ category: 'food', name: '합성부산비건', tip, lat: 35.161, lng: 129.161 }] }] };
      expect(dietaryIssues(plan, ['Vegan']).map((i) => i.diet), tip).toContain('vegan');
    }
    const fishy = { days: [{ day: 1, city: 'Busan', stops: [{ category: 'food', name: '합성부산비건', tip: 'Famous grilled fish set', lat: 35.161, lng: 129.161 }] }] };
    expect(dietaryIssues(fishy, ['Vegetarian']).map((i) => i.diet)).toContain('vegetarian');
  });

  it('a clean vegan row with a harmless tip still passes (no false positive)', () => {
    const plan = { days: [{ day: 1, city: 'Busan', stops: [{ category: 'food', name: '합성부산비건', tip: 'Tofu bowls and seasonal greens', lat: 35.161, lng: 129.161 }] }] };
    expect(dietaryIssues(plan, ['Vegan'])).toEqual([]);
  });
});

describe('2. replacer candidates must belong to the day city', () => {
  const violation = [{ type: 'dietary_violation', diet: 'vegan', stop: '합성위반식당' }];

  it('Busan day + model coordinates in Seoul: the Seoul vegan row within 8km is NOT used', () => {
    const plan = { days: [{ day: 2, city: 'Busan', stops: [{ category: 'food', name: '합성위반식당', lat: 37.534, lng: 126.99 }] }] };
    const r = replaceViolatingFoodStops(plan, violation, FI, ['Vegan'], 'seoul');
    expect(r.replaced).toBe(0);
    expect(plan.days[0].stops[0].name).toBe('합성위반식당');
  });

  it('Busan day + Busan coordinates: the Busan vegan row is used', () => {
    const plan = { days: [{ day: 2, city: 'Busan', stops: [{ category: 'food', name: '합성위반식당', lat: 35.16, lng: 129.16 }] }] };
    const r = replaceViolatingFoodStops(plan, violation, FI, ['Vegan'], 'seoul');
    expect(r.replaced).toBe(1);
    expect(['합성부산비건', '364 Grilled Lamb&Hanwoo Dumplings']).toContain(plan.days[0].stops[0].name);
  });

  it('day city unknown (no day.city, unmapped area): falls back to the previous radius rule, no seoul assumption', () => {
    const plan = { days: [{ day: 1, stops: [{ category: 'food', name: '합성위반식당', lat: 37.534, lng: 126.99 }] }] };
    const r = replaceViolatingFoodStops(plan, violation, FI, ['Vegan'], 'andong');
    expect(r.replaced).toBe(1);
  });
});
