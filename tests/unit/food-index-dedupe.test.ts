/**
 * 2026-10-24 — build-food-index 중복 제거가 general 행 뒤의 같은 장소 halal/vegan 행을 버리던 결함의 제한 복구
 * (scripts/lib/food-index-dedupe.mjs). 유지 행의 tag 만 바뀌고, 조건이 하나라도 어긋나면 held 로 남는다.
 */
import { describe, expect, it } from 'vitest';
import { dedupeKey, dedupeWithDietaryRestore } from '../../scripts/lib/food-index-dedupe.mjs';
import { DIETARY_TAGS } from '../../api/_shared/dietary-trust.js';

type Row = Record<string, unknown>;
const opts = { dietaryTags: DIETARY_TAGS };
const general = (over: Row = {}): Row => ({
  name: '부산 커리하우스', nameEn: 'Busan Curry House', address: '부산광역시 해운대구 1', lat: 35.1, lng: 129.1,
  cuisine: 'Indian', rating: 4.7, reviewCount: 120, tag: 'general', city: 'busan', placeId: 'P1',
  allergens: { nuts: true, shellfish: false, gluten: false, dairy: false }, ...over,
});
const claim = (tag: string, over: Row = {}): Row => ({
  name: 'Busan Curry House Halal', address: '해운대구 부산광역시', cuisine: 'Halal', rating: 4.6, reviewCount: 80,
  tag, city: 'busan', placeId: 'P1', ...over,
});
const run = (items: Row[]) => dedupeWithDietaryRestore(items, opts);

describe('dedupeWithDietaryRestore', () => {
  it('general + halal, same placeId → kept general row gets tag halal, every other field stays the general row', () => {
    const g = general();
    const { deduped, restored, held } = run([g, claim('halal')]);
    expect(deduped).toEqual([{ ...g, tag: 'halal' }]);
    expect(restored).toEqual([{ key: 'P1', name: g.name, city: 'busan', tag: 'halal' }]);
    expect(held).toEqual([]);
  });

  it('same googleMapsUrl (no placeId) is a strong key too', () => {
    const url = 'https://maps.google.com/?cid=9';
    const { deduped, restored } = run([general({ placeId: undefined, googleMapsUrl: url }), claim('vegan', { placeId: undefined, googleMapsUrl: url })]);
    expect(deduped[0].tag).toBe('vegan');
    expect(restored).toHaveLength(1);
  });

  it('general + halal + vegan on one placeId → no restore, held cross_tag', () => {
    const g = general();
    const { deduped, restored, held } = run([g, claim('halal'), claim('vegan')]);
    expect(deduped).toEqual([g]);
    expect(restored).toEqual([]);
    expect(held).toEqual([{ key: 'P1', name: g.name, city: 'busan', tags: ['halal', 'vegan'], reason: 'cross_tag' }]);
  });

  it('vegan + vegetarian is also a cross claim (no union)', () => {
    expect(run([general(), claim('vegan'), claim('vegetarian')]).held[0].reason).toBe('cross_tag');
  });

  it('repeated identical claims count as one claim', () => {
    const { deduped, restored } = run([general(), claim('halal'), claim('halal')]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].tag).toBe('halal');
    expect(restored).toHaveLength(1);
  });

  it.each([
    ['city_mismatch', general(), claim('halal', { city: 'seoul' })],
    ['source_mismatch', general(), claim('halal', { source: 'naver_local' })],
    ['source_mismatch', general({ source: 'google_places' }), claim('halal')],
    ['weak_key', general({ placeId: undefined }), claim('halal', { placeId: undefined, name: '부산 커리하우스', address: '부산광역시 해운대구 1' })],
    ['weak_key', general({ placeId: undefined, googleMapsUrl: 'X' }), claim('halal', { placeId: 'X' })],
    ['kept_has_verification', general({ verification_status: 'vegan_restaurant' }), claim('halal')],
  ])('held %s — kept row unchanged', (reason, g, c) => {
    const { deduped, restored, held } = run([g, c]);
    expect(deduped).toEqual([g]);
    expect(restored).toEqual([]);
    expect(held).toHaveLength(1);
    expect(held[0].reason).toBe(reason);
  });

  it('city / source compare: city case-insensitive, both-absent source counts as same', () => {
    const { restored } = run([general({ city: 'Busan' }), claim('halal', { city: 'busan ' })]);
    expect(restored).toHaveLength(1);
  });

  it('dietary row first → kept as is (no change, nothing held)', () => {
    const h = claim('halal');
    const { deduped, restored, held } = run([h, general()]);
    expect(deduped).toEqual([h]);
    expect(restored).toEqual([]);
    expect(held).toEqual([]);
  });

  it('kept row already dietary + a different dietary twin → unchanged (not unioned)', () => {
    const v = claim('vegan');
    expect(run([v, claim('halal')]).deduped).toEqual([v]);
  });

  it('general duplicates stay first-row-wins', () => {
    const a = general();
    const b = general({ name: '다른 이름', rating: 4.9 });
    const { deduped, restored, held } = run([a, b]);
    expect(deduped).toEqual([a]);
    expect(restored).toEqual([]);
    expect(held).toEqual([]);
  });

  it('input not mutated; output deterministic; key set and order of first appearance unchanged', () => {
    const items = [
      general(), claim('halal'),
      general({ placeId: 'P2', name: 'B' }), claim('vegan', { placeId: 'P2' }), claim('halal', { placeId: 'P2' }),
      claim('vegan', { placeId: 'P3', name: 'C' }),
      general({ placeId: undefined, name: 'D', address: 'addr' }),
      general({ placeId: 'P4', name: 'E' }), claim('vegetarian', { placeId: 'P4', city: 'jeju' }),
    ];
    const snapshot = JSON.parse(JSON.stringify(items));
    const first = run(items);
    expect(items).toEqual(snapshot);
    expect(run(items)).toEqual(first);
    const inputKeys = [...new Set(items.map((r) => dedupeKey(r)))];
    expect(first.deduped.map((r: Row) => dedupeKey(r))).toEqual(inputKeys);
    expect(first.restored.map((r: { key: string }) => r.key)).toEqual(['P1']);
    expect(first.held.map((h: { key: string; reason: string }) => `${h.key}:${h.reason}`)).toEqual(['P2:cross_tag', 'P4:city_mismatch']);
    // 복구된 행만 새 객체 — 나머지는 입력 행 그대로
    expect(first.deduped[0]).not.toBe(items[0]);
    expect(first.deduped[1]).toBe(items[2]);
  });
});
