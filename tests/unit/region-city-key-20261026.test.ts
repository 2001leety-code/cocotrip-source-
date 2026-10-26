/**
 * 2026-10-26 지역 값 → 영문 도시 키 (Astra D2 — 운영자 승인, Astra r2·r3 로 범위 축소).
 *   ja/zh 위자드는 regions 를 '釜山'·'済州' 같은 표시명으로 보낸다. normalizeRegionKey 는 한글만 매핑해
 *   블록모드 0건(legacy 폴백)·다도시 호텔 조회 실패(첫 도시 호텔 폴백 = 출국 출발지 오류)가 났다.
 *   공용 responseValidator.regionCityKey 하나로 블록모드·RouteAgent 다도시·출국 안내 라벨을 맞춘다.
 *   (D1 RouteAgent 도착 시각·D5③ ALREADY 준비 시각·D5④ 늦은 첫날 식사·D5⑤ 22시 식사는 후속 설계 PR — 켜면 첫날 식사 회귀 재현.)
 *   실호출 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { regionCityKey, normalizeRegionKey, departureCityKey, validatePatternStructure } from '../../api/_ai_core/responseValidator.js';
import { blockCityKey } from '../../api/_ai_core/blockMode.js';
import { getDayHotelCoord } from '../../api/_ai_core/agents/RouteAgent.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('regionCityKey — ko/en/ja/zh, single and multi city', () => {
  const single: Array<[string, string]> = [['부산', 'busan'], ['Busan', 'busan'], ['釜山', 'busan'], ['プサン', 'busan'], ['제주', 'jeju'], ['Jeju', 'jeju'], ['済州', 'jeju'], ['济州', 'jeju'], ['seoul_myeongdong', 'seoul'], ['서울', 'seoul'], ['首尔', 'seoul'], ['ソウル', 'seoul']];
  it.each(single)('%s → %s', (raw, key) => {
    expect(regionCityKey(raw)).toBe(key);
  });
  it.each([
    ['ko', ['서울', '부산']],
    ['en', ['Seoul', 'Busan']],
    ['ja', ['ソウル', '釜山']],
    ['zh', ['首尔', '釜山']],
  ])('multi-city %s → [seoul, busan] in order', (_lng, regions) => {
    expect((regions as string[]).map(regionCityKey)).toEqual(['seoul', 'busan']);
  });
  it('never binds to a different city: unknown stays as is, comma lists keep the old normalization, empty → ""', () => {
    expect(regionCityKey('Tokyo')).toBe('tokyo');
    expect(regionCityKey('busan,seoul')).toBe(normalizeRegionKey('busan,seoul'));
    expect(regionCityKey('seoul,gapyeong')).not.toBe('seoul');
    expect(regionCityKey('')).toBe('');
    expect(regionCityKey(undefined)).toBe('');
  });
  it('ko/en results are unchanged from normalizeRegionKey (no regression for existing guests)', () => {
    for (const r of ['서울', '부산', '제주', '경주', 'seoul', 'Busan', 'JEJU', 'gyeongju']) {
      expect(regionCityKey(r), r).toBe(normalizeRegionKey(r));
    }
  });
  it('blockCityKey is the same function', () => {
    expect(blockCityKey).toBe(regionCityKey);
  });
});

describe('wiring — block mode, RouteAgent multi-city, departure hotel label use regionCityKey', () => {
  it('block mode regions / arrival / departure / per-day city', () => {
    const src = read('api/_ai_core/blockMode.js');
    expect(src).toContain('? regions.map((r) => blockCityKey(r)).filter(Boolean)');
    expect(src).toContain(': [blockCityKey(area)].filter(Boolean);');
    expect(src).toContain('arrivalCityKey: blockCityKey(userInput.arrival_city),');
    expect(src).toContain('departureCityKey: blockCityKey(userInput.departure_city),');
    expect(src).toContain('const explicit = blockCityKey(perDayCity[d] || perDayCity[String(d)]);');
  });
  it('RouteAgent departure origin + trip first region, pipeline departure hotel label', () => {
    const ra = read('api/_ai_core/agents/RouteAgent.js');
    expect(ra).toMatch(/depFirstRegion = depRegions\[0\] \? regionCityKey\(depRegions\[0\]\)/);
    expect(ra).toMatch(/depLastRegion = depRegions\.length >= 2\s*\? \(departureCityKey\(\{ departureCity: data\.departure_city, days: daysList, regions: depRegions \}\)/);
    expect(ra).toMatch(/tripFirstRegion = regionsList\[0\] \? regionCityKey\(regionsList\[0\]\)/);
    expect(read('api/_ai_core/postResponsePipeline.js')).toMatch(/departureCityKey\(\{ departureCity: body\?\.departure_city \|\| body\?\.departureCity, days: itinerary\?\.days, regions: _depRegions \}\)/);
    expect(read('api/_ai_core/routeEnrichment.js')).toContain("departure_city: body.departure_city || body.departureCity || '',");
  });
  it('ja multi-city: Busan day resolves to Busan center, not the first-city (Seoul) hotel', () => {
    const TRIP_HOTEL = { lat: 37.5665, lng: 126.978, label: '明洞ホテル', source: 'trip' };
    const r = getDayHotelCoord({ city: regionCityKey('釜山') }, { isMultiCity: true, recommendedZonesMap: null, tripFirstRegion: regionCityKey('ソウル'), tripHotel: TRIP_HOTEL });
    expect(r.lat).toBeLessThan(36);
    expect(r.source).toBe('multi_city_center');
    // 같은 첫 도시(서울)는 손님이 입력한 호텔 그대로
    const s = getDayHotelCoord({ city: regionCityKey('首尔') }, { isMultiCity: true, recommendedZonesMap: null, tripFirstRegion: regionCityKey('ソウル'), tripHotel: TRIP_HOTEL });
    expect(s.label).toBe('明洞ホテル');
  });
});

describe('departureCityKey — actual last day city, then explicit departure city, then last region', () => {
  const regions = ['ソウル', '釜山', '済州'];
  const days = ['seoul', 'seoul', 'jeju', 'jeju', 'busan'].map((city, i) => ({ day: i + 1, city }));
  it('Astra r4 repro: ja 3-city trip leaving from Busan → busan (not the last region Jeju)', () => {
    expect(departureCityKey({ departureCity: '釜山', days, regions })).toBe('busan');
    expect(departureCityKey({ departureCity: 'busan', days, regions })).toBe('busan');
    expect(departureCityKey({ departureCity: '', days, regions })).toBe('busan'); // 마지막 날 도시
  });
  it('Astra r5: explicit departure city differs from the last day → the last day city wins (guest is there that day)', () => {
    const d2 = [{ day: 1, city: 'seoul' }, { day: 2, city: 'busan' }];
    expect(departureCityKey({ departureCity: 'seoul', days: d2, regions: ['seoul', 'busan'] })).toBe('busan');
    expect(departureCityKey({ departureCity: 'seoul', days: [{ day: 1 }, { day: 2 }], regions: ['seoul', 'busan'] })).toBe('seoul');
  });
  it('falls back to the last region only when there is no explicit city and no day city', () => {
    expect(departureCityKey({ regions })).toBe('jeju');
    expect(departureCityKey({ days: [{ day: 1 }], regions: ['서울', '부산'] })).toBe('busan');
    expect(departureCityKey({})).toBe('');
  });
  it('localized day cities and explicit cities resolve the same way (ko/en/ja/zh)', () => {
    for (const c of ['부산', 'Busan', '釜山']) expect(departureCityKey({ departureCity: c }), c).toBe('busan');
    expect(departureCityKey({ days: [{ city: '济州' }] })).toBe('jeju');
  });
  it('ko 2-city trips keep the previous behaviour (last region = last day)', () => {
    expect(departureCityKey({ days: [{ city: 'seoul' }, { city: 'busan' }], regions: ['서울', '부산'] })).toBe(normalizeRegionKey('부산'));
  });
});

describe('validatePatternStructure — ja/zh regions vs English day.city (modify API re-validation)', () => {
  const day = (n: number, city: string, hotel: string) => ({ day: n, city, stops: [
    { category: 'lodging', name: hotel, address: '', start_time: '09:00' },
    { category: 'culture', name: 'x' + n, start_time: '10:00' },
    { category: 'food', name: 'f' + n, start_time: '12:00' },
    { category: 'lodging', name: hotel, address: '', start_time: '20:00' },
  ] });
  const errs = (regions: string[], hotels: [string, string], cities: [string, string] = ['seoul', 'busan']): string[] =>
    validatePatternStructure({ days: [day(1, cities[0], hotels[0]), day(2, cities[1], hotels[1])] }, { regions, durationDays: 2 });
  it('B-REGION-COVERAGE: stored ja/zh display names match block-mode English day cities', () => {
    for (const regions of [['ソウル', '釜山'], ['首尔', '釜山'], ['서울', '부산'], ['Seoul', 'Busan']]) {
      expect(errs(regions, ['H1', 'H2']).filter((e) => /B-REGION-COVERAGE/.test(e)), regions.join(',')).toEqual([]);
    }
  });
  it('B-13: a ja hotel name of the same city is not "another city"', () => {
    expect(errs(['ソウル', '釜山'], ['ロッテホテルソウル', 'パラダイスホテル釜山']).filter((e) => /B-13/.test(e))).toEqual([]);
    expect(errs(['서울', '부산'], ['롯데호텔 서울', '파라다이스호텔 부산']).filter((e) => /B-13/.test(e))).toEqual([]);
  });
  it('still catches a region with zero days', () => {
    expect(errs(['ソウル', '釜山'], ['H1', 'H2'], ['seoul', 'seoul']).some((e) => /B-REGION-COVERAGE/.test(e))).toBe(true);
  });
});
