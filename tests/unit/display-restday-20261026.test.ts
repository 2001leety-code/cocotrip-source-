/**
 * 2026-10-26 웹 표시 정리 (Astra 권고 — 운영자 승인).
 *   D3  DayTimeline: 휴식일 Day1 첫 숙소(안내 붙은 stop)는 '출발' 이 아니라 '체크인'.
 *   D5① applyArrivalRestNote: 조건이 안 맞으면 예전에 붙인 안내(고정 문장 + 표식)만 뗀다. 수정 API 가 저장 직전 재호출.
 *   D5② PDF 휴식 카드: 장소 수가 아니라 실제 휴식일만, 문구는 arrivalRestNote 4개 언어.
 *   C   2일+ 여행 식사 stop 0 → 화면 안내(4개 언어).
 *   실호출 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyArrivalRestNote, stripArrivalRestNote, applyDepartureBreakfastNote } from '../../api/_ai_core/planPersister.js';
import { ARRIVAL_REST_NOTE, hasArrivalRestNote, isArrivalRestDay1, arrivalRestTomorrowLine, ARRIVAL_REST_TOMORROW } from '../../src/lib/arrivalRestNote.js';
import { DEPARTURE_BREAKFAST_NOTE } from '../../src/lib/departureBreakfastNote.js';
import { noMealStopsNotices, USER_VISIBLE_KINDS } from '../../src/pages/PlanDetailPage/lib/userPlanNotices';

type Stop = Record<string, unknown>;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const lodging = (t: string, o: Stop = {}): Stop => ({ category: 'lodging', name: 'Hotel', start_time: t, ...o });
const food = (name: string, t: string): Stop => ({ category: 'food', name, start_time: t, stay_min: 60 });
const plan = (day1: Stop[]) => ({ days: [{ day: 1, city: 'seoul', stops: day1 }, { day: 2, city: 'seoul', stops: [lodging('09:00'), food('점심', '12:00')] }] });

describe('hasArrivalRestNote', () => {
  it('string note or the boolean marker', () => {
    expect(hasArrivalRestNote({ arrival_rest_note: ARRIVAL_REST_NOTE.en })).toBe(true);
    expect(hasArrivalRestNote({ _arrival_rest_note: true })).toBe(true);
    expect(hasArrivalRestNote({ arrival_rest_note: '' })).toBe(false);
    expect(hasArrivalRestNote({ tip: ARRIVAL_REST_NOTE.en })).toBe(false);
    expect(hasArrivalRestNote(null)).toBe(false);
  });
});

describe('D3 — DayTimeline lodging role', () => {
  const src = read('src/pages/PlanDetailPage/components/DayTimeline.tsx');
  it("rest-day Day1 first lodging with the note → 'checkin', checked after the intercity branch and before the generic 'depart'", () => {
    const intercity = src.indexOf('if (isFirst && hasIntercity) {');
    const rest = src.indexOf("if (isFirst && hasArrivalRestNote(stop)) return 'checkin';");
    const depart = src.indexOf("if (isFirst) return 'depart';");
    expect(intercity).toBeGreaterThan(-1);
    expect(rest).toBeGreaterThan(intercity);
    expect(depart).toBeGreaterThan(rest);
    expect(src).toContain("import { hasArrivalRestNote } from '@/lib/arrivalRestNote.js';");
  });
});

describe('D5① — stale arrival rest note is removed', () => {
  it('a food stop added to Day 1 later → only the fixed sentence and markers go, the guest/model tip stays', () => {
    const p = plan([lodging('23:00', { tip: 'Check in after 3pm.' }), lodging('23:30')]);
    expect(applyArrivalRestNote(p, { restDay: true, language: 'ko' })).toBe(true);
    expect(p.days[0].stops[0].tip).toBe(`Check in after 3pm. ${ARRIVAL_REST_NOTE.ko}`);
    p.days[0].stops.splice(1, 0, food('늦은 저녁', '21:10'));
    expect(applyArrivalRestNote(p, { restDay: true, language: 'ko' })).toBe(false);
    expect(p.days[0].stops[0]).toMatchObject({ tip: 'Check in after 3pm.' });
    expect(p.days[0].stops[0]).not.toHaveProperty('arrival_rest_note');
    expect(p.days[0].stops[0]).not.toHaveProperty('_arrival_rest_note');
  });
  it('not a rest day any more (flag false) → note removed; a note-only tip is deleted entirely', () => {
    const p = plan([lodging('23:00'), lodging('23:30')]);
    applyArrivalRestNote(p, { restDay: true, language: 'ja' });
    expect(p.days[0].stops[0].tip).toBe(ARRIVAL_REST_NOTE.ja);
    expect(applyArrivalRestNote(p, { restDay: false, language: 'ja' })).toBe(false);
    expect(p.days[0].stops[0]).not.toHaveProperty('tip');
    expect(hasArrivalRestNote(p.days[0].stops[0])).toBe(false);
  });
  it('other notes on the same tip are kept (departure breakfast note), and a different-language note is also recognised', () => {
    const stop: Stop = lodging('06:00', { tip: `Front desk 24h. ${ARRIVAL_REST_NOTE.en} ${DEPARTURE_BREAKFAST_NOTE.en}`, arrival_rest_note: ARRIVAL_REST_NOTE.zh, _arrival_rest_note: true });
    expect(stripArrivalRestNote(stop)).toBe(true);
    expect(stop.tip).toBe(`Front desk 24h. ${DEPARTURE_BREAKFAST_NOTE.en}`);
  });
  it('a stop without the marker is never touched, even if its tip happens to contain the sentence', () => {
    const stop: Stop = lodging('23:00', { tip: `Guest wrote: ${ARRIVAL_REST_NOTE.en}` });
    expect(stripArrivalRestNote(stop)).toBe(false);
    expect(stop.tip).toBe(`Guest wrote: ${ARRIVAL_REST_NOTE.en}`);
  });
  it('still a rest day → re-apply is idempotent (no duplicate sentence)', () => {
    const p = plan([lodging('23:00'), lodging('23:30')]);
    applyArrivalRestNote(p, { restDay: true, language: 'en' });
    const once = JSON.stringify(p);
    expect(applyArrivalRestNote(p, { restDay: true, language: 'en' })).toBe(false);
    expect(JSON.stringify(p)).toBe(once);
  });
  it('breakfast note path is unaffected', () => {
    const p = { days: [{ day: 1, city: 'seoul', stops: [lodging('23:00')] }, { day: 2, city: 'seoul', stops: [lodging('06:00'), { category: 'airport', name: 'ICN', start_time: '07:00' }] }] };
    applyArrivalRestNote(p, { restDay: true, language: 'en' });
    applyDepartureBreakfastNote(p, { departureTime: '10:00', language: 'en' });
    applyArrivalRestNote(p, { restDay: false, language: 'en' });
    expect(p.days[1].stops[0].tip).toBe(DEPARTURE_BREAKFAST_NOTE.en);
  });
  it('modify API: one rest-day flag (stored boolean first) for validation and a re-judge right before saving', () => {
    const src = read('api/ai-planner-modify.js');
    expect(src).toContain("import { backfillStopEndTimes, applyArrivalRestNote } from './_ai_core/planPersister.js';");
    expect(src).toMatch(/const arrivalRestDay = typeof planData\.input\?\.arrival_rest_day === 'boolean'\s*\? planData\.input\.arrival_rest_day/);
    expect(src).toContain('arrival_rest_day: arrivalRestDay,');
    const dup = src.indexOf('runDuplicateStopGate(itinerary, revisitCtx)');
    const note = src.indexOf('applyArrivalRestNote(itinerary, { restDay: arrivalRestDay === true, language });');
    const save = src.indexOf('await docRef.set({', note);
    expect(dup).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(dup);
    expect(save).toBeGreaterThan(note);
  });
});

describe('D5② — PDF rest card only on a real rest day', () => {
  it('isArrivalRestDay1', () => {
    expect(isArrivalRestDay1([lodging('23:00', { _arrival_rest_note: true })], { totalDays: 3 })).toBe(true);
    expect(isArrivalRestDay1([lodging('23:00'), lodging('23:30')], { inputRestDay: true, totalDays: 3 })).toBe(true);
    expect(isArrivalRestDay1([], { inputRestDay: true, totalDays: 2 })).toBe(true);
    // 장소 수가 1 이어도 식당 하나인 날은 휴식일 아님.
    expect(isArrivalRestDay1([food('Dinner', '21:10')], { inputRestDay: true, totalDays: 3 })).toBe(false);
    expect(isArrivalRestDay1([lodging('23:00'), food('Dinner', '23:10')], { inputRestDay: true, totalDays: 3 })).toBe(false);
    // 숙소 하나뿐이어도 휴식일 근거(안내·플래그)가 없으면 아님.
    expect(isArrivalRestDay1([lodging('15:00')], { totalDays: 3 })).toBe(false);
    expect(isArrivalRestDay1([lodging('15:00')], { inputRestDay: 'yes', totalDays: 3 })).toBe(false);
    // 1일 여행 제외.
    expect(isArrivalRestDay1([lodging('23:00', { _arrival_rest_note: true })], { inputRestDay: true, totalDays: 1 })).toBe(false);
  });
  it('tomorrow line in four languages', () => {
    expect(Object.keys(ARRIVAL_REST_TOMORROW).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
    expect(arrivalRestTomorrowLine('ko', '10:00')).toBe('내일 일정은 10:00에 시작해요.');
    expect(arrivalRestTomorrowLine('fr', '09:00')).toBe('Your tour starts tomorrow at 09:00.');
  });
  it('pdfGenerator uses the predicate and the shared 4-language copy (no hard-coded English, no stop-count rule)', () => {
    const src = read('src/pages/PlanDetailPage/pdfGenerator.ts');
    expect(src).toContain("import { arrivalRestNote, arrivalRestTomorrowLine, isArrivalRestDay1 } from '@/lib/arrivalRestNote.js';");
    expect(src).toMatch(/\(day\.day === 1 \|\| di === 0\) && isArrivalRestDay1\(day\.stops \|\| \[\], \{/);
    expect(src).toContain('${arrivalRestNote(lang)}');
    expect(src).toContain('${arrivalRestTomorrowLine(lang, tourStart)}');
    expect(src).not.toContain('Late arrival? Rest at your hotel');
    expect(src).not.toContain('Your tour starts tomorrow at ${tourStart}');
    expect(src).not.toMatch(/\(day\.day === 1 \|\| di === 0\) && \(day\.stops \|\| \[\]\)\.length <= 1/);
  });
});

describe('C — no meal stops in a 2+ day trip → user notice', () => {
  it('noMealStopsNotices', () => {
    const noMeals = { days: [{ stops: [lodging('23:00')] }, { stops: [lodging('06:00'), { category: 'airport' }] }] };
    expect(noMealStopsNotices(noMeals)).toEqual([{ kind: 'no_meal_stops', severity: 'low' }]);
    expect(noMealStopsNotices({ days: [{ stops: [lodging('23:00')] }, { stops: [food('A', '08:00')] }] })).toEqual([]);
    expect(noMealStopsNotices({ days: [{ stops: [lodging('09:00')] }] })).toEqual([]);
    expect(noMealStopsNotices(null)).toEqual([]);
  });
  it('whitelisted, merged into the plan page panel, and translated in all four locales', () => {
    expect(USER_VISIBLE_KINDS.no_meal_stops).toBe('noMealStops');
    expect(read('src/pages/PlanDetailPage/index.tsx')).toContain('...noMealStopsNotices(plan.itinerary as never),');
    for (const l of ['ko', 'en', 'ja', 'zh']) {
      const json = JSON.parse(read(`src/i18n/locales/${l}.json`));
      expect(typeof json.planDetail?.notices?.noMealStops, l).toBe('string');
      expect(json.planDetail.notices.noMealStops.length, l).toBeGreaterThan(5);
    }
  });
});
