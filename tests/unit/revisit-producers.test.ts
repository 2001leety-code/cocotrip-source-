/**
 * 2026-10-24 — 재방문 정책 2단계: 생산자는 "새 식당 우선, 소진돼도 실패하지 않기"만(정확성은 revisitPolicy 판정).
 *   E blockMode.matchFoodPlaceholder · F dietaryStopReplacer(전체 식이 교집합 + 단계) · G pass2Resolve(ctx 강제 필터)
 *   · H 프롬프트 식이 블록 + 스키마 revisit. 식이 신뢰 완화 없음(unverified 는 어느 단계에서도 후보 아님). 실호출 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchFoodPlaceholder } from '../../api/_ai_core/blockMode.js';
import { replaceViolatingFoodStops } from '../../api/_ai_core/dietaryStopReplacer.js';
import { pass2Resolve } from '../../api/_ai_core/threePassPipeline.js';
import { buildDietarySafetyBlock } from '../../api/_ai_core/userMessageBuilder.js';
import { buildSystemPrompt } from '../../api/_ai_core/buildPrompt.js';
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';
import { judgeRepeats } from '../../api/_ai_core/revisitPolicy.js';

type Row = Record<string, unknown>;
type Stop = Record<string, unknown>;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const halalRow = (name: string, o: Row = {}): Row => ({
  name, nameEn: `${name} EN`, city: 'seoul', type: 'restaurant', tag: 'halal', verification_status: 'muslim_friendly',
  address: '서울특별시 중구 1', rating: 4.5, reviewCount: 10, lat: 37.56, lng: 126.98, ...o,
});
const A = halalRow('식당A', { rating: 4.9 });
const B = halalRow('식당B', { lat: 37.60, lng: 127.10, rating: 4.8 });
const U = halalRow('식당U', { verification_status: 'unverified', source: 'naver_local', rating: 5.0 });

describe('E — blockMode.matchFoodPlaceholder (dietary guests)', () => {
  const ph = { placeholder: 'verified_lunch', lat: 37.561, lng: 126.981 };
  it('narrowed pool exhausted → nearest unused city-wide row, no revisit flag', () => {
    expect(matchFoodPlaceholder(ph, [A, B], 'seoul', ['Halal'], new Set(['식당A']), null, new Set())).toMatchObject({ name: '식당B' });
    expect(matchFoodPlaceholder(ph, [A, B], 'seoul', ['Halal'], new Set(['식당A']), null, new Set())).not.toHaveProperty('revisit');
  });
  it('all used → nearest row not used TODAY, returned as a copy with revisit: true (index untouched)', () => {
    const m = matchFoodPlaceholder(ph, [A, B], 'seoul', ['Halal'], new Set(['식당A', '식당B']), null, new Set(['식당A']));
    expect(m).toMatchObject({ name: '식당B', revisit: true });
    expect(B).not.toHaveProperty('revisit');
    expect(matchFoodPlaceholder(ph, [A, B], 'seoul', ['Halal'], new Set(['식당A', '식당B']), null, new Set())).toMatchObject({ name: '식당A', revisit: true });
  });
  it('never an unverified row, at any stage', () => {
    const m = matchFoodPlaceholder(ph, [A, U], 'seoul', ['Halal'], new Set(['식당A']), null, new Set(['식당A']));
    expect(m).toMatchObject({ name: '식당A' }); // 오늘도 쓴 A 밖에 없으면 기존 동작(1순위) — 같은 날 반복은 종단 게이트가 거부
    expect(m && m.name).not.toBe('식당U');
  });
  it('non-dietary guests keep the old graceful 1st-rank reuse (byte-identical behaviour)', () => {
    expect(matchFoodPlaceholder(ph, [A, B], 'seoul', [], new Set(['식당A', '식당B']), null, new Set())).toMatchObject({ name: '식당A' });
    expect(matchFoodPlaceholder(ph, [A, B], 'seoul', [], new Set(['식당A', '식당B']), null, new Set())).not.toHaveProperty('revisit');
  });
});

describe('F — dietaryStopReplacer: all requested diets on one row, staged fallback', () => {
  const plan = (day1: Stop[], target: Stop) => ({ days: [
    { day: 1, city: 'seoul', stops: day1 },
    { day: 2, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel' }, target] },
  ] });
  const bad = (): Stop => ({ category: 'food', name: '위반식당', start_time: '12:00', lat: 37.561, lng: 126.981 });
  const viol = (diet: string) => ({ type: 'dietary_violation', severity: 'critical', stop: '위반식당', diet, category: 'food' });

  it('Halal+Vegan: a halal-only row is not a candidate; the intersection row is chosen; evidence for both diets', () => {
    const HV = halalRow('식당HV', { dietary_tags: ['halal', 'vegan'], lat: 37.7, lng: 127.2 });
    const p = plan([], bad());
    const r = replaceViolatingFoodStops(p, [viol('halal'), viol('vegan')], [A, HV], ['Halal', 'Vegan'], 'seoul', 'en');
    expect(r).toMatchObject({ replaced: 1, failed: 0 });
    expect(r.detail).toEqual(['replaced halal:위반식당 -> 식당HV [city-unused]']);
    expect((p.days[1].stops[1].dietary_evidence as unknown[]).length).toBe(2);
  });
  it('used on another day → revisit-other-day (flagged); used today → failed', () => {
    const p = plan([{ category: 'food', name: '식당A', start_time: '12:00' }], bad());
    expect(replaceViolatingFoodStops(p, [viol('halal')], [A], ['Halal'], 'seoul', 'en').detail).toEqual(['replaced halal:위반식당 -> 식당A [revisit-other-day]']);
    expect(p.days[1].stops[1]).toMatchObject({ name: '식당A', revisit: true });
    const q = plan([], bad());
    q.days[1].stops.push({ category: 'food', name: '식당A', start_time: '18:00' });
    expect(replaceViolatingFoodStops(q, [viol('halal')], [A], ['Halal'], 'seoul', 'en')).toMatchObject({ replaced: 0, failed: 1 });
  });
  // 2026-10-24 r4 (Astra P2): 처리 단위 = stop 객체 — 같은 이름의 위반 식당이 두 날에 있으면 둘 다 교체.
  it('the same unverified restaurant U on Day 1 and Day 2 → both stops are replaced (handled per stop object)', () => {
    const uStop = (t: string): Stop => ({ category: 'food', name: '식당U', start_time: t, lat: 37.561, lng: 126.981 });
    const p = { days: [
      { day: 1, city: 'seoul', stops: [uStop('12:00')] },
      { day: 2, city: 'seoul', stops: [uStop('12:00')] },
    ] };
    // validateResponse 는 stop 마다 위반 1건 — 같은 이름 두 건(라벨만 같고 다른 stop).
    const r = replaceViolatingFoodStops(p, [viol('halal'), viol('halal')].map((v) => ({ ...v, stop: '식당U' })), [A, B, U], ['Halal'], 'seoul', 'en');
    expect(r).toMatchObject({ replaced: 2, failed: 0 });
    expect([p.days[0].stops[0].name, p.days[1].stops[0].name].sort()).toEqual(['식당A', '식당B']);
  });
  it('the replacer clears the old restaurant\'s menu / reservation fields (shared applyFoodRowToStop helper)', () => {
    const target = { ...bad(), recommended_items: [{ name: 'Pork belly', price_krw: 15000 }], reservation_required: true, reservation_url: 'https://old.example', naverMapUrl: 'https://naver.me/old', googleMapsUrl: 'https://maps.google.com/?cid=old' };
    const p = plan([], target);
    replaceViolatingFoodStops(p, [viol('halal')], [{ ...A, googleMapsUrl: 'https://maps.google.com/?cid=A' }], ['Halal'], 'seoul', 'en');
    const s = p.days[1].stops[1];
    expect(s).toMatchObject({ name: '식당A', googleMapsUrl: 'https://maps.google.com/?cid=A', verified: true });
    for (const f of ['recommended_items', 'reservation_required', 'reservation_url', 'naverMapUrl']) expect(s, f).not.toHaveProperty(f);
    expect(read('api/_ai_core/dietaryStopReplacer.js')).toMatch(/applyFoodRowToStop\(target, pick, \{ diets, language \}\)/);
  });
  it('unverified rows stay out of every stage', () => {
    const p = plan([{ category: 'food', name: '식당A', start_time: '12:00' }], bad());
    replaceViolatingFoodStops(p, [viol('halal')], [A, U], ['Halal'], 'seoul', 'en');
    expect(p.days[1].stops[1].name).toBe('식당A');
  });
});

describe('G — pass2Resolve with dietary ctx', () => {
  const slot = (t: string): Stop => ({ name: 'FOOD_SLOT', category: 'food', start_time: t, stay_min: 60, food_intent: 'something', cuisine: 'any' });
  const plan = () => ({ days: [
    { day: 1, city: 'seoul', stops: [{ category: 'food', name: '식당A', start_time: '12:00', verified: true }] },
    { day: 2, city: 'seoul', stops: [slot('12:00')] },
  ] });
  it('hard filter: only eligible rows (never the unverified or a general row) even if they score higher', () => {
    const G = halalRow('일반식당', { tag: 'general', verification_status: null });
    const p = pass2Resolve(plan(), [U, G, A, B], 'seoul', { dietary: ['Halal'] });
    expect(p.days[1].stops[0]).toMatchObject({ name: '식당B', verified: true });
    expect(p.days[1].stops[0]).not.toHaveProperty('revisit');
  });
  it('all eligible already used → other-day revisit (flagged) instead of throwing; judge approves it', () => {
    const p = pass2Resolve(plan(), [A, U], 'seoul', { dietary: ['Halal'] });
    expect(p.days[1].stops[0]).toMatchObject({ name: '식당A', revisit: true, verified: true });
    expect(judgeRepeats(p, { foodIndex: [A, U], dietary: ['Halal'] }).duplicates).toEqual([]);
  });
  it('same-day only → still the existing 422 (UNUSED_FOOD_CANDIDATES_EXHAUSTED)', () => {
    const p = { days: [{ day: 1, city: 'seoul', stops: [{ category: 'food', name: '식당A', start_time: '12:00' }, slot('18:00')] }] };
    let err: (Error & { reason?: string; code?: string }) | undefined;
    try { pass2Resolve(p, [A], 'seoul', { dietary: ['Halal'] }); } catch (e) { err = e as Error & { reason?: string }; }
    expect(err?.reason).toBe('UNUSED_FOOD_CANDIDATES_EXHAUSTED');
  });
});

describe('H — prompt block and schema', () => {
  it('dietary block allows a listed restaurant once more on a different day only when the list is short; never same day / outside list', () => {
    const b = buildDietarySafetyBlock(['Halal']);
    expect(b).toMatch(/fewer restaurants than that city's meals/);
    expect(b).toMatch(/DIFFERENT day/);
    expect(b).toMatch(/"revisit": true/);
    expect(b).toMatch(/Never the same restaurant twice on the same day; never a restaurant outside the list/);
    expect(buildDietarySafetyBlock(['Meat'])).toBe('');
  });
  // 2026-10-24 r4 (Astra P1): 시스템 프롬프트와 식이 블록이 같은 규칙 — "끼니를 비워라" 가 식이 손님에게 남아 있으면 안 된다.
  it('system prompt and dietary block agree: dietary guests revisit on a different day instead of leaving the meal empty', () => {
    const sys = buildSystemPrompt('en');
    expect(sys).toContain('Halal/Vegan/Vegetarian guests: if that city\'s list has fewer restaurants than that city\'s meals, do NOT leave the meal empty');
    expect(sys).toContain('set "revisit": true on that stop. Never the same restaurant twice on the same day.');
    expect(sys).toContain('Other guests: if the list is too short, leave that meal out.');
    expect(sys).not.toContain('Each restaurant at most once per trip');
    expect(sys).not.toContain('If the list is too short, leave that meal out — never invent one.');
    const b = buildDietarySafetyBlock(['Vegan']);
    expect(b).not.toMatch(/leave that meal out/);
    expect(b).toMatch(/do NOT leave the meal empty/);
    expect(b).toMatch(/Never invent a restaurant/);
  });
  it('stop schema has revisit: BOOLEAN in properties and propertyOrdering', () => {
    const stopItems = (PLAN_RESPONSE_SCHEMA as { properties: { days: { items: { properties: { stops: { items: { properties: Record<string, { type: string }>; propertyOrdering: string[] } } } } } } })
      .properties.days.items.properties.stops.items;
    expect(stopItems.properties.revisit).toEqual({ type: 'BOOLEAN' });
    expect(stopItems.propertyOrdering).toContain('revisit');
  });
});
