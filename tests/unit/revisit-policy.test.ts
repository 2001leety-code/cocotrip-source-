/**
 * 2026-10-24 — 검증 식당 재방문 정책 (api/_ai_core/revisitPolicy.js, Astra 설계 r1~r3).
 *   판정기(judgeRepeats)와 정규화기(normalizeRevisits)는 같은 걷기·적격 집합·소진 정의를 쓴다.
 *   허용 재방문 = revisit:true · food · verified · 시각 유효 · 행 ∈ 적격(그 날 도시·요청 안전 식이 전부) · 오늘 미방문
 *   · 그 시점 (적격 \ 앞선 방문) = ∅. ctx 없음 → 모든 반복 = 중복(현행). 실호출 0, 합성 행만.
 */
import { describe, it, expect } from 'vitest';
import {
  eligibleRows, judgeRepeats, normalizeRevisits, orderedFoodStops, parseStrictHHMM, cityKeyOf, stopDuplicateKey,
} from '../../api/_ai_core/revisitPolicy.js';
import { stopDuplicateKey as qmKey, findDuplicateStops, findRevisits, computeQualityScore } from '../../api/_ai_core/qualityMetrics.js';
import { runDuplicateStopGate } from '../../api/_ai_core/finalItineraryGate.js';

type Row = Record<string, unknown>;
type Stop = Record<string, unknown>;
const row = (name: string, o: Row = {}): Row => ({
  name, nameEn: `${name} EN`, city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly',
  address: '서울특별시 중구 1', lat: 37.56, lng: 126.98, rating: 4, ...o,
});
const A = row('합성A', { lat: 37.560, lng: 126.980 });
const B = row('합성B', { lat: 37.570, lng: 126.990 });
const C = row('합성C', { lat: 37.700, lng: 127.200 });
const U = row('합성U', { verification_status: 'unverified', source: 'naver_local' });
const food = (name: string, start_time: string, o: Stop = {}): Stop => ({ category: 'food', name, start_time, verified: true, ...o });
const day = (n: number, stops: Stop[], city = 'seoul') => ({ day: n, city, stops });
const halal = (rows: Row[], extra: Record<string, unknown> = {}) => ({ foodIndex: rows, dietary: ['Halal'], ...extra });
const names = (it: { days: Array<{ stops: Stop[] }> }, d: number) => it.days[d].stops.map((s) => [s.name, s.revisit === true]);

describe('building blocks', () => {
  it('strict HH:MM (00~23:00~59) only', () => {
    expect(parseStrictHHMM('09:30')).toBe(570);
    for (const bad of ['9:30', '24:00', '12:60', '12:30:00', '', undefined, 1230]) expect(parseStrictHHMM(bad as never)).toBeNull();
  });
  it('city keys: suffix and localized aliases', () => {
    for (const v of ['seoul', 'Seoul', 'seoul_city', '서울', 'ソウル', '首尔']) expect(cityKeyOf(v)).toBe('seoul');
  });
  it('duplicate key is the single rule shared with qualityMetrics', () => {
    expect(qmKey).toBe(stopDuplicateKey);
    expect(stopDuplicateKey({ category: 'lodging', name: 'Hotel' })).toBe('');
    expect(stopDuplicateKey({ category: 'food', name: '  Foo ' })).toBe('foo');
  });
  it('eligible rows: trusted + all requested diets + not avoided + uniquely resolvable', () => {
    expect(eligibleRows([A, B, U], 'seoul', ['halal'])).toEqual([A, B]);
    expect(eligibleRows([A, B], 'seoul', [])).toEqual([]);
    // 요청 식이 전부를 한 행이 — halal 행·vegan 행 각각은 Halal+Vegan 후보가 아니다(dietaryCoverageGate 와 같은 술어).
    expect(eligibleRows([A, row('합성V', { tag: 'vegan', verification_status: 'vegan_restaurant' })], 'seoul', ['halal', 'vegan'])).toEqual([]);
    expect(eligibleRows([A, B], 'seoul', ['halal'], { avoidKeys: ['합성b'] })).toEqual([A]);
    // R4: 신뢰/미검증 같은 이름 충돌 행은 후보 아님
    const twin = { ...A, verification_status: 'unverified', source: 'naver_local' };
    expect(eligibleRows([A, twin, B], 'seoul', ['halal'])).toEqual([B]);
    expect(eligibleRows([{ ...A, city: 'busan' }], 'seoul', ['halal'])).toEqual([]);
  });
  it('order: (day, start_time); invalid/missing time goes last in its day', () => {
    const it0 = { days: [day(1, [food('합성B', '18:00'), food('합성C', 'soon'), food('합성A', '12:00')])] };
    expect(orderedFoodStops(it0).map((e) => [e.stop.name, e.minute])).toEqual([['합성A', 720], ['합성B', 1080], ['합성C', null]]);
  });
});

