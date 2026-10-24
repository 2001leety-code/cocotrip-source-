/**
 * 2026-10-24 — 재방문 정책 3단계: 안내 문구(src/lib/revisitNote.js) · applyRevisitNotes(R6) · 공개 투영 · 번역 · 수정 API.
 *   안내 = "이 식당은 일정에 한 번 더 들어갑니다 — 근처에 검증된 대안이 부족합니다."(제공 보장 없음). 실호출 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REVISIT_NOTE, revisitNote, stripRevisitNote } from '../../src/lib/revisitNote.js';
import { applyRevisitNotes as persisterApply } from '../../api/_ai_core/planPersister.js';
import { applyRevisitNotes, normalizeRevisits, judgeRepeats } from '../../api/_ai_core/revisitPolicy.js';
import { projectPublicPlan } from '../../api/_shared/public-plan-projection.js';

type Stop = Record<string, unknown>;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const A = { name: '합성A', nameEn: '합성A EN', city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly', address: '서울특별시 중구 1', lat: 37.56, lng: 126.98 };
const plan = (second: Stop = {}) => ({ days: [
  { day: 1, city: 'seoul', stops: [{ category: 'food', name: '합성A', start_time: '12:00', verified: true, tip: 'Lunch spot.' }] },
  { day: 2, city: 'seoul', stops: [{ category: 'food', name: '합성A', start_time: '12:00', verified: true, revisit: true, tip: 'Try the curry.', ...second }] },
] });
const second = (p: { days: Array<{ stops: Stop[] }> }) => p.days[1].stops[0];

describe('revisit note text', () => {
  it('four languages, no guarantee wording; unknown language → en', () => {
    expect(Object.keys(REVISIT_NOTE).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
    expect(REVISIT_NOTE.ko).toBe('이 식당은 일정에 한 번 더 들어갑니다 — 근처에 검증된 대안이 부족합니다.');
    for (const t of Object.values(REVISIT_NOTE)) expect(t).not.toMatch(/guarantee|보장|保証|保证|certif|인증/i);
    expect(revisitNote('fr')).toBe(REVISIT_NOTE.en);
  });
  it('strip removes every language note (and a stored value) but leaves an untouched tip byte-identical', () => {
    expect(stripRevisitNote(`Curry. ${REVISIT_NOTE.ja} ${REVISIT_NOTE.en}`)).toBe('Curry.');
    expect(stripRevisitNote('Line1\n\nLine2')).toBe('Line1\n\nLine2');
    expect(stripRevisitNote('Curry. CUSTOM', 'CUSTOM')).toBe('Curry.');
  });
});

describe('applyRevisitNotes (planPersister export = revisitPolicy implementation)', () => {
  it('same function exported from planPersister', () => { expect(persisterApply).toBe(applyRevisitNotes); });
  it.each(Object.entries(REVISIT_NOTE))('%s: appended once to the revisit stop tip, stored in revisit_note; first visit untouched', (lang, note) => {
    const p = plan();
    expect(applyRevisitNotes(p, { language: lang })).toBe(1);
    expect(second(p)).toMatchObject({ tip: `Try the curry. ${note}`, revisit_note: note, _revisit_note: true });
    expect(p.days[0].stops[0].tip).toBe('Lunch spot.');
    expect(p.days[0].stops[0]).not.toHaveProperty('revisit_note');
  });
  it('idempotent; switching language replaces (never stacks); unmarking removes the note', () => {
    const p = plan();
    applyRevisitNotes(p, { language: 'en' });
    const once = JSON.stringify(p);
    applyRevisitNotes(p, { language: 'en' });
    expect(JSON.stringify(p)).toBe(once);
    applyRevisitNotes(p, { language: 'ja' });
    expect(second(p).tip).toBe(`Try the curry. ${REVISIT_NOTE.ja}`);
    delete second(p).revisit;
    applyRevisitNotes(p, { language: 'ja' });
    expect(second(p).tip).toBe('Try the curry.');
    expect(second(p)).not.toHaveProperty('revisit_note');
  });
  it('after pass3 overwrites the tip (no note), re-applying restores exactly one note', () => {
    const p = plan();
    applyRevisitNotes(p, { language: 'ko' });
    second(p).tip = 'Pass3 rewrote this tip.'; // threePassPipeline.pass3Enrich 와 같은 덮어쓰기
    applyRevisitNotes(p, { language: 'ko' });
    expect(second(p).tip).toBe(`Pass3 rewrote this tip. ${REVISIT_NOTE.ko}`);
  });
  it('tip_en carrying an old note is cleaned too', () => {
    const p = plan({ tip_en: `Curry. ${REVISIT_NOTE.en}` });
    applyRevisitNotes(p, { language: 'ko' });
    expect(second(p).tip_en).toBe('Curry.');
  });
});

describe('public projection (viewer language)', () => {
  const stored = () => {
    const p = plan();
    applyRevisitNotes(p, { language: 'ko' });
    return { id: 'x', isPublic: true, input: { language: 'ko' }, itinerary: p };
  };
  const stopOf = (o: unknown) => (o as { itinerary: { days: Array<{ stops: Stop[] }> } }).itinerary.days[1].stops[0];
  it('keeps revisit: true and shows the note in the viewer language (no stored-language note left)', () => {
    const en = projectPublicPlan(stored(), { language: 'en' });
    expect(stopOf(en)).toMatchObject({ revisit: true, revisit_note: REVISIT_NOTE.en, tip: `Try the curry. ${REVISIT_NOTE.en}` });
    expect(JSON.stringify(en)).not.toContain(REVISIT_NOTE.ko);
  });
  it('re-projection is idempotent per language and switches cleanly (shared-view language switch)', () => {
    const en = projectPublicPlan(stored(), { language: 'en' });
    expect(projectPublicPlan(en, { language: 'en' })).toEqual(en);
    const zh = projectPublicPlan(en, { language: 'zh' });
    expect(stopOf(zh).tip).toBe(`Try the curry. ${REVISIT_NOTE.zh}`);
  });
  it('a stop without revisit gets no note', () => {
    const out = projectPublicPlan({ id: 'y', isPublic: true, input: {}, itinerary: plan({ revisit: undefined }) }, { language: 'en' });
    expect(stopOf(out)).not.toHaveProperty('revisit_note');
  });
});

describe('modify API and translation wiring', () => {
  it('modify: deleting the first visit → the later stop is unflagged (markOnly) and its note removed', () => {
    const p = plan();
    applyRevisitNotes(p, { language: 'en' });
    p.days[0].stops = []; // 사용자가 Day 1 식당을 지움
    normalizeRevisits(p, { foodIndex: [A], dietary: ['Halal'] }, { mode: 'markOnly' });
    applyRevisitNotes(p, { language: 'en' });
    expect(second(p)).not.toHaveProperty('revisit');
    expect(second(p).tip).toBe('Try the curry.');
    expect(judgeRepeats(p, { foodIndex: [A], dietary: ['Halal'] }).duplicates).toEqual([]);
  });
  it('modify source: swapped stop drops revisit fields; save path = normalize(markOnly) → notes → duplicate gate (422)', () => {
    const src = read('api/ai-planner-modify.js');
    expect(src).toMatch(/delete swapped\.revisit;\s*delete swapped\.revisit_note;\s*delete swapped\._revisit_note;/);
    const i = src.indexOf("normalizeRevisits(itinerary, revisitCtx, { mode: 'markOnly' })");
    expect(i).toBeGreaterThan(-1);
    expect(src.indexOf('applyRevisitNotes(itinerary, { language })', i)).toBeGreaterThan(i);
    expect(src.indexOf('runDuplicateStopGate(itinerary, revisitCtx)', i)).toBeGreaterThan(i);
    expect(src.indexOf('runDuplicateStopGate(itinerary, revisitCtx)')).toBeLessThan(src.indexOf('// ── persist'));
  });
  it('translate-plan: note stripped before translation, target-language note attached after', () => {
    const src = read('api/translate-plan.js');
    expect(src).toMatch(/\(f === 'tip' \|\| f === 'tip_en'\) \? stripRevisitNote\(stop\[f\], stop\.revisit_note\) : stop\[f\]/);
    expect(src).toMatch(/applyRevisitNotes\(result_plan, \{ language: targetLang \}\);/);
  });
  it('pipelines: notes follow normalization at the final gate and after background pass3', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    const n = post.indexOf("normalizeRevisits(itinerary, revisitCtx, { mode: 'markOnly' })");
    expect(n).toBeGreaterThan(-1);
    expect(post.indexOf('applyRevisitNotes(itinerary, { language })', n)).toBeGreaterThan(n);
    expect(post.indexOf("assertNoDuplicateStops(itinerary, blockModeUsed ? 'block_mode' : 'post_response', revisitCtx)")).toBeGreaterThan(n);
    const bg = read('api/_ai_core/backgroundPipelines.js');
    expect(bg).toMatch(/normalizeRevisits\(enriched, revisitCtx, \{ mode: 'markOnly' \}\);\s*applyRevisitNotes\(enriched, \{ language \}\);/);
    expect(bg).toMatch(/runDuplicateStopGate\(enriched, revisitCtx\)/);
  });
  it('pre-route normalization (replace mode) runs inside runRouteEnrichment before RouteAgent; both callers pass diet + avoid', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    const fn = post.slice(post.indexOf('export async function runRouteEnrichment'));
    expect(fn.indexOf("{ mode: 'replace' }")).toBeGreaterThan(-1);
    expect(fn.indexOf("{ mode: 'replace' }")).toBeLessThan(fn.indexOf('enrichItineraryWithRoute('));
    expect(read('api/_ai_core/handlerCore.js')).toMatch(/runRouteEnrichment\(itinerary, \{[^}]*dietPrefs: dietaryAll, avoidStopNames \}\)/);
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/dietPrefs: ctx\.dietPrefs,\s*avoidStopNames: ctx\.avoidStopNames,/);
  });
  it('harness: compare free loop passes ctx and records approved revisits; prod regression B-18 uses the judge only', () => {
    const free = read('scripts/integration/llm-compare-free.mjs');
    expect(free).toMatch(/d\.runDuplicateStopGate\(plan, \{ foodIndex: d\.foodIndex, dietary: p\.dietaryAll \}\)/);
    expect(free).toMatch(/row\.revisits = \(gate\.revisits \|\| \[\]\)/);
    const reg = read('scripts/validate-prod-regression.mjs');
    expect(reg).toMatch(/judgeRepeats\(itin, \{ foodIndex, dietary: SCENARIO_DIETARY \}\)\.revisits/);
    expect(reg).not.toMatch(/s\.revisit\b/); // 원시 플래그는 보지 않는다
  });
});
