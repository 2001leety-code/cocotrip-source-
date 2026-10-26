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
import { ARRIVAL_REST_NOTE, hasArrivalRestNote, isArrivalRestDay1, arrivalRestTomorrowLine, ARRIVAL_REST_TOMORROW, nextDayStartTime, stripArrivalRestNoteIfDay1Active } from '../../src/lib/arrivalRestNote.js';
import { DEPARTURE_BREAKFAST_NOTE } from '../../src/lib/departureBreakfastNote.js';
import { stripFixedTipNotes, reattachFixedTipNotes } from '../../src/lib/fixedTipNotes.js';
import { isLikelyNoMealTrip, REST_DAY_LATE_ARRIVAL_MIN, EARLY_DEPARTURE_NO_BREAKFAST_MIN } from '../../src/lib/arrivalRestRules.js';
import * as C from '../../api/_ai_core/constants.js';
import { noMealStopsInfo, USER_VISIBLE_KINDS } from '../../src/pages/PlanDetailPage/lib/userPlanNotices';

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
    expect(src).toMatch(/import \{ hasArrivalRestNote,[^}]*\} from '@\/lib\/arrivalRestNote\.js';/);
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
    expect(src).toContain("import { arrivalRestTitle, arrivalRestTomorrowLine, isArrivalRestDay1, nextDayStartTime } from '@/lib/arrivalRestNote.js';");
    expect(src).toMatch(/\(day\.day === 1 \|\| di === 0\) && isArrivalRestDay1\(day\.stops \|\| \[\], \{/);
    expect(src).toContain('${arrivalRestTitle(lang)}'); // r2: 제목 ≠ 안내 문장(숙소 Tip 과 중복 금지)
    expect(src).toContain('const nextStart = nextDayStartTime(days, di);');
    expect(src).toContain('${nextStart ? `<p');
    expect(src).not.toContain('Late arrival? Rest at your hotel');
    expect(src).not.toMatch(/\(day\.day === 1 \|\| di === 0\) && \(day\.stops \|\| \[\]\)\.length <= 1/);
  });
});