describe('judgeRepeats', () => {
  it('no ctx (no foodIndex or no safety diet) → every repeat is a duplicate (current behaviour)', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00', { revisit: true })])] };
    expect(judgeRepeats(it0, undefined).duplicates).toEqual([{ name: '합성A', count: 2 }]);
    expect(judgeRepeats(it0, { foodIndex: [A], dietary: ['Meat'] }).duplicates).toHaveLength(1);
    expect(judgeRepeats(it0, { foodIndex: [], dietary: ['Halal'] }).duplicates).toHaveLength(1);
  });
  it('exhausted city, other day, marked + verified → approved revisit', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00', { revisit: true })])] };
    expect(judgeRepeats(it0, halal([A]))).toEqual({ duplicates: [], revisits: [{ name: '합성A', day: 2 }] });
  });
  it('same-day repeat is always rejected, even when exhausted and marked', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00'), food('합성A', '18:00', { revisit: true })])] };
    expect(judgeRepeats(it0, halal([A])).duplicates).toEqual([{ name: '합성A', count: 2 }]);
  });
  it('marked but not exhausted (an unused eligible row remains) → duplicate', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00', { revisit: true })])] };
    expect(judgeRepeats(it0, halal([A, B])).duplicates).toHaveLength(1);
  });
  it('a future booking is not a visit: B planned later does not prove exhaustion now', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00', { revisit: true }), food('합성B', '18:00')])] };
    expect(judgeRepeats(it0, halal([A, B])).duplicates).toHaveLength(1);
    const ok = { days: [day(1, [food('합성A', '12:00'), food('합성B', '18:00')]), day(2, [food('합성A', '12:00', { revisit: true })])] };
    expect(judgeRepeats(ok, halal([A, B])).duplicates).toEqual([]);
  });
  it('untimed stops count as repeats but never as exhaustion proof nor as approved revisits', () => {
    const firstUntimed = { days: [day(1, [food('합성A', '')]), day(2, [food('합성A', '12:00', { revisit: true })])] };
    expect(judgeRepeats(firstUntimed, halal([A])).duplicates).toHaveLength(1);
    const repeatUntimed = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', 'later', { revisit: true })])] };
    expect(judgeRepeats(repeatUntimed, halal([A])).duplicates).toHaveLength(1);
  });
  it('the selected row must be eligible: unverified, wrong diet, unverified stop, other-city row', () => {
    const it0 = (n: string, o: Stop = {}) => ({ days: [day(1, [food(n, '12:00')]), day(2, [food(n, '12:00', { revisit: true, ...o })])] });
    expect(judgeRepeats(it0('합성U'), halal([A, U])).duplicates).toHaveLength(1);
    expect(judgeRepeats(it0('합성A', { verified: false }), halal([A])).duplicates).toHaveLength(1);
    expect(judgeRepeats(it0('합성A'), { foodIndex: [A], dietary: ['Halal', 'Vegan'] }).duplicates).toHaveLength(1);
  });
  it('compound diets: the intersection decides exhaustion (a halal-only row is not a candidate for Halal+Vegan)', () => {
    const HV = row('합성HV', { tag: 'vegan', dietary_tags: ['vegan', 'halal'], verification_status: 'vegan_restaurant' });
    const it0 = { days: [day(1, [food('합성HV', '12:00')]), day(2, [food('합성HV', '12:00', { revisit: true })])] };
    expect(eligibleRows([HV, A], 'seoul', ['halal', 'vegan'])).toEqual([HV]);
    expect(judgeRepeats(it0, { foodIndex: [HV, A], dietary: ['Halal', 'Vegan'] }).duplicates).toEqual([]); // A 는 교집합 밖 → 소진
    expect(judgeRepeats(it0, { foodIndex: [HV, A], dietary: ['Halal'] }).duplicates).toHaveLength(1); // Halal 만이면 A 미사용
  });
  it('alias names and localized/suffixed day city keys resolve to the same row', () => {
    const comma = row('합성K, 명동 맛집');
    const it0 = { days: [day(1, [food('합성K, 명동 맛집', '12:00')], '서울'), day(2, [food('합성K', '12:00', { revisit: true })], 'seoul_city')] };
    expect(judgeRepeats(it0, halal([comma])).duplicates).toEqual([]);
    expect(judgeRepeats(it0, undefined).duplicates).toEqual([]); // 이름 기준(현행)은 별칭을 다른 stop 으로 본다
  });
  it('two cities: each day is judged against its own city pool', () => {
    const P = row('합성P', { city: 'busan', address: '부산광역시 해운대구 1', lat: 35.16, lng: 129.16 });
    const Q = row('합성Q', { city: 'busan', address: '부산광역시 해운대구 2', lat: 35.17, lng: 129.17 });
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성P', '12:00')], 'busan'), day(3, [food('합성P', '12:00', { revisit: true })], 'busan')] };
    expect(judgeRepeats(it0, halal([A, P, Q])).duplicates).toHaveLength(1); // 부산 Q 미사용
    expect(judgeRepeats(it0, halal([A, P])).duplicates).toEqual([]);
  });
  it('non-food repeats stay duplicates', () => {
    const it0 = { days: [day(1, [{ category: 'culture', name: 'Palace', start_time: '10:00' }]), day(2, [{ category: 'culture', name: 'Palace', start_time: '10:00', revisit: true }])] };
    expect(judgeRepeats(it0, halal([A])).duplicates).toHaveLength(1);
  });
});

