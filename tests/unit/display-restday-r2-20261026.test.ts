/**
 * 2026-10-26 표시 PR r2 회귀 — 적대적 검증 3렌즈 + Astra r2 남은 지적.
 *   1 공개 화면 번역: 숙소가 아닌 stop(블록모드 출국일 공항 stop)의 조식 안내가 투영·번역에서 사라지지 않는다(실제 handler).
 *   3 applyArrivalRestNote 멱등: Day1 어느 stop 에든 안내가 있으면 no-op(숙소 순서 바꿔도 1개).
 *   5 화면 편집: 출국일에 식당이 생기면 조식 안내 제거.
 *   6 식사 없음 안내 원인: 모든 날이 휴식일 Day1 / 11:00 전 출국일로 설명될 때만.
 *   7 예전 플랜(arrival_rest_day 필드 없음): 도착 ≥ 18:00 로 휴식 카드 대체 판정.
 *   외부 호출 0(LLM·rate-limit·Firestore mock).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: vi.fn(async () => ({ ok: true })), getClientIp: () => '127.0.0.1' }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => ({}) }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: vi.fn() }));
vi.mock('../../api/_shared/llm/index.js', () => ({
  wantsLlmMock: () => false,
  runWithLlmContext: (_ctx: unknown, fn: () => unknown) => fn(),
  // 번역기 대역: descriptive 는 'JA:' 접두(본문이 번역됐다는 표시), transit 은 그대로.
  createLlmModel: () => ({
    modelId: 'mock',
    generateContent: async (prompt: string) => {
      const input = JSON.parse(prompt.slice(prompt.lastIndexOf('Input:') + 'Input:'.length).trim());
      const out = { descriptive: input.descriptive.map((t: string) => `JA:${t}`), transit: input.transit };
      return { response: { text: () => JSON.stringify(out) } };
    },
  }),
}));

import { projectPublicPlan } from '../../src/lib/publicPlanProjection.js';
import { DEPARTURE_BREAKFAST_NOTE, stripBreakfastNoteIfLastDayHasMeal, hasBreakfastNote } from '../../src/lib/departureBreakfastNote.js';
import { ARRIVAL_REST_NOTE, hasArrivalRestNote, isArrivalRestDay1 } from '../../src/lib/arrivalRestNote.js';
import { stripFixedTipNotes } from '../../src/lib/fixedTipNotes.js';
import { applyArrivalRestNote } from '../../api/_ai_core/planPersister.js';
import { noMealStopsInfo } from '../../src/pages/PlanDetailPage/lib/userPlanNotices';

type Stop = Record<string, unknown>;
type Itin = { days: Array<{ day?: number; city?: string; stops: Stop[] }> };
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const lodging = (t: string, o: Stop = {}): Stop => ({ category: 'lodging', name: 'Hotel', start_time: t, ...o });
const count = (s: string, needle: string) => s.split(needle).length - 1;

async function translate(plan: unknown, targetLang: string) {
  const handler = (await import('../../api/translate-plan.js')).default;
  const res = { code: 0, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await handler({ method: 'POST', headers: {}, body: { plan, targetLang } } as never, res as never);
  return res as { code: number; body: { data: { translated: Itin; translatorVersion: number } } };
}

describe('r2-1 — public view translation keeps the breakfast note on a non-lodging (airport) stop', () => {
  // 블록모드 출국일: 조식 안내가 selfHeal 이전에 붙어 공항 stop 이 받는다.
  const owner = () => ({ days: [
    { day: 1, city: 'seoul', stops: [lodging('09:00'), { category: 'culture', name: '경복궁', start_time: '10:00', tip: '한복 입장 무료.' }] },
    { day: 2, city: 'seoul', stops: [
      { category: 'airport', name: 'Incheon International Airport', start_time: '07:00', tip: `3시간 전 도착. ${DEPARTURE_BREAKFAST_NOTE.ko}`, breakfast_note: DEPARTURE_BREAKFAST_NOTE.ko, _breakfast_note: true },
    ] },
  ] });

  it('projection keeps the marker and uses the viewer language on non-lodging stops (idempotent)', () => {
    const proj = projectPublicPlan({ id: 'p', isPublic: true, input: {}, itinerary: owner() }, { language: 'en' }) as { itinerary: Itin };
    const air = proj.itinerary.days[1].stops[0];
    expect(air).toMatchObject({ breakfast_note: DEPARTURE_BREAKFAST_NOTE.en, tip: `3시간 전 도착. ${DEPARTURE_BREAKFAST_NOTE.en}` });
    expect(projectPublicPlan(proj as never, { language: 'en' })).toEqual(proj);
  });
  it('real translate-plan handler: body translated once, note re-attached once in the target language', async () => {
    const proj = projectPublicPlan({ id: 'p', isPublic: true, input: {}, itinerary: owner() }, { language: 'ko' }) as { itinerary: Itin };
    const r = await translate(proj.itinerary, 'ja');
    expect(r.code).toBe(200);
    expect(r.body.data.translatorVersion).toBe(3);
    const air = r.body.data.translated.days[1].stops[0];
    expect(air.tip).toBe(`JA:3시간 전 도착. ${DEPARTURE_BREAKFAST_NOTE.ja}`);
    expect(air.breakfast_note).toBe(DEPARTURE_BREAKFAST_NOTE.ja);
    expect(count(String(air.tip), DEPARTURE_BREAKFAST_NOTE.ko)).toBe(0);
  });
  it('a stop whose tip has the sentence but no marker: the sentence goes to the translator as before (not dropped)', async () => {
    const plan = { days: [{ stops: [lodging('09:00')] }, { stops: [{ category: 'airport', name: 'ICN', start_time: '07:00', tip: DEPARTURE_BREAKFAST_NOTE.ko }] }] };
    expect(stripFixedTipNotes(DEPARTURE_BREAKFAST_NOTE.ko, plan.days[1].stops[0])).toBe(DEPARTURE_BREAKFAST_NOTE.ko);
    const r = await translate(plan, 'ja');
    expect(r.body.data.translated.days[1].stops[0].tip).toBe(`JA:${DEPARTURE_BREAKFAST_NOTE.ko}`);
  });
  it('a marked stop with a note-only tip: no empty translation, target-language note only', async () => {
    const plan = { days: [{ stops: [lodging('23:00', { tip: ARRIVAL_REST_NOTE.ko, arrival_rest_note: ARRIVAL_REST_NOTE.ko, _arrival_rest_note: true })] }, { stops: [lodging('09:00')] }] };
    const r = await translate(plan, 'ja');
    expect(r.body.data.translated.days[0].stops[0]).toMatchObject({ tip: ARRIVAL_REST_NOTE.ja, arrival_rest_note: ARRIVAL_REST_NOTE.ja });
  });
});

describe('r2-3 — applyArrivalRestNote is idempotent across all Day1 stops', () => {
  it('reordering the two Day1 hotels and re-applying keeps a single note', () => {
    const p: Itin = { days: [{ stops: [lodging('23:00', { name: 'A' }), lodging('23:30', { name: 'B' })] }, { stops: [lodging('09:00')] }] };
    expect(applyArrivalRestNote(p, { restDay: true, language: 'en' })).toBe(true);
    p.days[0].stops.reverse();
    expect(applyArrivalRestNote(p, { restDay: true, language: 'en' })).toBe(false);
    expect(p.days[0].stops.filter(hasArrivalRestNote)).toHaveLength(1);
    expect(count(JSON.stringify(p), ARRIVAL_REST_NOTE.en)).toBe(2); // tip + arrival_rest_note 필드(한 stop)
  });
});

describe('r2-5 — editor: a meal added on the departure day removes the breakfast note', () => {
  const plan = (): Itin => ({ days: [{ stops: [lodging('09:00')] }, { stops: [lodging('06:00', { tip: `Front desk 24h. ${DEPARTURE_BREAKFAST_NOTE.en}`, breakfast_note: DEPARTURE_BREAKFAST_NOTE.en, _breakfast_note: true }), { category: 'airport', start_time: '07:00' }] }] });
  it('no meal → untouched; meal added → sentence + markers removed, rest of tip kept', () => {
    const p = plan();
    expect(stripBreakfastNoteIfLastDayHasMeal(p)).toBe(false);
    expect(hasBreakfastNote(p.days[1].stops[0])).toBe(true);
    p.days[1].stops.splice(1, 0, { category: 'food', name: 'Breakfast cafe', start_time: '06:20' });
    expect(stripBreakfastNoteIfLastDayHasMeal(p)).toBe(true);
    expect(p.days[1].stops[0]).toMatchObject({ tip: 'Front desk 24h.' });
    expect(hasBreakfastNote(p.days[1].stops[0])).toBe(false);
  });
  it('1-day trip is not touched; every editor save path calls it', () => {
    const one: Itin = { days: [{ stops: [{ category: 'food', name: 'A' }, lodging('06:00', { breakfast_note: 'x', _breakfast_note: true })] }] };
    expect(stripBreakfastNoteIfLastDayHasMeal(one)).toBe(false);
    const editor = read('src/pages/PlanDetailPage/hooks/usePlanEditor.ts');
    expect((editor.match(/stripBreakfastNoteIfLastDayHasMeal\(\{ days: nextDays \}\);/g) || []).length).toBe(4);
  });
});

describe('r2-6 — no-meal causes only when every meal-less day is explained', () => {
  const none = (n: number): Itin => ({ days: Array.from({ length: n }, () => ({ stops: [lodging('09:00')] })) });
  it.each([
    ['2 days, rest + 10:00 departure', 2, { arrival_rest_day: true, departure_time: '10:00' }, true, true],
    ['2 days, rest + 11:00 departure (day 2 unexplained)', 2, { arrival_rest_day: true, departure_time: '11:00' }, false, false],
    ['2 days, not rest + 10:00 departure (day 1 unexplained)', 2, { arrival_rest_day: false, departure_time: '10:00' }, false, false],
    ['3 days, rest + 10:00 departure (middle day unexplained)', 3, { arrival_rest_day: true, departure_time: '10:00' }, false, false],
  ])('%s', (_label, n, input, late, early) => {
    expect(noMealStopsInfo(none(n as number), input as never)).toEqual({ show: true, lateArrival: late, earlyDeparture: early });
  });
});

describe('r3-1 — Day1 first hotel label follows the rest-card decision (not only the note marker)', () => {
  it("label uses showArrivalRestCard: an unmarked first hotel on a flagged / legacy rest day is 'checkin'", () => {
    const src = read('src/pages/PlanDetailPage/components/DayTimeline.tsx');
    expect(src).toContain("if (isFirst && (hasArrivalRestNote(stop) || showArrivalRestCard)) return 'checkin';");
    expect(src.indexOf('const showArrivalRestCard')).toBeLessThan(src.indexOf('function computeLodgingRole('));
    // 재현: 편집으로 식당 추가→삭제(표식 제거됨) 후 / 옛 플랜 — 표식 없는 숙소지만 카드 판정은 참.
    expect(isArrivalRestDay1([lodging('23:00')], { totalDays: 3, inputRestDay: true })).toBe(true);
    expect(isArrivalRestDay1([lodging('23:00')], { totalDays: 3, inputArrivalTime: '19:30' })).toBe(true);
  });
});

describe('r3-2 — public projection exposes only a boolean arrival_rest_day (derived for old plans)', () => {
  const doc = (input: Record<string, unknown>) => ({ id: 'p', isPublic: true, input, itinerary: { days: [{ day: 1, stops: [lodging('23:00')] }, { day: 2, stops: [lodging('09:00')] }] } });
  const projInput = (input: Record<string, unknown>) => (projectPublicPlan(doc(input), { language: 'en' }) as { input?: Record<string, unknown> }).input || {};
  it('stored boolean passes through; the raw arrival time never does', () => {
    expect(projInput({ arrival_rest_day: true, arrival_time: '19:00' })).toEqual({ arrival_rest_day: true });
    expect(projInput({ arrival_rest_day: false, arrival_time: '19:00' })).toEqual({ arrival_rest_day: false });
  });
  it('old plan (field missing): arrival ≥ 18:00 → true; earlier / malformed → absent', () => {
    expect(projInput({ arrival_time: '19:00' })).toEqual({ arrival_rest_day: true });
    expect(projInput({ arrivalTime: '18:00' })).toEqual({ arrival_rest_day: true });
    expect(projInput({ arrival_time: '17:59' })).not.toHaveProperty('arrival_rest_day');
    expect(projInput({ arrival_time: '7pm' })).not.toHaveProperty('arrival_rest_day');
    expect(JSON.stringify(projectPublicPlan(doc({ arrival_time: '19:00' }), { language: 'en' }))).not.toContain('19:00');
  });
  it('re-projection is idempotent and the public card decision matches', () => {
    const once = projectPublicPlan(doc({ arrival_time: '19:00' }), { language: 'en' }) as { input: { arrival_rest_day?: unknown }; itinerary: Itin };
    expect(projectPublicPlan(once as never, { language: 'en' })).toEqual(once);
    expect(isArrivalRestDay1(once.itinerary.days[0].stops, { inputRestDay: once.input.arrival_rest_day, totalDays: once.itinerary.days.length })).toBe(true);
  });
});

describe('r2-7 — old plans without input.arrival_rest_day fall back to arrival ≥ 18:00', () => {
  it('fallback only when the field is missing; strict time parser', () => {
    const day1 = [lodging('23:00')];
    expect(isArrivalRestDay1(day1, { totalDays: 3, inputArrivalTime: '19:00' })).toBe(true);
    expect(isArrivalRestDay1(day1, { totalDays: 3, inputArrivalTime: '18:00' })).toBe(true);
    expect(isArrivalRestDay1(day1, { totalDays: 3, inputArrivalTime: '17:59' })).toBe(false);
    expect(isArrivalRestDay1(day1, { totalDays: 3, inputArrivalTime: '7pm' })).toBe(false);
    expect(isArrivalRestDay1(day1, { totalDays: 3, inputRestDay: false, inputArrivalTime: '19:00' })).toBe(false);
    expect(isArrivalRestDay1([...day1, { category: 'food' }], { totalDays: 3, inputArrivalTime: '19:00' })).toBe(false);
    expect(isArrivalRestDay1(day1, { totalDays: 1, inputArrivalTime: '19:00' })).toBe(false);
  });
  it('screen and PDF both pass the stored arrival time', () => {
    for (const f of ['src/pages/PlanDetailPage/components/DayTimeline.tsx', 'src/pages/PlanDetailPage/pdfGenerator.ts']) {
      expect(read(f), f).toMatch(/inputArrivalTime: \(/);
    }
  });
});
