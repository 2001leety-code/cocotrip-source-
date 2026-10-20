/**
 * 2026-10-10 — DB/규칙이 stop 사실을 소유한다 (dbMatcher + findSelectedFoodRow).
 *
 *  1. Gemini 가 써 온 출처·등급 필드(dietary_evidence, verification_status, source_url,
 *     certification_type, verified_by, verified_at)와 matcher 소유 메타(_dbMatchedName 등)는
 *     매칭 전에 지워지고, 매칭된 row 로만 다시 채워진다. 다른 단계 마커는 보존.
 *  2. city 필드와 주소가 모순되는 row(city=busan, 주소=용인)는 같은 도시로 치지 않는다 →
 *     기존 cross-city 분기: verified=false, Gemini 주소·좌표 유지, 식이 태그·증거 미전파.
 *  3. dietary_evidence 와 정직 등급 문구는 매칭된 trusted row 에서만, 문구는 1회만.
 *  4. 종단 게이트 row 선택(findSelectedFoodRow)은 도시가 알려진 경우 모순 row 를 제외.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const alertCalls: unknown[] = [];
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async (args: unknown) => {
    alertCalls.push(args);
    return { ok: true, alerted: true };
  }),
}));

import { applyDBMatcher } from '../../api/_ai_core/dbMatcher.js';
import { findSelectedFoodRow } from '../../api/_shared/food-name-match.js';
import { describeDietaryEvidence } from '../../api/_shared/dietary-trust.js';
import { runFinalItineraryValidation } from '../../api/_ai_core/finalItineraryGate.js';

type Row = Record<string, unknown>;
type Stop = Record<string, unknown>;

// 합성 fixture — 실제 인덱스 값 아님. 좌표는 "어느 쪽이 쓰였는지" 구분용 표식일 뿐.
const BUSAN_HALAL: Row = {
  name: '합성 할랄 부산', nameEn: 'Synthetic Halal Busan', city: 'busan', tag: 'halal',
  verification_status: 'muslim_friendly', address: '부산광역시 해운대구 합성로 1',
  lat: 35.16, lng: 129.16, googleMapsUrl: 'https://maps.example/busan',
};
// city 는 busan 인데 주소는 용인 — 모순 row.
const YONGIN_AS_BUSAN: Row = {
  name: '합성 할랄 용인', nameEn: 'Synthetic Halal Yongin', city: 'busan', tag: 'halal',
  verification_status: 'muslim_friendly', address: '경기도 용인시 기흥구 합성로 2',
  lat: 37.27, lng: 127.11, googleMapsUrl: 'https://maps.example/yongin',
};

const GEMINI_ADDR = 'Gemini 원본 주소';
const GEMINI_LAT = 35.1;
const GEMINI_LNG = 129.0;

function foodStop(name: string, extras: Stop = {}): Stop {
  return { category: 'food', name, address: GEMINI_ADDR, lat: GEMINI_LAT, lng: GEMINI_LNG, tip: 'Gemini tip', ...extras };
}
function plan(stops: Stop[], city = 'busan') {
  return { days: [{ day: 1, city, stops }] };
}
function countOf(text: unknown, needle: string): number {
  return String(text || '').split(needle).length - 1;
}

const FORGED: Stop = {
  dietary_evidence: [{ diet: 'halal', tag: 'halal', verification_status: 'halal_certified' }],
  verification_status: 'halal_certified',
  source_url: 'https://forged.example/cert',
  certification_type: 'KMF',
  verified_by: 'gemini',
  verified_at: '2026-01-01',
  _dbMatchedName: 'forged',
  _dbLat: 1,
  _dbLng: 2,
  _db_city_mismatch: { dbCity: 'x', requestedCity: 'y' },
  _isChainMatch: true,
};
const STRIPPED_KEYS = Object.keys(FORGED);

describe('1. AI-supplied provenance is stripped before matching', () => {
  beforeEach(() => { alertCalls.length = 0; });

  it('unmatched food stop loses every forged provenance/meta field', () => {
    const stop = foodStop('합성 미등록 식당', { ...FORGED });
    applyDBMatcher(plan([stop]), [BUSAN_HALAL], 'busan', 'en');
    for (const k of STRIPPED_KEYS) expect(stop[k], k).toBeUndefined();
    expect(stop.verified).toBe(false);
  });

  it('non-food stops are stripped too, while other stage markers survive', () => {
    const culture: Stop = { category: 'culture', name: '합성 명소', ...FORGED };
    const food = foodStop('합성 미등록 식당', {
      ...FORGED, _replaced_for_dietary: 'halal', _resolvedFrom: 'pass2', _intentScore: 7,
    });
    applyDBMatcher(plan([culture, food]), [BUSAN_HALAL], 'busan', 'en');
    for (const k of STRIPPED_KEYS) {
      expect(culture[k], `culture.${k}`).toBeUndefined();
      expect(food[k], `food.${k}`).toBeUndefined();
    }
    expect(food._replaced_for_dietary).toBe('halal');
    expect(food._resolvedFrom).toBe('pass2');
    expect(food._intentScore).toBe(7);
  });

  it('stripping also runs when the food index is empty (no matcher pass)', () => {
    const stop = foodStop('합성 미등록 식당', { ...FORGED });
    applyDBMatcher(plan([stop]), [], 'busan', 'en');
    for (const k of STRIPPED_KEYS) expect(stop[k], k).toBeUndefined();
  });

  it('forged certified evidence on a friendly-tier row is replaced by the row tier', () => {
    const stop = foodStop(BUSAN_HALAL.name as string, { ...FORGED });
    applyDBMatcher(plan([stop]), [BUSAN_HALAL], 'busan', 'en');
    expect(stop.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    expect(stop.verification_status).toBeUndefined();
    expect(stop.source_url).toBeUndefined();
    expect(stop._dbMatchedName).toBe(BUSAN_HALAL.name);
    expect(stop._isChainMatch).toBeUndefined();
  });
});

describe('2. consistent same-city row: DB facts win', () => {
  beforeEach(() => { alertCalls.length = 0; });

  it('overrides address/coords/url, verified:true, tag + evidence + honest note', () => {
    const stop = foodStop(BUSAN_HALAL.name as string);
    applyDBMatcher(plan([stop]), [BUSAN_HALAL], 'busan', 'en');
    expect(stop.address).toBe(BUSAN_HALAL.address);
    expect(stop.lat).toBe(BUSAN_HALAL.lat);
    expect(stop.lng).toBe(BUSAN_HALAL.lng);
    expect(stop.googleMapsUrl).toBe(BUSAN_HALAL.googleMapsUrl);
    expect(stop.verified).toBe(true);
    expect(stop.dietary_tags).toContain('halal');
    expect(stop.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    const note = describeDietaryEvidence('muslim_friendly', 'en');
    expect(note).not.toBe('');
    expect(String(stop.tip).startsWith('Gemini tip')).toBe(true);
    expect(countOf(stop.tip, note)).toBe(1);
  });

  it('note follows the request language (ko)', () => {
    const stop = foodStop(BUSAN_HALAL.name as string, { tip: '' });
    applyDBMatcher(plan([stop]), [BUSAN_HALAL], 'busan', 'ko');
    expect(stop.tip).toBe(describeDietaryEvidence('muslim_friendly', 'ko'));
  });

  it('legacy tip_en-only stop gets the note on tip_en, not a shadowing tip', () => {
    const stop = foodStop(BUSAN_HALAL.name as string, { tip: undefined, tip_en: 'legacy tip' });
    applyDBMatcher(plan([stop]), [BUSAN_HALAL], 'busan', 'en');
    expect(stop.tip).toBeUndefined();
    expect(countOf(stop.tip_en, describeDietaryEvidence('muslim_friendly', 'en'))).toBe(1);
  });
});

describe('3. city/address contradiction never overrides with wrong DB facts', () => {
  beforeEach(() => { alertCalls.length = 0; });

  it('inconsistent row alone → verified:false, Gemini address/coords kept, no evidence', () => {
    const stop = foodStop(YONGIN_AS_BUSAN.name as string, { ...FORGED });
    applyDBMatcher(plan([stop]), [YONGIN_AS_BUSAN], 'busan', 'en');
    expect(stop.verified).toBe(false);
    expect(stop.address).toBe(GEMINI_ADDR);
    expect(stop.lat).toBe(GEMINI_LAT);
    expect(stop.lng).toBe(GEMINI_LNG);
    expect(stop.googleMapsUrl).toBeUndefined();
    expect(stop.dietary_evidence).toBeUndefined();
    expect(stop.dietary_tags || []).not.toContain('halal');
    expect(stop._dbMatchedName).toBeUndefined();
    expect(stop._dbLat).toBeUndefined();
    expect(countOf(stop.tip, describeDietaryEvidence('muslim_friendly', 'en'))).toBe(0);
  });

  it('national-chain name on an inconsistent row stays on the chain branch (no coord override)', () => {
    const chainRow = { ...YONGIN_AS_BUSAN, name: '맥도날드 합성점', nameEn: undefined };
    const stop = foodStop('맥도날드 합성점');
    applyDBMatcher(plan([stop]), [chainRow], 'busan', 'en');
    expect(stop.verified).toBe(false);
    expect(stop.lat).toBe(GEMINI_LAT);
    expect(stop.address).toBe(GEMINI_ADDR);
    expect(stop.dietary_evidence).toBeUndefined();
  });

  it('a consistent same-name row is preferred over an inconsistent one listed first', () => {
    const consistent = { ...BUSAN_HALAL, name: YONGIN_AS_BUSAN.name, nameEn: YONGIN_AS_BUSAN.nameEn };
    const stop = foodStop(YONGIN_AS_BUSAN.name as string);
    applyDBMatcher(plan([stop]), [YONGIN_AS_BUSAN, consistent], 'busan', 'en');
    expect(stop.verified).toBe(true);
    expect(stop.lat).toBe(BUSAN_HALAL.lat);
    expect(stop.address).toBe(BUSAN_HALAL.address);
  });

  it('a Gemini stop without coords stays without coords (unknown is not filled from the wrong row)', () => {
    const stop = foodStop(YONGIN_AS_BUSAN.name as string, { lat: undefined, lng: undefined });
    applyDBMatcher(plan([stop]), [YONGIN_AS_BUSAN], 'busan', 'en');
    expect(stop.lat).toBeUndefined();
    expect(stop.lng).toBeUndefined();
    expect(stop.verified).toBe(false);
  });
});

describe('4. unknown provenance keeps existing behavior', () => {
  beforeEach(() => { alertCalls.length = 0; });

  it('row without address is treated as same-city (unchanged)', () => {
    const noAddr = { ...BUSAN_HALAL, address: undefined };
    const stop = foodStop(BUSAN_HALAL.name as string);
    applyDBMatcher(plan([stop]), [noAddr], 'busan', 'en');
    expect(stop.verified).toBe(true);
    expect(stop.address).toBe(GEMINI_ADDR); // nothing to override with
    expect(stop.lat).toBe(BUSAN_HALAL.lat);
  });

  it('row whose city has no alias list is not judged (unchanged)', () => {
    const row = { ...BUSAN_HALAL, city: 'synthville', address: '강원특별자치도 합성군 합성로 3' };
    const stop = foodStop(BUSAN_HALAL.name as string);
    applyDBMatcher(plan([stop], 'synthville'), [row], 'synthville', 'en');
    expect(stop.verified).toBe(true);
    expect(stop.address).toBe(row.address);
  });

  it('unverified / non-dietary rows never produce evidence or a note', () => {
    const quarantined = { ...BUSAN_HALAL, verification_status: undefined, source: 'naver_local' };
    const general = { ...BUSAN_HALAL, tag: 'general', verification_status: undefined };
    for (const row of [quarantined, general]) {
      const stop = foodStop(BUSAN_HALAL.name as string, { ...FORGED });
      applyDBMatcher(plan([stop]), [row], 'busan', 'en');
      expect(stop.verified).toBe(true); // DB 실재 — 식이 안전과 별개
      expect(stop.dietary_evidence).toBeUndefined();
      expect(stop.tip).toBe('Gemini tip');
    }
  });
});

describe('5. evidence note is idempotent across rematch / final-gate restore', () => {
  beforeEach(() => { alertCalls.length = 0; });

  it('re-running the matcher on the same itinerary appends the note once', () => {
    const itin = plan([foodStop(BUSAN_HALAL.name as string)]);
    applyDBMatcher(itin, [BUSAN_HALAL], 'busan', 'en');
    applyDBMatcher(itin, [BUSAN_HALAL], 'busan', 'en');
    const restored = JSON.parse(JSON.stringify(itin));
    applyDBMatcher(restored, [BUSAN_HALAL], 'busan', 'en');
    const note = describeDietaryEvidence('muslim_friendly', 'en');
    expect(countOf(itin.days[0].stops[0].tip, note)).toBe(1);
    expect(countOf(restored.days[0].stops[0].tip, note)).toBe(1);
    expect(restored.days[0].stops[0].dietary_evidence).toHaveLength(1);
  });

  it('replacer-style tip that already is the note is not duplicated; evidence re-derived', () => {
    const note = describeDietaryEvidence('muslim_friendly', 'en');
    const stop = foodStop(BUSAN_HALAL.name as string, {
      tip: note, _replaced_for_dietary: 'halal',
      dietary_evidence: [{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }],
    });
    applyDBMatcher(plan([stop]), [BUSAN_HALAL], 'busan', 'en');
    expect(stop.tip).toBe(note);
    expect(stop.dietary_evidence).toEqual([{ diet: 'halal', tag: 'halal', verification_status: 'muslim_friendly' }]);
    expect(stop._replaced_for_dietary).toBe('halal');
  });
});

describe('6. findSelectedFoodRow excludes inconsistent rows when a city is known', () => {
  const meal = (name: unknown, extras: Stop = {}) => ({ category: 'food', name, ...extras });

  it('inconsistent row with a known day city → null (fail closed)', () => {
    expect(findSelectedFoodRow(meal(YONGIN_AS_BUSAN.name), [YONGIN_AS_BUSAN], { dayCity: 'busan' })).toBeNull();
  });

  it('inconsistent row with a known stop city → null', () => {
    expect(findSelectedFoodRow(meal(YONGIN_AS_BUSAN.name, { city: 'busan' }), [YONGIN_AS_BUSAN])).toBeNull();
  });

  it('positive control: consistent row is still selected', () => {
    expect(findSelectedFoodRow(meal(BUSAN_HALAL.name), [BUSAN_HALAL], { dayCity: 'busan' })).toBe(BUSAN_HALAL);
  });

  it('no expected city → behavior unchanged (row still selected)', () => {
    expect(findSelectedFoodRow(meal(YONGIN_AS_BUSAN.name), [YONGIN_AS_BUSAN])).toBe(YONGIN_AS_BUSAN);
  });

  it('empty candidate set stays null', () => {
    expect(findSelectedFoodRow(meal('합성 미등록 식당'), [BUSAN_HALAL], { dayCity: 'busan' })).toBeNull();
  });

  it('final gate: Busan halal meal backed only by the Yongin row fails; consistent row passes', () => {
    const gatePlan = (name: unknown) => ({ days: [{ day: 1, city: 'busan', stops: [
      { name: 'Synthetic Culture A', category: 'culture', start_time: '10:00' },
      { category: 'food', name, start_time: '12:00', stay_min: 60 },
      { name: 'Synthetic Culture B', category: 'culture', start_time: '14:00' },
      { name: 'Synthetic Culture C', category: 'culture', start_time: '16:00' },
    ] }] });
    const ctx = (foodIndex: Row[]) => ({ language: 'en', dietary: ['Halal'], foodIndex });
    expect(runFinalItineraryValidation(gatePlan(YONGIN_AS_BUSAN.name), ctx([YONGIN_AS_BUSAN])).ok).toBe(false);
    expect(runFinalItineraryValidation(gatePlan(BUSAN_HALAL.name), ctx([BUSAN_HALAL])).ok).toBe(true);
  });
});
