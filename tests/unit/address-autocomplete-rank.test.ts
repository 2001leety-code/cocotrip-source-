/**
 * AddressAutocomplete rankByQueryMatch (#4) — Naver Local Search 첫 결과 품질 개선 가드.
 * 쿼리 구문이 이름/주소에 포함된 결과를 앞으로 안정정렬. 결과를 버리거나 좌표를 바꾸지 않음(순서만).
 */
import { describe, it, expect } from 'vitest';
import { rankByQueryMatch } from '../../src/components/charter/AddressAutocomplete';

type Item = Parameters<typeof rankByQueryMatch>[0][number];
const mk = (over: Partial<Item>): Item => ({
  name: '', address: '', roadAddress: '', category: '', tel: '', lat: 37, lng: 127, ...over,
} as Item);

describe('rankByQueryMatch — 구문 매칭 우선 안정정렬', () => {
  it('이름에 쿼리 구문 포함 결과가 앞으로 (Seoul Station → EV충전소 위)', () => {
    const items = [
      mk({ name: 'Korea Electric Power EV Charging Station', lat: 1 }), // "Station"만, "Seoul Station" 아님
      mk({ name: 'Seoul Station', lat: 2 }),
    ];
    const out = rankByQueryMatch(items, 'Seoul Station');
    expect(out[0].name).toBe('Seoul Station');
    expect(out[1].lat).toBe(1);
  });

  it('좌표/결과 개수 불변 — 순서만 (아무것도 버리지 않음)', () => {
    const items = [mk({ name: 'A', lat: 1 }), mk({ name: 'Seoul Station', lat: 2 }), mk({ name: 'C', lat: 3 })];
    const out = rankByQueryMatch(items, 'Seoul Station');
    expect(out).toHaveLength(3);
    expect(new Set(out.map((o) => o.lat))).toEqual(new Set([1, 2, 3]));
  });

  it('동점(둘 다 매칭 없음)은 원래 순서 유지 (stable)', () => {
    const items = [mk({ name: 'First', lat: 1 }), mk({ name: 'Second', lat: 2 })];
    const out = rankByQueryMatch(items, 'zzz없는쿼리');
    expect(out.map((o) => o.lat)).toEqual([1, 2]);
  });

  it('이름 매칭 > 주소 매칭 > 무매칭 순', () => {
    const items = [
      mk({ name: 'No match', address: 'nowhere', lat: 1 }),
      mk({ name: 'X', roadAddress: 'Busan Jung-gu', lat: 2 }),   // 주소 매칭
      mk({ name: 'Busan Station', lat: 3 }),                      // 이름 매칭
    ];
    const out = rankByQueryMatch(items, 'Busan');
    expect(out.map((o) => o.lat)).toEqual([3, 2, 1]);
  });

  it('originalName(한글 원문) 도 매칭 대상', () => {
    const items = [
      mk({ name: 'Some Place', lat: 1 }),
      mk({ name: 'Translated', originalName: '서울역', lat: 2 }),
    ];
    const out = rankByQueryMatch(items, '서울역');
    expect(out[0].lat).toBe(2);
  });

  it('빈 쿼리 / 1개 이하 → 그대로 (no-op)', () => {
    const items = [mk({ name: 'B', lat: 1 }), mk({ name: 'A', lat: 2 })];
    expect(rankByQueryMatch(items, '')).toBe(items);
    expect(rankByQueryMatch([items[0]], 'x')).toHaveLength(1);
  });
});