describe('normalizeRevisits', () => {
  it('R1 example: pool {A,B}, D1 [A,B], D2 [A,A] → D2 becomes [A(revisit), B(revisit)]', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00'), food('합성B', '18:00')]), day(2, [food('합성A', '12:00'), food('합성A', '18:00')])] };
    normalizeRevisits(it0, halal([A, B]));
    expect(names(it0, 1)).toEqual([['합성A', true], ['합성B', true]]);
    expect(judgeRepeats(it0, halal([A, B]))).toMatchObject({ duplicates: [], revisits: [{ name: '합성A', day: 2 }, { name: '합성B', day: 2 }] });
  });
  it('unmarked exhausted repeat on another day → marked', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00')])] };
    const { changes } = normalizeRevisits(it0, halal([A]));
    expect(changes).toEqual([{ day: 2, action: 'mark', from: '합성A', to: '합성A' }]);
    expect(judgeRepeats(it0, halal([A])).duplicates).toEqual([]);
  });
  it('marked but not exhausted → replaced by the nearest unused eligible row, flag removed, row values copied', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [{ category: 'culture', name: 'Spot', start_time: '10:00', lat: 37.701, lng: 127.199 }, food('합성A', '12:00', { revisit: true, tip: 'old' })])] };
    normalizeRevisits(it0, halal([A, B, C]));
    const s = it0.days[1].stops[1];
    expect(s).toMatchObject({ name: '합성C', display_name: '합성C EN', lat: 37.7, lng: 127.2, verified: true, _replaced_for_revisit: '합성A' });
    expect(s.revisit).toBeUndefined();
    expect(s.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    expect(s.tip).not.toBe('old');
    expect(judgeRepeats(it0, halal([A, B, C])).duplicates).toEqual([]);
  });
  it('markOnly (after routing) never replaces: an unexhausted repeat stays and is rejected', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00', { revisit: true })])] };
    normalizeRevisits(it0, halal([A, B]), { mode: 'markOnly' });
    expect(it0.days[1].stops[0].name).toBe('합성A');
    expect(judgeRepeats(it0, halal([A, B])).duplicates).toHaveLength(1);
  });
  it('after a flight cut removes the first visit, the leftover revisit flag (and note) is removed', () => {
    const it0 = { days: [day(1, []), day(2, [food('합성A', '12:00', { revisit: true, revisit_note: 'x', _revisit_note: true })])] };
    normalizeRevisits(it0, halal([A]), { mode: 'markOnly' });
    expect(it0.days[1].stops[0]).not.toHaveProperty('revisit');
    expect(it0.days[1].stops[0]).not.toHaveProperty('revisit_note');
    expect(it0.days[1].stops[0]).not.toHaveProperty('_revisit_note');
  });
  it('same-day repeat with a single eligible row stays (the gate rejects it explicitly)', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00'), food('합성A', '18:00')])] };
    normalizeRevisits(it0, halal([A]));
    expect(judgeRepeats(it0, halal([A])).duplicates).toHaveLength(1);
  });
  it('never assigns an unverified row or an avoided row', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00')])] };
    normalizeRevisits(it0, halal([A, U, B], { avoidStopNames: ['합성B'] }));
    expect(it0.days[1].stops[0]).toMatchObject({ name: '합성A', revisit: true });
  });
  it('no ctx → no change', () => {
    const it0 = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00')])] };
    const before = JSON.stringify(it0);
    expect(normalizeRevisits(it0, undefined).changes).toEqual([]);
    expect(JSON.stringify(it0)).toBe(before);
  });
  it('property: when a valid placement exists (eligible rows only, all timed, per-day meals ≤ pool), judge(normalize(x)) has no duplicates', () => {
    const pool = [A, B, C, row('합성D', { lat: 37.58, lng: 127.0 })];
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let t = 0; t < 200; t++) {
      const days = Array.from({ length: 1 + rand(4) }, (_, d) => day(d + 1,
        Array.from({ length: 1 + rand(pool.length) }, (_, k) => food(String(pool[rand(pool.length)].name), `${String(8 + k * 4).padStart(2, '0')}:00`, rand(2) ? { revisit: true } : {}))));
      const it0 = { days };
      normalizeRevisits(it0, halal(pool));
      expect(judgeRepeats(it0, halal(pool)).duplicates, JSON.stringify(it0.days.map((x) => x.stops.map((s) => s.name)))).toEqual([]);
    }
  });
});

