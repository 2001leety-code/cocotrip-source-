/**
 * 2026-10-24 (운영자 결정) — 출국 11:00 전은 식당 조식 면제 + 체크아웃 stop tip 에 호텔/공항 조식 안내.
 *
 * 배경: 모든 stop ≤ 출국 −180분(buildPrompt P124)이라 10:00 출국이면 조식은 06~07시 식당뿐 → 검증된 할랄/비건 식당은
 *   그 시각에 영업하지 않아 생성 실패. B-MEAL(responseValidator) 은 11:00 전 출국 조식을 요구하지 않고, 안내는
 *   공용 후처리(postResponsePipeline.applyBackfillsAndTmoney → planPersister.applyDepartureBreakfastNote)가
 *   결정론적으로 넣는다(departure_guide 는 렌더러가 안 그리고, 블록·Inngest 경로는 프롬프트가 안 닿음).
 *   가짜 food stop 없음 · 식이 신뢰 완화 없음 · food stop 이 있으면 안내도 없음.
 */
import { describe, it, expect } from 'vitest';
import { applyDepartureBreakfastNote } from '../../api/_ai_core/planPersister.js';
import { applyBackfillsAndTmoney } from '../../api/_ai_core/postResponsePipeline.js';
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';
import { runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';

type Stop = { category: string; name: string; start_time: string; tip?: string; _breakfast_note?: boolean; [k: string]: unknown };
type Day = { day: number; city: string; stops: Stop[] };

const NOTE = {
  ko: '출국일 조식은 이른 비행 때문에 일정에 넣지 않았습니다. 호텔 또는 공항에서 준비해 주세요 — 운영시간과 식이 요건을 확인하세요.',
  en: 'Breakfast on departure day is not in the itinerary because of the early flight. Please arrange it at your hotel or the airport — check opening hours and dietary requirements.',
  ja: '出国日の朝食は早朝便のため日程に入れていません。ホテルまたは空港でご用意ください — 営業時間と食事制限への対応をご確認ください。',
  zh: '因航班较早，离境日早餐未列入行程。请在酒店或机场自行安排 — 请确认营业时间及饮食要求。',
};

const arrivalDay = (): Day => ({ day: 1, city: 'seoul', stops: [
  { category: 'lodging', name: 'Hotel', start_time: '15:00' },
  { category: 'food', name: '합성 저녁', start_time: '18:00' },
  { category: 'lodging', name: 'Hotel', start_time: '20:00' },
] });
const departureDay = (extra: Stop[] = []): Day => ({ day: 2, city: 'seoul', stops: [
  { category: 'lodging', name: 'Hotel', start_time: '06:00', tip: 'Check out early.' },
  ...extra,
  { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' },
] });
const plan = (last: Day = departureDay()) => ({ days: [arrivalDay(), last] });

describe('applyDepartureBreakfastNote', () => {
  it.each(Object.entries(NOTE))('%s: appends the note to the checkout tip (after one space)', (lang, note) => {
    const p = plan();
    expect(applyDepartureBreakfastNote(p, { departureTime: '10:00', language: lang })).toBe(true);
    const checkout = p.days[1].stops[0];
    expect(checkout.tip).toBe(`Check out early. ${note}`);
    expect(checkout._breakfast_note).toBe(true);
    expect(p.days[1].stops[1].tip).toBeUndefined();
  });

  it('unknown language → English; a checkout without a tip gets the note alone; no lodging → first stop', () => {
    const p = plan();
    delete p.days[1].stops[0].tip;
    expect(applyDepartureBreakfastNote(p, { departureTime: '09:00', language: 'fr' })).toBe(true);
    expect(p.days[1].stops[0].tip).toBe(NOTE.en);
    const q = plan({ day: 2, city: 'seoul', stops: [{ category: 'airport', name: 'ICN', start_time: '07:00' }] });
    expect(applyDepartureBreakfastNote(q, { departureTime: '10:59', language: 'ko' })).toBe(true);
    expect(q.days[1].stops[0].tip).toBe(NOTE.ko);
  });

  it('idempotent: a second call changes nothing', () => {
    const p = plan();
    applyDepartureBreakfastNote(p, { departureTime: '10:00', language: 'en' });
    const once = JSON.stringify(p);
    expect(applyDepartureBreakfastNote(p, { departureTime: '10:00', language: 'en' })).toBe(false);
    expect(JSON.stringify(p)).toBe(once);
  });

  it('no-op when the departure day has a food stop (an assigned restaurant must not read as "not included")', () => {
    const p = plan(departureDay([{ category: 'food', name: '합성 아침', start_time: '06:30' }]));
    const before = JSON.stringify(p);
    expect(applyDepartureBreakfastNote(p, { departureTime: '10:00', language: 'en' })).toBe(false);
    expect(JSON.stringify(p)).toBe(before);
  });

  it.each(['11:00', '13:00', '20:00'])('no-op for departure %s (11:00 or later keeps the meal rules)', (dep) => {
    const p = plan();
    const before = JSON.stringify(p);
    expect(applyDepartureBreakfastNote(p, { departureTime: dep, language: 'en' })).toBe(false);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('no-op for a single-day plan, a missing/invalid time, or no days', () => {
    const single = { days: [departureDay()] };
    expect(applyDepartureBreakfastNote(single, { departureTime: '10:00', language: 'en' })).toBe(false);
    for (const t of [undefined, '', 'soon', '25:00', '10:75']) {
      const p = plan();
      const before = JSON.stringify(p);
      expect(applyDepartureBreakfastNote(p, { departureTime: t, language: 'en' })).toBe(false);
      expect(JSON.stringify(p)).toBe(before);
    }
    expect(applyDepartureBreakfastNote({}, { departureTime: '10:00' })).toBe(false);
    expect(applyDepartureBreakfastNote(null, { departureTime: '10:00' })).toBe(false);
  });

  it('reads "HH:MM:SS" like the flight cap (slice(0,5))', () => {
    const p = plan();
    expect(applyDepartureBreakfastNote(p, { departureTime: '10:00:00', language: 'en' })).toBe(true);
  });
});

describe('10:00 departure: checkout + airport only is a valid plan, and the shared post-processing adds the note', () => {
  const trusted = [{ name: '합성 저녁', nameEn: 'Synthetic Dinner', city: 'seoul', tag: 'vegan', verification_status: 'vegan_restaurant', address: '서울특별시 종로구 1', lat: 37.57, lng: 126.98 }];

  it('validatePatternStructure and the final gate (with tripTimes) both pass with food 0 on the departure day', () => {
    const p = plan();
    expect(validatePatternStructure(p, { durationDays: 2, departure_time: '10:00' }).filter((e: string) => e.includes('Day 2'))).toEqual([]);
    expect(runFinalItineraryValidation(p, { dietary: ['Vegan'], language: 'en', foodIndex: trusted, tripTimes: { departure_time: '10:00' } }).ok).toBe(true);
  });

  it('applyBackfillsAndTmoney (block + legacy junction) appends the note from body.departureTime', () => {
    const p = plan();
    applyBackfillsAndTmoney(p, { body: { departureTime: '10:00', area: 'seoul' }, departure_airport: 'ICN_T1', language: 'ja' });
    const last = p.days[p.days.length - 1].stops;
    expect(last.filter((s) => s.category === 'food')).toEqual([]); // 가짜 food stop 없음
    const withNote = last.filter((s) => typeof s.tip === 'string' && s.tip.includes(NOTE.ja));
    expect(withNote).toHaveLength(1);
    expect(withNote[0].category).toBe('lodging');
  });
});
