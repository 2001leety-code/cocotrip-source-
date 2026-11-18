/**
 * 2026-11-18: 출국 공항이 정해졌는데 출국 도시를 안 누른 다도시 플랜.
 *
 * 증상(scenario-matrix seoul-busan-zh-5d, 9/6 부터 매번): 서울+부산 5일 · ICN 입·출국 · 출국 10:00 →
 * 마지막 날 "부산 숙소 02:18 출발 → 인천공항 07:00". 원인 = block_mode 날짜 배치가 고른 순서
 * [서울,서울,서울,부산,부산] 로 끝나 마지막 밤이 부산. 고침 = 출국 공항의 도시로 끝내고(왕복이면
 * 출국 전날 밤도 그 도시), 시나리오 검사 B-19 가 이 모양을 잡는다.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — airportInference.js 는 JS
import { cityForAirport, bookendsWithDepartureAirport } from '../../api/_ai_core/airportInference.js';
// @ts-expect-error — blockMode.js 는 JS
import { buildCityPerDay } from '../../api/_ai_core/blockMode.js';
// @ts-expect-error — requestShaper.js 는 JS
import { shapeRequest } from '../../api/_ai_core/requestShaper.js';
import { departureDayFeasibility } from '../../scripts/lib/departure-day-feasibility.mjs';

const NONE = { arrivalCityKey: '', departureCityKey: '' };
const split = (cities: string[], days: number, bookends: object, airport: string) =>
  buildCityPerDay(cities, days, null, bookendsWithDepartureAirport(cities, bookends, airport));

describe('cityForAirport', () => {
  it('maps airport codes to the picked city they serve', () => {
    expect(cityForAirport('ICN_T1', ['seoul', 'busan'])).toBe('seoul');
    expect(cityForAirport('icn_t2', ['seoul', 'busan'])).toBe('seoul');
    expect(cityForAirport('GMP', ['seoul', 'busan'])).toBe('seoul');
    expect(cityForAirport('PUS', ['seoul', 'busan'])).toBe('busan');
    expect(cityForAirport('CJU', ['seoul', 'busan'])).toBe('');
    expect(cityForAirport('', ['seoul', 'busan'])).toBe('');
  });
  it('reads ja/zh display names the Wizard sends', () => {
    expect(cityForAirport('ICN_T1', ['ソウル', '釜山'])).toBe('seoul');
    expect(cityForAirport('PUS', ['首尔', '釜山'])).toBe('busan');
  });
});

describe('block_mode day split follows the departure airport', () => {
  it('Seoul+Busan 5d, ICN out, no exit city → last night in Seoul (was busan,busan at the end)', () => {
    expect(buildCityPerDay(['seoul', 'busan'], 5, null, NONE)).toEqual(['seoul', 'seoul', 'seoul', 'busan', 'busan']);
    expect(split(['seoul', 'busan'], 5, NONE, 'ICN_T1')).toEqual(['seoul', 'busan', 'busan', 'seoul', 'seoul']);
    expect(split(['seoul', 'busan'], 5, NONE, 'GMP')).toEqual(['seoul', 'busan', 'busan', 'seoul', 'seoul']);
  });
  it('4d round trip still visits every city; 3d is too short to come back → old split (P158)', () => {
    expect(split(['seoul', 'busan'], 4, NONE, 'ICN_T1')).toEqual(['seoul', 'busan', 'seoul', 'seoul']);
    expect(split(['seoul', 'busan'], 3, NONE, 'ICN_T1')).toEqual(['seoul', 'seoul', 'busan']);
  });
  it('long round trips keep full days in the home city (review M1)', () => {
    expect(split(['seoul', 'busan'], 7, NONE, 'ICN_T1')).toEqual(['seoul', 'seoul', 'busan', 'busan', 'busan', 'seoul', 'seoul']);
    expect(split(['seoul', 'busan'], 14, NONE, 'ICN_T1')).toEqual([
      'seoul', 'seoul', 'seoul', 'seoul', 'seoul', 'busan', 'busan', 'busan', 'busan', 'busan', 'busan', 'busan', 'seoul', 'seoul',
    ]);
  });
  it('last visited city already served by the airport → no change (Seoul↔Incheon share ICN, review N2)', () => {
    expect(bookendsWithDepartureAirport(['seoul', 'incheon'], NONE, 'ICN_T1')).toBe(NONE);
  });
  it('a marked entry city that was picked last is not the last visited city (review N3)', () => {
    expect(split(['busan', 'seoul'], 5, { arrivalCityKey: 'seoul', departureCityKey: '' }, 'ICN_T1'))
      .toEqual(['seoul', 'busan', 'busan', 'seoul', 'seoul']);
  });
  it('3 cities round trip keeps pick order in the middle', () => {
    expect(split(['seoul', 'busan', 'jeju'], 7, NONE, 'ICN_T1')).toEqual(['seoul', 'busan', 'busan', 'jeju', 'jeju', 'seoul', 'seoul']);
  });
  it('no change when the airport already matches the last city, or the traveller marked an exit city', () => {
    expect(bookendsWithDepartureAirport(['seoul', 'busan'], NONE, 'PUS')).toBe(NONE);
    const marked = { arrivalCityKey: '', departureCityKey: 'busan' };
    expect(bookendsWithDepartureAirport(['seoul', 'busan'], marked, 'ICN_T1')).toBe(marked);
    expect(bookendsWithDepartureAirport(['seoul'], NONE, 'ICN_T1')).toBe(NONE);
    expect(bookendsWithDepartureAirport(['seoul', 'busan'], NONE, 'CJU')).toBe(NONE);
  });
  it('a marked entry city stays; explicit different entry/exit split is unchanged', () => {
    expect(split(['seoul', 'busan'], 5, { arrivalCityKey: 'busan', departureCityKey: '' }, 'ICN_T1'))
      .toEqual(['busan', 'busan', 'busan', 'seoul', 'seoul']);
    expect(buildCityPerDay(['seoul', 'busan'], 5, null, { arrivalCityKey: 'busan', departureCityKey: 'seoul' }))
      .toEqual(['busan', 'busan', 'busan', 'seoul', 'seoul']);
  });
});

describe('prepay fingerprint input is untouched', () => {
  it('shapeRequest still reports the cities the traveller sent (no derived exit city)', () => {
    const s = shapeRequest({ regions: ['seoul', 'busan'], arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', durationDays: 5 }, null);
    expect(s.departureCity).toBe('');
    expect(s.arrivalCity).toBe('');
    expect(s.departure_airport).toBe('ICN_T1');
  });
});

describe('scenario B-19 departureDayFeasibility', () => {
  const day = (start_time: string, extra: object = {}) => ({ day: 5, city: 'busan', stops: [{ category: 'lodging', start_time }, { category: 'travel', start_time: '07:00' }], ...extra });
  it('fails the 02:18 Busan departure the zh scenario produced', () => {
    expect(departureDayFeasibility([day('02:18')]).pass).toBe(false);
  });
  it('passes 05:00 and later', () => {
    expect(departureDayFeasibility([day('05:00')]).pass).toBe(true);
    expect(departureDayFeasibility([day('05:30')]).pass).toBe(true);
  });
  it('fails a last-day city the departure airport does not serve, even at a plausible time (review N1)', () => {
    expect(departureDayFeasibility([day('06:30')], 'ICN_T1').pass).toBe(false);
    expect(departureDayFeasibility([day('06:18')], 'PUS').pass).toBe(true);
    expect(departureDayFeasibility([{ ...day('05:30'), city: 'Seoul' }], 'ICN_T1').pass).toBe(true);
  });
  it('fails a city change on the departure day and a missing lodging stop', () => {
    expect(departureDayFeasibility([day('05:30', { intercity_transit: { mode: 'KTX' } })]).pass).toBe(false);
    expect(departureDayFeasibility([{ day: 1, city: 'seoul', stops: [] }]).pass).toBe(false);
    expect(departureDayFeasibility([]).pass).toBe(false);
  });
});
