/**
 * 2026-10-26 (운영자 승인 "18:00 / 종료−60분") — 도착 휴식일 끼니 면제.
 *   도착 ≥ 18:00 또는 도착 준비 시각 ≥ 투어 종료 − 60분이면 Day1 = 숙소만(끼니 의무 없음, 저녁 1곳은 선택).
 *   판정 SSOT = constants.arrivalRestDayInfo — 검증기(B-MEAL/B-LATE-ARRIVAL/B-12)·게이트·mock·안내가 같은 함수.
 *   식당 검증 기준(신뢰·식이 판정, 정상일 점심+저녁 필수)은 그대로. 실호출 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arrivalRestDayInfo, arrivalReadyHHMM, resolveTourEndTime, REST_DAY_LATE_ARRIVAL_MIN, REST_DAY_TOUR_END_MARGIN_MIN, DEFAULT_TOUR_END_MIN } from '../../api/_ai_core/constants.js';
import { shapeRequest } from '../../api/_ai_core/requestShaper.js';
import { validatePatternStructure, arrivalRestDayCityKey } from '../../api/_ai_core/responseValidator.js';
import { buildMockPlan } from '../../api/_shared/llm/mock.js';
import { runFinalItineraryValidation, tripTimesFrom, FINAL_GATE_DIETARY_CODE } from '../../api/_ai_core/finalItineraryGate.js';
import { applyArrivalRestNote, applyDepartureBreakfastNote, selfHealLodgingBookend } from '../../api/_ai_core/planPersister.js';
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

describe('resolveTourEndTime (SSOT: camel 우선 + snake, 엄격 HH:MM, 기본 21:00)', () => {
  it.each([
    [{ tourEndTime: '22:00' }, '22:00'],
    [{ tour_end_time: '22:00' }, '22:00'],
    [{ tourEndTime: '20:00', tour_end_time: '22:00' }, '20:00'],
    [{ tourEndTime: '9:30' }, '09:30'],
    [{ tourEndTime: '25:00' }, '21:00'],
    [{ tour_end_time: '9pm' }, '21:00'],
    [{}, '21:00'],
    [null, '21:00'],
  ])('%j → %s', (src, want) => {
    expect(resolveTourEndTime(src)).toBe(want);
  });
  it('shapeRequest uses the same value (camel and snake input)', () => {
    expect(shapeRequest({ tourEndTime: '20:00', email: 'x@example.com' }, 'x@example.com', false, null).tourEndTime).toBe('20:00');
    expect(shapeRequest({ tour_end_time: '22:00', email: 'x@example.com' }, 'x@example.com', false, null).tourEndTime).toBe('22:00');
  });
  it('path agreement: ICN 14:00 → Busan with snake tour_end_time 22:00 → resolved 22:00 → not a rest day', () => {
    const tourEndTime = resolveTourEndTime({ tour_end_time: '22:00' });
    expect(tourEndTime).toBe('22:00');
    expect(arrivalRestDayInfo({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', cityKey: 'busan', tourEndTime }).rest).toBe(false);
  });
});

describe('validatePatternStructure — precomputed arrival_rest_day flag (generation stage / modify API)', () => {
  const day2: Day = { day: 2, city: 'seoul', stops: [lodging('09:00'), culture('Palace', '10:00'), food('점심', '12:30'), culture('Market', '14:30'), food('저녁', '18:30'), lodging('21:00')] };
  const day3: Day = { day: 3, city: 'seoul', stops: [lodging('09:00'), food('아침', '10:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '14:00' }] };
  const plan = (day1: Stop[]) => ({ days: [{ day: 1, city: 'seoul', stops: day1 }, day2, day3] });
  // 생성 단계 body / 수정 API 요청 모양 — 시각 필드 없이 플래그만.
  const genReq = (flag: boolean, extra: Stop = {}) => ({ regions: ['seoul'], arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', durationDays: 3, styles: [], arrival_rest_day: flag, ...extra });
  const modifyReq = { regions: ['seoul'], arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', durationDays: 3, arrival_rest_day: true };
  const day1Errors = (errs: string[]) => errs.filter((e) => e.startsWith('Day 1'));

  it('flag true: Day 1 [lodging] and [lodging, lodging] pass (no B-MEAL / B-12)', () => {
    expect(day1Errors(validatePatternStructure(plan([lodging('23:00')]), genReq(true)))).toEqual([]);
    expect(day1Errors(validatePatternStructure(plan([lodging('23:00'), lodging('23:30')]), genReq(true)))).toEqual([]);
  });
  it('flag false: [lodging, lodging] → B-MEAL', () => {
    expect(day1Errors(validatePatternStructure(plan([lodging('23:00'), lodging('23:30')]), genReq(false))).some((e) => /B-MEAL/.test(e))).toBe(true);
  });
  it('flag true but a sightseeing stop without a meal → B-MEAL', () => {
    expect(day1Errors(validatePatternStructure(plan([lodging('21:00'), culture('Night view', '21:10'), lodging('22:30')]), genReq(true))).some((e) => /B-MEAL/.test(e))).toBe(true);
  });
  it('flag false wins over arrival_time 19:00 → B-MEAL', () => {
    expect(day1Errors(validatePatternStructure(plan([lodging('23:00'), lodging('23:30')]), genReq(false, { arrival_time: '19:00' }))).some((e) => /B-MEAL/.test(e))).toBe(true);
  });
  it('r4: 1-day trip → no rest day even with the flag (a single stop still fails B-12)', () => {
    const one = { days: [{ day: 1, city: 'seoul', stops: [lodging('23:00')] }] };
    expect(validatePatternStructure(one, { regions: ['seoul'], arrival_airport: 'ICN_T1', durationDays: 1, arrival_rest_day: true }).some((e) => /B-12/.test(e))).toBe(true);
    expect(validatePatternStructure(one, { regions: ['seoul'], arrival_airport: 'ICN_T1', durationDays: 1, arrival_time: '19:00' }).some((e) => /B-12/.test(e))).toBe(true);
  });
  it('modify API: a rest-day plan re-validated after editing another day passes', () => {
    const edited = plan([lodging('23:00'), lodging('23:30')]);
    edited.days[1].stops[1] = culture('Edited museum', '10:00');
    const errs = validatePatternStructure(edited, modifyReq);
    expect(day1Errors(errs)).toEqual([]);
    expect(errs.filter((e) => /B-MEAL|B-12/.test(e))).toEqual([]);
  });
});

describe('B-LATE-ARRIVAL optional dinner (strict HH:MM, ≥ ready, 17:00 ≤ t < 22:00)', () => {
  const day2: Day = { day: 2, city: 'seoul', stops: [lodging('09:00'), culture('Palace', '10:00'), food('점심', '12:30'), culture('Market', '14:30'), food('저녁', '18:30'), lodging('21:00')] };
  const day3: Day = { day: 3, city: 'seoul', stops: [lodging('09:00'), food('아침', '10:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '14:00' }] };
  const plan = (t: string) => ({ days: [{ day: 1, city: 'seoul', stops: [lodging('21:00'), food('저녁', t), lodging('22:30')] }, day2, day3] });
  const req = (arrival_time: string) => ({ durationDays: 3, regions: ['seoul'], arrival_airport: 'ICN_T1', arrival_time });
  const stops3 = (errs: string[]) => errs.some((e) => /현재 stops=3 \(B-LATE-ARRIVAL P239\)/.test(e));

  it.each(['08:00', '17:30'])('ICN → Seoul 19:00 (ready 22:00): food at %s → B-LATE-ARRIVAL', (t) => {
    expect(stops3(validatePatternStructure(plan(t), req('19:00')))).toBe(true);
  });
  // 19:00 ICN→Seoul 은 준비 22:00 이라 21:xx 저녁이 불가 → 통과 케이스는 18:00(준비 21:00) 으로 검증.
  it('ICN → Seoul 18:00 (ready 21:00): food at 21:10 passes', () => {
    expect(validatePatternStructure(plan('21:10'), req('18:00')).filter((e) => e.startsWith('Day 1'))).toEqual([]);
  });
  it('ICN → Seoul 18:00: food at 22:10 (≥ 22:00) → B-LATE-ARRIVAL', () => {
    expect(stops3(validatePatternStructure(plan('22:10'), req('18:00')))).toBe(true);
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

describe('arrivalRestDayCityKey — request-input city key (r3)', () => {
  it('arrival_city first, then regions[0], then area; Korean names normalized', () => {
    expect(arrivalRestDayCityKey({ arrivalCity: 'Busan', regions: ['seoul'], area: 'jeju' })).toBe('busan');
    expect(arrivalRestDayCityKey({ regions: ['Seoul', 'busan'], area: 'jeju' })).toBe('seoul');
    expect(arrivalRestDayCityKey({ area: 'jeju' })).toBe('jeju');
    expect(arrivalRestDayCityKey({ arrivalCity: '부산' })).toBe('busan');
    expect(arrivalRestDayCityKey()).toBe('');
  });
  it('userMessageBuilder: arrival_ready_time and arrival_rest_day use the same key function', () => {
    const src = read('api/_ai_core/userMessageBuilder.js');
    expect(src).toMatch(/arrival_ready_time: arrivalReadyHHMM\(\s*arrivalTime,\s*arrival_airport,\s*arrivalRestDayCityKey\(\{ arrivalCity, regions, area \}\),/);
    // 2026-10-26 r5: handlerCore 가 넘긴 boolean 우선, 없을 때만 같은 함수·같은 도시 키로 재계산(1일 여행 제외).
    expect(src).toMatch(/arrival_rest_day: typeof arrivalRestDay === 'boolean' \? arrivalRestDay : \(arrivalRestDayInfo\(\{[\s\S]*?cityKey: arrivalRestDayCityKey\(\{ arrivalCity, regions, area \}\),[\s\S]*?\}\)\.rest && Number\(durationDays\) > 1\)/);
  });
  it('every rest-day computation uses the request key, not the model Day 1 city', () => {
    expect(read('api/_ai_core/handlerCore.js')).toMatch(/const arrivalRestDay = arrivalRestDayInfo\(\{[\s\S]*?cityKey: arrivalRestDayCityKey\(\{ arrivalCity, regions, area \}\)/);
    expect(read('api/_ai_core/postResponsePipeline.js')).toMatch(/cityKey: arrivalRestDayCityKey\(\{/);
    expect(read('api/ai-planner-modify.js')).toMatch(/cityKey: arrivalRestDayCityKey\(\{ arrivalCity: planData\.input\?\.arrival_city/);
    expect(read('api/_shared/llm/mock.js')).toMatch(/arrivalRestDayCityKey\(\{ arrivalCity: u\.arrival_city, regions: u\.regions, area: u\.area \}\)/);
    expect(read('api/_ai_core/responseValidator.js')).toMatch(/cityKey: arrivalRestDayCityKey\(\{ arrivalCity: request\.arrival_city \|\| request\.arrivalCity, regions, area: request\.area \}\)\s*\|\| normalizeRegionKey\(days\[0\]\?\.city\)/);
    expect(read('api/_ai_core/postResponsePipeline.js')).not.toMatch(/cityKey: normalizeRegionKey\(itinerary/);
  });
  it('flag reaches the gate (tripTimesFrom, boolean only) and every pass3 path', () => {
    expect(tripTimesFrom({ arrival_rest_day: true })).toMatchObject({ arrival_rest_day: true });
    expect(tripTimesFrom({ arrival_rest_day: 'yes' })).not.toHaveProperty('arrival_rest_day');
    expect(read('api/_ai_core/handlerCore.js')).toMatch(/tripTimesFrom\(\{[^}]*arrival_rest_day: arrivalRestDay \}\)/);
    expect(read('api/_ai_core/postResponsePipeline.js')).toMatch(/arrival_rest_day: arrivalRestDayFromCtx\(ctx\),/);
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/arrival_rest_day: arrivalRestDayFromCtx\(ctx\),/);
  });
  it('mock: userInput.arrival_rest_day (boolean) wins over its own computation', () => {
    const plan = buildMockPlan({ userText: 'X\n' + JSON.stringify({
      duration_days: 3, regions: ['seoul'], area: 'seoul', arrival_airport: 'ICN_T1', arrival_time: '10:00', arrival_rest_day: true, tour_start_time: '09:00',
    }) }) as { days: Day[] };
    expect(plan.days[0].stops.every((s) => s.category === 'lodging')).toBe(true);
  });
});

describe('r5 — local-language city names, one flag passed through, min-stop exception, block-mode empty Day 1', () => {
  it("ja '釜山' / zh '济州' regions → busan / jeju; ICN 14:00 is a rest day; Busan ready time 20:07", () => {
    expect(arrivalRestDayCityKey({ regions: ['釜山'] })).toBe('busan');
    expect(arrivalRestDayCityKey({ regions: ['济州'] })).toBe('jeju');
    for (const r of ['釜山', '济州']) {
      expect(arrivalRestDayInfo({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', cityKey: arrivalRestDayCityKey({ regions: [r] }) }).rest, r).toBe(true);
    }
    // userMessageBuilder 의 arrival_ready_time 은 같은 키 함수 → 부산 기준(공항→부산 이동 포함).
    expect(arrivalReadyHHMM('14:00', 'ICN_T1', arrivalRestDayCityKey({ regions: ['釜山'] }))).toBe('20:07');
  });
  it('the handler flag is passed (not recomputed) to the user message and the Inngest payload', () => {
    const core = read('api/_ai_core/handlerCore.js');
    expect(core).toMatch(/buildUserMessage\(\{[^}]*arrivalRestDay \}\)/);
    expect(core).toMatch(/issuanceClaim: issuance\.claim, avoidStopNames, plannerIntent, arrivalRestDay \}\)\)/);
    expect(core).toMatch(/plannerIntent,\s*arrivalRestDay, \/\/ 2026-10-26: worker/);
    const umb = read('api/_ai_core/userMessageBuilder.js');
    expect(umb).toMatch(/arrival_rest_day: typeof arrivalRestDay === 'boolean' \? arrivalRestDay : \(arrivalRestDayInfo\(\{[\s\S]*?\}\)\.rest && Number\(durationDays\) > 1\)/);
    const disp = read('api/_ai_core/inngestDispatch.js');
    expect(disp).toContain("...(typeof arrivalRestDay === 'boolean' ? { arrivalRestDay } : {}),");
    expect(disp).toMatch(/avoidStopNames, plannerIntent, arrivalRestDay,\s*\}, handlerStart\)/);
    expect(read('api/_ai_core/postResponsePipeline.js')).toContain("if (typeof ctx.arrivalRestDay === 'boolean') return ctx.arrivalRestDay;");
  });
  it('r6: both generation-stage selfHealLodgingBookend calls pass the rest-day flag', () => {
    expect((read('api/_ai_core/geminiPipeline.js').match(/selfHealLodgingBookend\(itinerary, \{ language, arrivalRestDay: body\?\.arrival_rest_day === true \}\)/g) || []).length).toBe(2);
  });
  it('prompt min-stop rules carry the rest-day Day 1 exception', () => {
    expect(read('api/_ai_core/buildPrompt.js')).toMatch(/예외: userInput\.arrival_rest_day = true 인 Day 1 은 숙소만\(1~2 stops\) 허용/);
    expect(read('api/_ai_core/geminiPipeline.js')).toContain('EVERY day MUST contain AT LEAST 4 stops total (except Day 1 when userInput.arrival_rest_day is true');
  });
  const twoDay = (day1: Stop[]) => ({ days: [{ day: 1, city: 'seoul', stops: day1 }, { day: 2, city: 'seoul', stops: [culture('Palace', '10:00'), food('점심', '12:30')] }] });
  it('selfHealLodgingBookend: empty Day 1 + rest day → one check-in lodging, then applyArrivalRestNote attaches', () => {
    const p = twoDay([]) as { days: Day[] };
    selfHealLodgingBookend(p, { language: 'en', blockMode: true, arrivalRestDay: true });
    expect(p.days[0].stops).toHaveLength(1);
    expect(p.days[0].stops[0]).toMatchObject({ category: 'lodging', _self_healed: true });
    expect(p.days[0].stops[0]).not.toHaveProperty('start_time');
    expect(String(p.days[0].stops[0].tip)).toMatch(/check-in/i);
    expect(applyArrivalRestNote(p, { restDay: true, language: 'en' })).toBe(true);
    expect(p.days[0].stops[0]).toMatchObject({ arrival_rest_note: ARRIVAL_REST_NOTE.en });
  });
  it('selfHealLodgingBookend: empty Day 1 not on a rest day stays empty; 1-day trip stays empty', () => {
    const notRest = twoDay([]) as { days: Day[] };
    selfHealLodgingBookend(notRest, { language: 'en', blockMode: true, arrivalRestDay: false });
    expect(notRest.days[0].stops).toHaveLength(0);
    const noFlag = twoDay([]) as { days: Day[] };
    selfHealLodgingBookend(noFlag, { language: 'en', blockMode: true });
    expect(noFlag.days[0].stops).toHaveLength(0);
    const one = { days: [{ day: 1, city: 'seoul', stops: [] as Stop[] }] };
    selfHealLodgingBookend(one, { language: 'en', blockMode: true, arrivalRestDay: true });
    expect(one.days[0].stops).toHaveLength(0);
  });
  it('postResponsePipeline order: selfHeal (with arrivalRestDay) → tour-end cap → rest note', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    const heal = post.indexOf('selfHealLodgingBookend(itinerary, {');
    const flag = post.indexOf('arrivalRestDay: arrivalRestDayFromCtx(ctx),', heal);
    const cap = post.indexOf('applyTourEndCap(itinerary, resolveTourEndTime(ctx.body || {}));');
    const note = post.indexOf('applyArrivalRestNote(itinerary, {');
    expect(heal).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(heal);
    expect(flag).toBeLessThan(cap);
    expect(note).toBeGreaterThan(cap);
  });
});

describe('prompt — rest day is a precomputed flag, not a formula (r3)', () => {
  it('buildPrompt / retry text mention arrival_rest_day and no longer state the tour_end_time − 60 formula', () => {
    for (const f of ['api/_ai_core/buildPrompt.js', 'api/_ai_core/geminiPipeline.js']) {
      const src = read(f);
      expect(src, f).toMatch(/arrival_rest_day/);
      expect(src, f).not.toMatch(/tour_end_time\s*[−-]\s*60/);
    }
  });
});

describe('final gate — request city key + late optional dinner (r3)', () => {
  const row = (name: string, n: number, o: Stop = {}) => ({
    name, nameEn: `${name} EN`, city: 'seoul', tag: 'halal', verification_status: 'muslim_friendly',
    address: `서울특별시 중구 합성로 ${n}`, lat: 37.56 + n / 1000, lng: 126.98, ...o,
  });
  const foodIndex = [row('합성할랄점심', 1), row('합성할랄저녁', 2), row('합성할랄야식', 3), row('합성일반식당', 4, { tag: 'general', verification_status: null })];
  const mid = (city: string): Day => ({ day: 2, city, stops: [lodging('09:00'), culture('Palace', '10:00'), food('합성할랄점심', '12:30'), culture('Market', '14:30'), food('합성할랄저녁', '18:30'), lodging('21:00')] });
  const last = (city: string): Day => ({ day: 3, city, stops: [lodging('06:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] });

  it('Seoul 14:00 (ready 17:00): model writes Day 1 city "Jeju" → judged by request key seoul → not a rest day, B-MEAL kept', () => {
    const plan = { days: [{ day: 1, city: 'Jeju', stops: [lodging('17:00'), lodging('17:30')] }, mid('seoul'), last('seoul')] };
    const tripTimes = tripTimesFrom({ arrivalTime: '14:00', arrivalAirport: 'ICN_T1', area: 'seoul', departureTime: '10:00' });
    const r = runFinalItineraryValidation(plan, { dietary: ['Halal'], language: 'en', foodIndex, tripTimes });
    expect(r.ok).toBe(false);
    expect(r.requiredMealIssues.some((m: string) => /도착일/.test(m))).toBe(true);
  });
  // ICN 19:00 → Seoul: 준비 22:00, 투어 종료 23:30 — 휴식일(도착 ≥ 18:00). 22:10 저녁은 끼니 창(17–21) 밖이지만 면제를 깨지 않는다.
  const lateTrip = tripTimesFrom({ arrivalTime: '19:00', arrivalAirport: 'ICN_T1', area: 'seoul', departureTime: '10:00', tourEndTime: '23:30' });
  const latePlan = (dinner: string) => ({ days: [{ day: 1, city: 'seoul', stops: [lodging('22:00'), food(dinner, '22:10'), lodging('23:20')] }, mid('seoul'), last('seoul')] });
  it('ready after 22:00, end 23:30: Day 1 [lodging, trusted restaurant 22:10, lodging] passes the gate', () => {
    expect(runFinalItineraryValidation(latePlan('합성할랄야식'), { dietary: ['Halal'], language: 'en', foodIndex, tripTimes: lateTrip })).toMatchObject({ ok: true, code: null });
  });
  it('same shape with an untrusted restaurant → critical dietary failure (standard unchanged)', () => {
    expect(runFinalItineraryValidation(latePlan('합성일반식당'), { dietary: ['Halal'], language: 'en', foodIndex, tripTimes: lateTrip })).toMatchObject({ ok: false, code: FINAL_GATE_DIETARY_CODE });
  });
  it('rest day with a sightseeing stop and no meal still needs a meal (B-MEAL)', () => {
    const plan = { days: [{ day: 1, city: 'seoul', stops: [lodging('22:00'), culture('Night view', '22:10'), lodging('23:20')] }, mid('seoul'), last('seoul')] };
    const r = runFinalItineraryValidation(plan, { dietary: ['Halal'], language: 'en', foodIndex, tripTimes: lateTrip });
    expect(r.requiredMealIssues.some((m: string) => /도착일/.test(m))).toBe(true);
  });
});

describe('block mode — Day 1 sightseeing 0 under the operator rest-day definition (r3)', () => {
  const blocks = [{ id: 'T1', city: 'seoul', zone: 'Test', theme: 'T', intensity: 'standard',
    stops: [0, 120, 240].map((off, i) => ({ order: i + 1, name: `Spot ${i + 1}`, category: 'culture', start_time_offset_min: off, stay_min: 60 })) }];
  // r4: 휴식일은 2일 이상 여행에만 — 2일 선택(Day2 는 같은 블록).
  const sel = { day_selections: [{ day: 1, block_id: 'T1', tweak_notes: '' }, { day: 2, block_id: 'T1', tweak_notes: '' }], language: 'en' };
  const sel1 = { day_selections: [{ day: 1, block_id: 'T1', tweak_notes: '' }], language: 'en' };
  const input = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15', tour_start_time: '09:00' };
  const sights = (itin: { days: Day[] }) => itin.days[0].stops.filter((s) => !['lodging', 'airport', 'travel'].includes(String(s.category)));

  it('18:00 GMP arrival, tour end 23:00 (ready well before cap) → late_arrival rest day → no sightseeing', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    expect(sights(expandBlocksToItinerary(sel, blocks, { ...input, arrival_time: '18:00', arrival_airport: 'GMP', tour_end_time: '23:00' }))).toHaveLength(0);
  });
  it('ICN 17:00 → Seoul ready 20:00 = tour end 21:00 − 60 → rest day → no sightseeing; ICN 14:00 (ready 17:00) keeps sightseeing', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    expect(sights(expandBlocksToItinerary(sel, blocks, { ...input, arrival_time: '17:00', arrival_airport: 'ICN', tour_end_time: '21:00' }))).toHaveLength(0);
    expect(sights(expandBlocksToItinerary(sel, blocks, { ...input, arrival_time: '14:00', arrival_airport: 'ICN', tour_end_time: '21:00' })).length).toBeGreaterThan(0);
  });
  it('r4: 1-day trip ICN 17:00 / end 21:00 → no rest day, sightseeing kept (old effMin >= capMin behaviour)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    expect(sights(expandBlocksToItinerary(sel1, blocks, { ...input, arrival_time: '17:00', arrival_airport: 'ICN', tour_end_time: '21:00' })).length).toBeGreaterThan(0);
  });
  it('r4: userInput.arrival_rest_day wins (single city)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    expect(sights(expandBlocksToItinerary(sel, blocks, { ...input, arrival_time: '14:00', arrival_airport: 'ICN', tour_end_time: '21:00', arrival_rest_day: true }))).toHaveLength(0);
    expect(sights(expandBlocksToItinerary(sel, blocks, { ...input, arrival_time: '17:00', arrival_airport: 'ICN', tour_end_time: '21:00', arrival_rest_day: false })).length).toBeGreaterThan(0);
  });
  it('r4: multi-city seoul+busan, no arrival_city, ICN 14:00 / end 21:00, Day 1 Busan block → follows the common flag', async () => {
    const { expandBlocksToItineraryMultiCity } = await import('../../api/_ai_core/blockMode.js');
    const mk = (city: string, id: string) => ({ id, city, zone: 'Test', theme: 'T', intensity: 'standard',
      stops: [0, 120].map((off, i) => ({ order: i + 1, name: `${city} Spot ${i + 1}`, category: 'culture', start_time_offset_min: off, stay_min: 60 })) });
    const run = (arrival_rest_day: boolean) => expandBlocksToItineraryMultiCity(
      { day_selections: [{ day: 1, city: 'busan', block_id: 'B1', tweak_notes: '' }, { day: 2, city: 'seoul', block_id: 'S1', tweak_notes: '' }], language: 'en' },
      [{ city: 'busan', blocks: [mk('busan', 'B1')] }, { city: 'seoul', blocks: [mk('seoul', 'S1')] }],
      { language: 'en', dietPrefs: [], foodIndex: [], startDate: '2026-06-15', regions: ['seoul', 'busan'],
        arrival_time: '14:00', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00', arrival_rest_day },
    ) as { days: Day[] };
    expect(sights(run(false)).length, 'flag false → Day1 관광 유지(부산 블록이어도)').toBeGreaterThan(0);
    expect(sights(run(true)), 'flag true → Day1 관광 0').toHaveLength(0);
  });
  it('source: single- and multi-city expand both use one common flag (not the block city), only for trips > 1 day', () => {
    const src = read('api/_ai_core/blockMode.js');
    expect((src.match(/effMin >= capMin \|\| \(totalDays > 1 && restFlag\)/g) || []).length).toBe(2);
    expect((src.match(/const restFlag = totalDays > 1 && \(typeof userInput\?\.arrival_rest_day === 'boolean'/g) || []).length).toBe(2);
    expect(src).not.toMatch(/cityKey: block\.city \|\| area, tourEndTime \}\)\.rest/);
    expect(src).not.toMatch(/cityKey: dayCityKey \|\| block\.city, tourEndTime \}\)\.rest/);
    expect(read('api/_ai_core/handlerCore.js')).toMatch(/arrival_rest_day: arrivalRestDay, \/\/ 2026-10-26: 블록모드/);
  });
});

describe('wiring (source)', () => {
  it('all execution paths pass airport / area / tour end to the gate', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    expect(post).toMatch(/arrivalAirport: ctx\.arrival_airport \|\| ctx\.body\?\.arrival_airport \|\| ctx\.body\?\.arrivalAirport,/);
    expect(post).toMatch(/area: ctx\.area \|\| ctx\.body\?\.area,\s*regions: ctx\.regions,\s*tourEndTime: ctx\.tourEndTime \|\| resolveTourEndTime\(ctx\.body \|\| \{\}\),/);
    expect(read('api/_ai_core/handlerCore.js')).toContain('tripTimes: tripTimesFrom({ departureTime, arrivalTime, arrivalAirport: arrival_airport, area, regions, tourEndTime, arrival_rest_day: arrivalRestDay })');
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/tripTimes: tripTimesFrom\(\{\s*departureTime: ctx\.body\?\.departureTime \|\| ctx\.body\?\.departure_time,\s*arrivalTime: ctx\.body\?\.arrivalTime \|\| ctx\.body\?\.arrival_time,\s*arrivalAirport: ctx\.arrival_airport \|\| ctx\.body\?\.arrival_airport \|\| ctx\.body\?\.arrivalAirport,\s*area: ctx\.area \|\| ctx\.body\?\.area,\s*regions: ctx\.regions,\s*tourEndTime: resolveTourEndTime\(ctx\.body \|\| \{\}\),[^\n]*\n\s*arrival_rest_day: arrivalRestDayFromCtx\(ctx\),/);
  });
  it('applyArrivalRestNote runs right after applyTourEndCap', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    const cap = post.indexOf('applyTourEndCap(itinerary, resolveTourEndTime(ctx.body || {}));');
    const note = post.indexOf('applyArrivalRestNote(itinerary, {');
    expect(cap).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(cap);
    expect(post.slice(cap, note)).not.toMatch(/calculateTmoney|applyRecommendedRestaurants/);
  });
  it('tour end time: postResponsePipeline (cap / rest note / tripTimes) and the worker resolve via resolveTourEndTime, no direct snake reads', () => {
    const post = read('api/_ai_core/postResponsePipeline.js');
    const worker = read('api/_inngest/functions/processPlanAfterAI.js');
    expect(post).toMatch(/applyTourEndCap\(itinerary, resolveTourEndTime\(ctx\.body \|\| \{\}\)\);/);
    expect(post).toMatch(/applyArrivalRestNote\(itinerary, \{[\s\S]*?tourEndTime: resolveTourEndTime\(ctx\.body \|\| \{\}\),/);
    expect(post).toMatch(/tourEndTime: ctx\.tourEndTime \|\| resolveTourEndTime\(ctx\.body \|\| \{\}\),/);
    expect(worker).toMatch(/tourEndTime: resolveTourEndTime\(ctx\.body \|\| \{\}\),/);
    for (const [f, src] of [['postResponsePipeline', post], ['processPlanAfterAI', worker]]) {
      expect(src, f).not.toMatch(/ctx\.body\?\.tour_end_time/);
      expect(src, f).not.toMatch(/ctx\.body\?\.tourEndTime/);
    }
  });
  it('r4: persist stores the computed flag + normalized tour end; modify prefers the stored boolean', () => {
    const persist = read('api/_ai_core/planPersister.js');
    expect(persist).toContain("...(typeof arrivalRestDay === 'boolean' ? { arrival_rest_day: arrivalRestDay } : {}),");
    expect(persist).toContain('tour_end_time: resolveTourEndTime(body),');
    expect(persist).toContain('arrival_time: body.arrivalTime || body.arrival_time || null,');
    expect(persist).toContain('arrival_city: body.arrival_city || arrivalCity || null,');
    expect(read('api/_ai_core/handlerCore.js')).toContain('arrivalRestDay, arrivalCity,');
    expect(read('api/_inngest/functions/processPlanAfterAI.js')).toMatch(/savePlan\(adminDb, \{[\s\S]*?arrivalRestDay,\s*arrivalCity:/);
    expect(read('api/ai-planner-modify.js')).toMatch(/const arrivalRestDay = typeof planData\.input\?\.arrival_rest_day === 'boolean'\s*\? planData\.input\.arrival_rest_day\s*: \(itinerary\.days\.length > 1 && arrivalRestDayInfo\(\{/);
    expect(read('api/ai-planner-modify.js')).toContain('arrival_rest_day: arrivalRestDay,');
    // snake tour_end_time 20:00 + ICN 16:00 → 서울 요청: 저장값(= resolveTourEndTime(body)) 은 '20:00'.
    expect(resolveTourEndTime({ tour_end_time: '20:00', arrivalTime: '16:00', arrival_airport: 'ICN_T1', regions: ['seoul'] })).toBe('20:00');
  });
  it('generation-stage body and the modify API validation request carry arrival_rest_day', () => {
    const core = read('api/_ai_core/handlerCore.js');
    expect(core).toMatch(/const arrivalRestDay = arrivalRestDayInfo\(\{[\s\S]*?cityKey: arrivalRestDayCityKey\(\{ arrivalCity, regions, area \}\)[\s\S]*?\}\)\.rest && Number\(durationDays\) > 1;/);
    expect(core).toContain('arrival_rest_day: arrivalRestDay,');
    // 2026-10-26 r4: 저장된 input.arrival_rest_day(boolean) 우선, 옛 플랜만 재계산(2일 이상).
    expect(read('api/ai-planner-modify.js')).toMatch(/const arrivalRestDay = typeof planData\.input\?\.arrival_rest_day === 'boolean'[\s\S]*?\? planData\.input\.arrival_rest_day[\s\S]*?: \(itinerary\.days\.length > 1 && arrivalRestDayInfo\(\{[\s\S]*?tourEndTime: resolveTourEndTime\(/);
  });
  it('the boundary values live only in src/lib/arrivalRestRules.js, re-exported by constants.js (no duplicated 18:00 / −60 rule elsewhere)', () => {
    for (const f of ['api/_ai_core/responseValidator.js', 'api/_shared/llm/mock.js', 'api/_ai_core/planPersister.js']) {
      expect(read(f), f).toMatch(/arrivalRestDayInfo\(/);
      expect(read(f), f).not.toMatch(/REST_DAY_TOUR_END_MARGIN_MIN|tourEndMin - 60/);
    }
    const rules = read('src/lib/arrivalRestRules.js');
    expect(rules).toContain('export const REST_DAY_LATE_ARRIVAL_MIN = 18 * 60;');
    expect(rules).toContain('export const REST_DAY_TOUR_END_MARGIN_MIN = 60;');
    const constants = read('api/_ai_core/constants.js');
    expect(constants).toContain("from '../../src/lib/arrivalRestRules.js';");
    expect(constants).not.toMatch(/export const REST_DAY_(LATE_ARRIVAL|TOUR_END_MARGIN)_MIN\s*=/);
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
  it('r3: rest day but Day 1 [lodging, sightseeing, lodging] → no note; restDay flag wins over the computed value', () => {
    expect(applyArrivalRestNote(plan([lodging('21:00'), culture('Night view', '21:10'), lodging('22:30')]), { restDay: true, language: 'en' })).toBe(false);
    expect(applyArrivalRestNote(plan([lodging('23:00'), lodging('23:30')]), { restDay: false, ...rest, language: 'en' })).toBe(false);
    expect(applyArrivalRestNote(plan([lodging('17:00'), lodging('17:30')]), { restDay: true, arrivalTime: '14:00', arrivalAirport: 'ICN_T1', cityKey: 'seoul', language: 'en' })).toBe(true);
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
