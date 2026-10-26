/**
 * 2026-10-26 (운영자 승인 "18:00 / 종료−60분") — 도착 휴식일 끼니 면제.
 *   도착 ≥ 18:00 또는 도착 준비 시각 ≥ 투어 종료 − 60분이면 Day1 = 숙소만(끼니 의무 없음, 저녁 1곳은 선택).
 *   판정 SSOT = constants.arrivalRestDayInfo — 검증기(B-MEAL/B-LATE-ARRIVAL/B-12)·게이트·mock·안내가 같은 함수.
 *   식당 검증 기준(신뢰·식이 판정, 정상일 점심+저녁 필수)은 그대로. 실호출 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arrivalRestDayInfo, REST_DAY_LATE_ARRIVAL_MIN, REST_DAY_TOUR_END_MARGIN_MIN, DEFAULT_TOUR_END_MIN } from '../../api/_ai_core/constants.js';
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';
import { runFinalItineraryValidation, tripTimesFrom, FINAL_GATE_DIETARY_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { applyArrivalRestNote, applyDepartureBreakfastNote } from '../../api/_ai_core/planPersister.js';
import { projectPublicPlan } from '../../api/_shared/public-plan-projection.js';
import { ARRIVAL_REST_NOTE, arrivalRestNote } from '../../src/lib/arrivalRestNote.js';
import { DEPARTURE_BREAKFAST_NOTE } from '../../src/lib/departureBreakfastNote.js';

type Stop = Record<string, unknown>;
type Day = { day: number; city: string; stops: Stop[] };
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const lodging = (t: string, o: Stop = {}): Stop => ({ category: 'lodging', name: 'Hotel', start_time: t, ...o });
const food = (name: string, t: string): Stop => ({ category: 'food', name, start_time: t, stay_min: 60, verified: true });
const culture = (name: string, t: string): Stop => ({ category: 'culture', name, start_time: t });

describe('arrivalRestDayInfo (pure)', () => {
  it('policy constants', () => {
    expect([REST_DAY_LATE_ARRIVAL_MIN, REST_DAY_TOUR_END_MARGIN_MIN, DEFAULT_TOUR_END_MIN]).toEqual([1080, 60, 1260]);
  });
  it('17:59 (no airport) → not a rest day; 18:00 → late_arrival', () => {
    expect(arrivalRestDayInfo({ arrivalTime: '17:59' })).toMatchObject({ rest: false, reason: null, readyMin: null });
    expect(arrivalRestDayInfo({ arrivalTime: '18:00' })).toMatchObject({ rest: true, reason: 'late_arrival' });
  });
  it('ICN_T1 → Busan 14:00: ready 20:07 (1207) ≥ 21:00 − 60 → ready_near_tour_end; with tour end 22:00 → not rest (1207 < 1260)', () => {
    expect(arrivalRestDayInfo({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', cityKey: 'busan' }))
      .toEqual({ rest: true, reason: 'ready_near_tour_end', readyMin: 1207, tourEndMin: 1260 });
    expect(arrivalRestDayInfo({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', cityKey: 'busan', tourEndTime: '22:00' }))
      .toMatchObject({ rest: false, reason: null, readyMin: 1207, tourEndMin: 1320 });
  });
  it('boundary is >=: ready = end − 60 → rest, ready = end − 61 → not', () => {
    const base = { arrivalTime: '17:00', arrivalAirport: 'GMP', cityKey: 'seoul' };
    const ready = arrivalRestDayInfo(base).readyMin as number;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    expect(arrivalRestDayInfo({ ...base, tourEndTime: hhmm(ready + 60) })).toMatchObject({ rest: true, reason: 'ready_near_tour_end' });
    expect(arrivalRestDayInfo({ ...base, tourEndTime: hhmm(ready + 61) })).toMatchObject({ rest: false, reason: null });
  });
  it('ICN_T1 → Busan 19:00: ready is absolute minutes past midnight (≥ 1440, no modulo) and the day is a rest day', () => {
    const r = arrivalRestDayInfo({ arrivalTime: '19:00', arrivalAirport: 'ICN_T1', cityKey: 'busan' });
    expect(r.rest).toBe(true);
    expect(r.readyMin as number).toBeGreaterThanOrEqual(1440);
  });
  it.each(['', 'ALREADY', 'already_in_korea', 'Already'])('airport %j → (ii) is not inferred', (arrivalAirport) => {
    expect(arrivalRestDayInfo({ arrivalTime: '14:00', arrivalAirport, cityKey: 'busan' })).toMatchObject({ rest: false, readyMin: null });
  });
  it.each(['7pm', '25:00', '', '18:60', undefined])('invalid arrival time %j → not a rest day', (arrivalTime) => {
    expect(arrivalRestDayInfo({ arrivalTime: arrivalTime as string, arrivalAirport: 'ICN_T1', cityKey: 'busan' })).toMatchObject({ rest: false, reason: null, readyMin: null });
  });
  it('CJU → Jeju 18:00 → late_arrival', () => {
    expect(arrivalRestDayInfo({ arrivalTime: '18:00', arrivalAirport: 'CJU', cityKey: 'jeju' })).toMatchObject({ rest: true, reason: 'late_arrival' });
  });
});

describe('validatePatternStructure — arrival rest day', () => {
  const day2 = (city = 'seoul'): Day => ({ day: 2, city, stops: [lodging('09:00'), culture('Palace', '10:00'), food('점심', '12:30'), culture('Market', '14:30'), food('저녁', '18:30'), lodging('21:00')] });
  const day3 = (city = 'seoul'): Day => ({ day: 3, city, stops: [lodging('09:00'), food('아침', '10:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '14:00' }] });
  const plan = (day1: Stop[], city = 'seoul') => ({ days: [{ day: 1, city, stops: day1 }, day2(city), day3(city)] });
  const req = (arrival_time: string) => ({ durationDays: 3, regions: ['seoul'], arrival_airport: 'ICN_T1', arrival_time });
  const day1Errors = (errs: string[]) => errs.filter((e) => e.startsWith('Day 1'));

  it.each(['18:00', '19:00'])('ICN → Seoul %s: [lodging, lodging] passes (no Day 1 B-MEAL)', (t) => {
    expect(day1Errors(validatePatternStructure(plan([lodging('23:00'), lodging('23:30')]), req(t)))).toEqual([]);
  });
  it('ICN → Seoul 18:00 (ready 21:00): [lodging, dinner after ready, lodging] passes (optional dinner)', () => {
    expect(day1Errors(validatePatternStructure(plan([lodging('21:00'), food('늦은 저녁', '21:10'), lodging('22:30')]), req('18:00')))).toEqual([]);
  });
  it('ICN → Seoul 18:00: [lodging, sightseeing, lodging] still fails (activity without a meal / not just a dinner)', () => {
    const errs = day1Errors(validatePatternStructure(plan([lodging('21:00'), culture('Night view', '21:10'), lodging('22:30')]), req('18:00')));
    expect(errs.some((e) => /B-MEAL/.test(e))).toBe(true);
    expect(errs.some((e) => /B-LATE-ARRIVAL/.test(e))).toBe(true);
  });
  it('ICN → Seoul 14:00 (ready 17:00, not a rest day): [lodging, lodging] still fails B-MEAL', () => {
    expect(day1Errors(validatePatternStructure(plan([lodging('17:00'), lodging('17:30')]), req('14:00'))).some((e) => /B-MEAL/.test(e))).toBe(true);
  });
  it('rest day: a single lodging stop passes B-12 (and B-10)', () => {
    const errs = day1Errors(validatePatternStructure(plan([lodging('23:00')]), req('19:00')));
    expect(errs).toEqual([]);
    const notRest = day1Errors(validatePatternStructure(plan([lodging('17:00')]), req('14:00')));
    expect(notRest.some((e) => /B-12/.test(e))).toBe(true);
  });
  it('middle day, departure day (<11:00 breakfast exemption) and 1-day trips are unchanged', () => {
    const noDinner = { days: [{ day: 1, city: 'seoul', stops: [lodging('23:00'), lodging('23:30')] }, { day: 2, city: 'seoul', stops: [lodging('09:00'), culture('A', '10:00'), food('점심', '12:30'), culture('B', '14:30'), lodging('16:00')] }, day3()] };
    expect(validatePatternStructure(noDinner, req('19:00')).some((e) => /^Day 2: .*B-MEAL/.test(e))).toBe(true);
    const early = { days: [{ day: 1, city: 'seoul', stops: [lodging('23:00'), lodging('23:30')] }, { day: 2, city: 'seoul', stops: [lodging('06:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] }] };
    expect(validatePatternStructure(early, { durationDays: 2, regions: ['seoul'], arrival_airport: 'ICN_T1', arrival_time: '19:00', departure_time: '10:00' }).filter((e) => /B-MEAL/.test(e))).toEqual([]);
    const single = { days: [{ day: 1, city: 'seoul', stops: [lodging('09:00'), culture('A', '10:00'), culture('B', '13:00'), lodging('15:00')] }] };
    expect(validatePatternStructure(single, { durationDays: 1, regions: ['seoul'], arrival_airport: 'ICN_T1', arrival_time: '19:00' }).some((e) => /B-MEAL/.test(e))).toBe(true);
  });
});

describe('final gate — Daily Health busan-halal shape (ICN 14:00 → Busan ready 20:07)', () => {
  const row = (name: string, n: number, o: Stop = {}) => ({
    name, nameEn: `${name} EN`, city: 'busan', tag: 'halal', verification_status: 'muslim_friendly',
    address: `부산광역시 해운대구 합성로 ${n}`, lat: 35.16 + n / 1000, lng: 129.16, ...o,
  });
  const foodIndex = [row('합성할랄점심', 1), row('합성할랄저녁', 2), row('합성일반식당', 3, { tag: 'general', verification_status: null })];
  const plan = (dinner = '합성할랄저녁', city = 'busan') => ({ days: [
    { day: 1, city, stops: [lodging('20:07'), lodging('20:37')] }, // 저녁은 tour-end cap(21:00) 으로 빠진 뒤
    { day: 2, city, stops: [lodging('09:00'), culture('Haedong', '10:00'), food('합성할랄점심', '12:30'), culture('Beach', '14:30'), food(dinner, '18:30'), lodging('21:00')] },
    { day: 3, city, stops: [lodging('06:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] },
  ] });
  const tripTimes = tripTimesFrom({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', area: 'busan', departureTime: '10:00' });

  it('tripTimesFrom carries airport / area / tour end (snake keys)', () => {
    expect(tripTimes).toMatchObject({ arrival_time: '14:00', arrival_airport: 'ICN_T1', area: 'busan', departure_time: '10:00' });
    expect(tripTimesFrom({ regions: ['jeju'], tourEndTime: '20:30:00' })).toMatchObject({ area: 'jeju', tour_end_time: '20:30' });
  });
  it('rest Day 1 → no arrival-day B-MEAL, gate passes', () => {
    const r = runFinalItineraryValidation(plan(), { dietary: ['Halal'], language: 'en', foodIndex, tripTimes });
    expect(r.requiredMealIssues.some((m: string) => /도착일/.test(m))).toBe(false);
    expect(r).toMatchObject({ ok: true, code: null });
  });
  it('dietary standard unchanged: an untrusted restaurant on a middle day still fails critical', () => {
    const r = runFinalItineraryValidation(plan('합성일반식당'), { dietary: ['Halal'], language: 'en', foodIndex, tripTimes });
    expect(r).toMatchObject({ ok: false, code: FINAL_GATE_DIETARY_CODE });
  });
  it('a guest who is not on a rest day (ICN 14:00 → Seoul, ready 17:00) still fails with Day 1 empty', () => {
    const seoulIndex = foodIndex.map((x) => ({ ...x, city: 'seoul', address: String(x.address).replace('부산광역시 해운대구', '서울특별시 중구') }));
    const r = runFinalItineraryValidation(plan('합성할랄저녁', 'seoul'), { dietary: ['Halal'], language: 'en', foodIndex: seoulIndex, tripTimes: tripTimesFrom({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', area: 'seoul', departureTime: '10:00' }) });
    expect(r.ok).toBe(false);
    expect(r.requiredMealIssues.some((m: string) => /도착일/.test(m))).toBe(true);
  });
});

describe('wiring (source)', () => {
  it('all execution paths pass airport / area / tour end to the gate', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    expect(post).toMatch(/arrivalAirport: ctx\.arrival_airport \|\| ctx\.body\?\.arrival_airport \|\| ctx\.body\?\.arrivalAirport,/);
    expect(post).toMatch(/area: ctx\.area \|\| ctx\.body\?\.area,\s*regions: ctx\.regions,\s*tourEndTime: ctx\.tourEndTime \|\| ctx\.body\?\.tourEndTime \|\| ctx\.body\?\.tour_end_time,/);
    expect(read('api/_ai_core/handlerCore.js')).toMatch(/tripTimes: tripTimesFrom\(\{ departureTime, arrivalTime, arrivalAirport: arrival_airport, area, regions, tourEndTime \}\)/);
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/tripTimes: tripTimesFrom\(\{[\s\S]*?arrivalAirport: ctx\.arrival_airport \|\| ctx\.body\?\.arrival_airport \|\| ctx\.body\?\.arrivalAirport,[\s\S]*?area: ctx\.area \|\| ctx\.body\?\.area,[\s\S]*?tourEndTime: ctx\.body\?\.tourEndTime \|\| ctx\.body\?\.tour_end_time,/);
  });
  it('applyArrivalRestNote runs right after applyTourEndCap', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    const cap = post.indexOf('applyTourEndCap(itinerary, ctx.body?.tourEndTime);');
    const note = post.indexOf('applyArrivalRestNote(itinerary, {');
    expect(cap).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(cap);
    expect(post.slice(cap, note)).not.toMatch(/calculateTmoney|applyRecommendedRestaurants/);
  });
  it('the boundary values live only in constants.js (no duplicated 18:00 / −60 rule elsewhere)', () => {
    for (const f of ['api/_ai_core/responseValidator.js', 'api/_shared/llm/mock.js', 'api/_ai_core/planPersister.js']) {
      expect(read(f), f).toMatch(/arrivalRestDayInfo\(/);
      expect(read(f), f).not.toMatch(/REST_DAY_TOUR_END_MARGIN_MIN|tourEndMin - 60/);
    }
  });
});

describe('arrival rest note', () => {
  const plan = (day1: Stop[]) => ({ days: [{ day: 1, city: 'seoul', stops: day1 }, { day: 2, city: 'seoul', stops: [lodging('09:00'), food('점심', '12:00')] }] });
  const rest = { arrivalTime: '19:00', arrivalAirport: 'ICN_T1', cityKey: 'seoul' };

  it('four languages; unknown → en', () => {
    expect(Object.keys(ARRIVAL_REST_NOTE).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
    expect(arrivalRestNote('fr')).toBe(ARRIVAL_REST_NOTE.en);
  });
  it('appends once to the Day 1 lodging tip, stores arrival_rest_note; idempotent', () => {
    const p = plan([lodging('23:00', { tip: 'Check in.' }), lodging('23:30')]);
    expect(applyArrivalRestNote(p, { ...rest, language: 'ko' })).toBe(true);
    expect(p.days[0].stops[0]).toMatchObject({ tip: `Check in. ${ARRIVAL_REST_NOTE.ko}`, arrival_rest_note: ARRIVAL_REST_NOTE.ko, _arrival_rest_note: true });
    const once = JSON.stringify(p);
    expect(applyArrivalRestNote(p, { ...rest, language: 'ko' })).toBe(false);
    expect(JSON.stringify(p)).toBe(once);
  });
  it('no-op when Day 1 has a food stop, when it is not a rest day, or for a 1-day plan', () => {
    const withFood = plan([lodging('21:00'), food('늦은 저녁', '21:10'), lodging('22:30')]);
    expect(applyArrivalRestNote(withFood, { ...rest, language: 'en' })).toBe(false);
    const notRest = plan([lodging('17:00'), lodging('17:30')]);
    expect(applyArrivalRestNote(notRest, { arrivalTime: '14:00', arrivalAirport: 'ICN_T1', cityKey: 'seoul', language: 'en' })).toBe(false);
    expect(applyArrivalRestNote({ days: [{ day: 1, city: 'seoul', stops: [lodging('23:00')] }] }, { ...rest, language: 'en' })).toBe(false);
  });
  it('public projection: viewer language only, hotel tip and name stay private; with a breakfast note both appear (arrival first)', () => {
    const hotel = 'Secret Lantern Hotel';
    const p = plan([lodging('23:00', { name: hotel, tip: '호텔 고유 메모' }), lodging('23:30', { name: hotel })]);
    applyArrivalRestNote(p, { ...rest, language: 'ko' });
    const out = projectPublicPlan({ id: 'x', isPublic: true, input: { language: 'ko', hotelByCity: { Seoul: { name: hotel } } }, itinerary: p }, { language: 'en' });
    const s = (out as { itinerary: { days: Array<{ stops: Stop[] }> } }).itinerary.days[0].stops[0];
    expect(s).toMatchObject({ tip: ARRIVAL_REST_NOTE.en, arrival_rest_note: ARRIVAL_REST_NOTE.en });
    const wire = JSON.stringify(out);
    expect(wire).not.toContain('호텔 고유 메모');
    expect(wire).not.toContain(hotel);
    expect(wire).not.toContain(ARRIVAL_REST_NOTE.ko);
    expect(projectPublicPlan(out, { language: 'en' })).toEqual(out);

    const both = { days: [{ day: 1, city: 'seoul', stops: [lodging('23:00')] }, { day: 2, city: 'seoul', stops: [lodging('06:00'), { category: 'airport', name: 'ICN', start_time: '07:00' }] }] };
    applyArrivalRestNote(both, { ...rest, language: 'en' });
    applyDepartureBreakfastNote(both, { departureTime: '10:00', language: 'en' });
    // 같은 stop 에 두 안내가 다 있는 경우(투영 순서 확인용)
    Object.assign(both.days[0].stops[0], { breakfast_note: DEPARTURE_BREAKFAST_NOTE.en, _breakfast_note: true });
    const proj = projectPublicPlan({ id: 'y', isPublic: true, input: {}, itinerary: both }, { language: 'ja' });
    expect((proj as { itinerary: { days: Array<{ stops: Stop[] }> } }).itinerary.days[0].stops[0].tip).toBe(`${ARRIVAL_REST_NOTE.ja} ${DEPARTURE_BREAKFAST_NOTE.ja}`);
  });
});