describe('r1-3 — screen rest card uses the same predicate; "tomorrow" = next day\'s real first stop time', () => {
  it('nextDayStartTime: real first stop of the next day (strict HH:MM), else "" (no 09:00 default)', () => {
    const days = [{ stops: [lodging('23:00')] }, { stops: [lodging('06:30'), { category: 'airport', start_time: '07:00' }] }];
    expect(nextDayStartTime(days, 0)).toBe('06:30');
    expect(nextDayStartTime([{ stops: [] }, { stops: [] }], 0)).toBe('');
    expect(nextDayStartTime([{ stops: [] }, { stops: [{ start_time: '9:00' }] }], 0)).toBe('');
    expect(nextDayStartTime([{ stops: [] }], 0)).toBe('');
  });
  it('DayTimeline card: isArrivalRestDay1 (1-day trip excluded, two hotel stops still a rest day), hint line only with a real time', () => {
    const src = read('src/pages/PlanDetailPage/components/DayTimeline.tsx');
    expect(src).toMatch(/const showArrivalRestCard = \(day\.day === 1 \|\| dayIndex === 0\) && isArrivalRestDay1\(stops, \{/);
    expect(src).toContain('totalDays: planDays.length,');
    expect(src).toContain('const nextStart = nextDayStartTime(planDays, dayIndex);');
    expect(src).toContain('{showArrivalRestCard && (');
    expect(src).toContain('{arrivalOnlyHint && (');
    expect(src).not.toMatch(/stops\.length === 1 && stops\[0\]\?\.category === 'lodging' &&/);
    expect(isArrivalRestDay1([lodging('23:00', { _arrival_rest_note: true }), lodging('23:30')], { totalDays: 3 })).toBe(true);
    expect(isArrivalRestDay1([lodging('23:00')], { totalDays: 1 })).toBe(false);
  });
});

describe('r1-1 — screen edit save path re-judges the rest note', () => {
  it('stripArrivalRestNoteIfDay1Active: Day1 with a food/sight stop → note removed; Day1 hotels only → untouched', () => {
    const p = plan([lodging('23:00', { tip: 'Late check-in OK.' }), lodging('23:30')]);
    applyArrivalRestNote(p, { restDay: true, language: 'en' });
    expect(stripArrivalRestNoteIfDay1Active(p)).toBe(false);
    expect(hasArrivalRestNote(p.days[0].stops[0])).toBe(true);
    p.days[0].stops.push(food('Added dinner', '21:00'));
    expect(stripArrivalRestNoteIfDay1Active(p)).toBe(true);
    expect(p.days[0].stops[0]).toMatchObject({ tip: 'Late check-in OK.' });
    expect(hasArrivalRestNote(p.days[0].stops[0])).toBe(false);
  });
  it('the leaf is the single implementation (planPersister re-exports it) and every editor save calls it before setPlan/commit', () => {
    expect(read('api/_ai_core/planPersister.js')).toMatch(/import \{ arrivalRestNote, stripArrivalRestNote[^}]*\} from '\.\.\/\.\.\/src\/lib\/arrivalRestNote\.js';/);
    expect(read('api/_ai_core/planPersister.js')).not.toMatch(/export function stripArrivalRestNote/);
    const editor = read('src/pages/PlanDetailPage/hooks/usePlanEditor.ts');
    expect((editor.match(/stripArrivalRestNoteIfDay1Active\(\{ days: nextDays \}\);/g) || []).length).toBe(4);
    expect((editor.match(/await commitDays\(nextDays, snapshot\);/g) || []).length).toBe(4);
  });
});

describe('r1-2 — translation keeps fixed notes out of the model and re-attaches them in the target language', () => {
  it('stripFixedTipNotes removes revisit / rest / breakfast sentences (any language) without mutating the stop', () => {
    const stop: Stop = { tip: `Nice view. ${ARRIVAL_REST_NOTE.ko} ${DEPARTURE_BREAKFAST_NOTE.en}`, arrival_rest_note: ARRIVAL_REST_NOTE.ko, _arrival_rest_note: true, _breakfast_note: true };
    expect(stripFixedTipNotes(stop.tip as string, stop)).toBe('Nice view.');
    expect(stop.tip).toContain(ARRIVAL_REST_NOTE.ko);
    // r2: 표식이 없는 안내 문장은 떼지 않는다(번역 후 다시 붙일 근거가 없음 — 번역기에 맡김).
    const unmarked: Stop = { tip: `Nice view. ${DEPARTURE_BREAKFAST_NOTE.en}` };
    expect(stripFixedTipNotes(unmarked.tip as string, unmarked)).toBe(`Nice view. ${DEPARTURE_BREAKFAST_NOTE.en}`);
  });
  it('reattachFixedTipNotes: translated body + target-language rest then breakfast note; unmarked stops untouched', () => {
    const it = { days: [
      { stops: [{ category: 'lodging', tip: 'Bonne vue.', arrival_rest_note: ARRIVAL_REST_NOTE.ko, _arrival_rest_note: true }] },
      { stops: [{ category: 'lodging', tip: `Gardez vos bagages. ${DEPARTURE_BREAKFAST_NOTE.ko}`, breakfast_note: DEPARTURE_BREAKFAST_NOTE.ko, _breakfast_note: true }, { category: 'culture', tip: ARRIVAL_REST_NOTE.en }] },
    ] };
    reattachFixedTipNotes(it, 'ja');
    expect(it.days[0].stops[0]).toMatchObject({ tip: `Bonne vue. ${ARRIVAL_REST_NOTE.ja}`, arrival_rest_note: ARRIVAL_REST_NOTE.ja });
    expect(it.days[1].stops[0]).toMatchObject({ tip: `Gardez vos bagages. ${DEPARTURE_BREAKFAST_NOTE.ja}`, breakfast_note: DEPARTURE_BREAKFAST_NOTE.ja });
    expect(it.days[1].stops[1].tip).toBe(ARRIVAL_REST_NOTE.en); // 표식 없음 → 무변
  });
  it('translate-plan wiring: strip before batching tip, re-attach before applyRevisitNotes', () => {
    const src = read('api/translate-plan.js');
    expect(src).toContain("import { stripFixedTipNotes, reattachFixedTipNotes } from '../src/lib/fixedTipNotes.js';");
    expect(src).toContain("const text = (f === 'tip' || f === 'tip_en') ? stripFixedTipNotes(stop[f], stop) : stop[f];");
    const re = src.indexOf('reattachFixedTipNotes(result_plan, targetLang);');
    const rv = src.indexOf('applyRevisitNotes(result_plan, { language: targetLang });');
    expect(re).toBeGreaterThan(-1);
    expect(rv).toBeGreaterThan(re);
  });
});

describe('C r1-4a — no-meal notice: always visible on the intro slide, causes only when confirmed', () => {
  const noMeals = { days: [{ stops: [lodging('23:00')] }, { stops: [lodging('06:00'), { category: 'airport' }] }] };
  it('noMealStopsInfo', () => {
    expect(noMealStopsInfo(noMeals, { arrival_rest_day: true, departure_time: '10:00' })).toEqual({ show: true, lateArrival: true, earlyDeparture: true });
    expect(noMealStopsInfo(noMeals, {})).toEqual({ show: true, lateArrival: false, earlyDeparture: false });
    expect(noMealStopsInfo(noMeals, { arrival_rest_day: 'yes', departure_time: '11:00' })).toEqual({ show: true, lateArrival: false, earlyDeparture: false });
    expect(noMealStopsInfo(noMeals, { arrival_rest_day: true, departure_time: '10:00:00' })).toMatchObject({ earlyDeparture: true });
    expect(noMealStopsInfo({ days: [{ stops: [lodging('23:00')] }, { stops: [food('A', '08:00')] }] }, {})).toMatchObject({ show: false });
    expect(noMealStopsInfo({ days: [{ stops: [lodging('09:00')] }] }, {})).toMatchObject({ show: false });
    expect(noMealStopsInfo(null, null)).toMatchObject({ show: false });
  });
  it('IntroSlide renders it un-collapsed; the auto-correction panel no longer carries it; 4-locale copy', () => {
    const intro = read('src/pages/PlanDetailPage/components/IntroSlide.tsx');
    expect(intro).toContain('const noMeal = noMealStopsInfo(it as never, input as never);');
    expect(intro).toContain('data-testid="plan-intro-no-meal"');
    expect(USER_VISIBLE_KINDS).not.toHaveProperty('no_meal_stops');
    expect(read('src/pages/PlanDetailPage/index.tsx')).not.toContain('noMealStopsNotices');
    for (const l of ['ko', 'en', 'ja', 'zh']) {
      const nm = JSON.parse(read(`src/i18n/locales/${l}.json`)).planDetail?.noMealNotice;
      for (const k of ['plain', 'withReasons', 'lateArrival', 'earlyDeparture', 'joiner']) expect(typeof nm?.[k], `${l}.${k}`).toBe('string');
      expect(nm.withReasons, l).toContain('{{reasons}}');
      expect(JSON.parse(read(`src/i18n/locales/${l}.json`)).planDetail?.notices?.noMealStops, l).toBeUndefined();
    }
  });
});

describe('C r1-4b — wizard hint from the shared pure rules (certain cases only)', () => {
  it('isLikelyNoMealTrip: 2 days + arrival ≥ 18:00 + departure < 11:00 only', () => {
    expect(isLikelyNoMealTrip({ durationDays: 2, arrivalTime: '18:00', departureTime: '10:59' })).toBe(true);
    expect(isLikelyNoMealTrip({ durationDays: 2, arrivalTime: '17:59', departureTime: '10:00' })).toBe(false);
    expect(isLikelyNoMealTrip({ durationDays: 2, arrivalTime: '19:00', departureTime: '11:00' })).toBe(false);
    expect(isLikelyNoMealTrip({ durationDays: 3, arrivalTime: '19:00', departureTime: '08:00' })).toBe(false);
    expect(isLikelyNoMealTrip({ durationDays: 1, arrivalTime: '19:00', departureTime: '08:00' })).toBe(false);
    expect(isLikelyNoMealTrip({ durationDays: 2, arrivalTime: '', departureTime: '08:00' })).toBe(false);
  });
  it('same values as the server (constants re-export the leaf)', () => {
    expect([C.REST_DAY_LATE_ARRIVAL_MIN, C.EARLY_DEPARTURE_NO_BREAKFAST_MIN]).toEqual([REST_DAY_LATE_ARRIVAL_MIN, EARLY_DEPARTURE_NO_BREAKFAST_MIN]);
  });
  it('WizardStep3Review shows the hint only for that case, in all four locales', () => {
    const src = read('src/components/WizardForm/WizardStep3Review.tsx');
    expect(src).toContain("import { isLikelyNoMealTrip } from '@/lib/arrivalRestRules.js';");
    expect(src).toContain('const likelyNoMeal = isLikelyNoMealTrip({ durationDays: tripDays, arrivalTime, departureTime });');
    expect(src).toContain('{likelyNoMeal && (');
    for (const l of ['ko', 'en', 'ja', 'zh']) {
      expect(typeof JSON.parse(read(`src/i18n/locales/${l}.json`)).planner?.wizardNoMealHint, l).toBe('string');
    }
  });
});