describe('consumers share the judge', () => {
  const approved = { days: [day(1, [food('합성A', '12:00')]), day(2, [food('합성A', '12:00', { revisit: true })])] };
  it('runDuplicateStopGate: ctx → approved revisit passes with revisits listed; no ctx → rejected (old shape)', () => {
    expect(runDuplicateStopGate(approved, halal([A]))).toEqual({ ok: true, code: null, duplicates: [], revisits: [{ name: '합성A', day: 2 }] });
    expect(runDuplicateStopGate(approved)).toMatchObject({ ok: false, duplicates: [{ name: '합성A', count: 2 }] });
    expect(runDuplicateStopGate(approved)).not.toHaveProperty('revisits');
  });
  it('qualityMetrics: findDuplicateStops / findRevisits / duplicate_stops metric follow the judge', () => {
    expect(findDuplicateStops(approved, halal([A]))).toEqual([]);
    expect(findDuplicateStops(approved)).toHaveLength(1);
    expect(findRevisits(approved, halal([A]))).toEqual([{ name: '합성A', day: 2 }]);
    expect(computeQualityScore(approved, ['Halal'], 'seoul', [A]).metrics.duplicate_stops.count).toBe(0);
    expect(computeQualityScore(approved, ['Halal'], 'seoul', []).metrics.duplicate_stops.count).toBe(1);
  });
});
