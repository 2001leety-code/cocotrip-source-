/**
 * P129 (2026-05-21) — api/ai-planner-full.js 800L → 25L wrapper 분해 회귀 차단.
 *
 * Pre-fix: api/ai-planner-full.js 가 800L (P119/P120 추가로 754→800 도달).
 * pre-commit lock 한도와 정확히 같음 → 다음 P-pattern 추가 시 commit 자체 차단.
 *
 * Post-fix:
 *   1. api/ai-planner-full.js : Vercel handler entry — maxDuration + handlerCore
 *      default re-export + inferDepartureAirport named re-export 만 (~25L).
 *   2. api/_ai_core/handlerCore.js : try/catch + withStep + hangWarn 오케스트레이션 (~430L).
 *   3. api/_ai_core/requestShaper.js : body 정규화 (pure function).
 *   4. api/_ai_core/userMessageBuilder.js : Gemini userMessage 조립 (pure function).
 *   5. api/_ai_core/postResponsePipeline.js : RouteAgent + backfill + T-money + persist.
 *   6. api/_ai_core/airportInference.js : CITY_DEFAULT_AIRPORT + inferDepartureAirport.
 *
 * 본 테스트는 분해 회귀 차단:
 *   - wrapper file ≤100L (300L 가까이 가면 다시 분해 의무 알림).
 *   - 5종 모듈 export contract — 외부 코드/test 가 의존.
 *   - inferDepartureAirport pure function 동작 (다도시 plan 마지막 city → 공항 자동 추론).
 *   - 모듈 import chain 무결 (handlerCore 가 5종 모듈 모두 import 가능해야 함).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CITY_DEFAULT_AIRPORT,
  inferDepartureAirport,
} from '../../api/_ai_core/airportInference.js';
import { shapeRequest } from '../../api/_ai_core/requestShaper.js';

const wrapperSrc = readFileSync(
  resolve(process.cwd(), 'api/ai-planner-full.js'),
  'utf8',
);
const handlerCoreSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/handlerCore.js'),
  'utf8',
);
const requestShaperSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/requestShaper.js'),
  'utf8',
);
const userMessageBuilderSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/userMessageBuilder.js'),
  'utf8',
);
const postResponsePipelineSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/postResponsePipeline.js'),
  'utf8',
);
const airportInferenceSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/airportInference.js'),
  'utf8',
);

describe('P129 — ai-planner-full.js thin wrapper (decompose)', () => {
  it('wrapper is ≤100 lines', () => {
    const lines = wrapperSrc.split(/\r?\n/).length;
    expect(lines).toBeLessThanOrEqual(100);
  });

  it('wrapper re-exports default from handlerCore', () => {
    expect(wrapperSrc).toMatch(
      /export\s+\{\s*default\s*\}\s+from\s+['"]\.\/_ai_core\/handlerCore(\.js)?['"]/,
    );
  });

  it('wrapper re-exports inferDepartureAirport (backward-compat)', () => {
    expect(wrapperSrc).toMatch(
      /export\s+\{\s*inferDepartureAirport\b[^}]*\}\s+from\s+['"]\.\/_ai_core\/airportInference(\.js)?['"]/,
    );
  });

  it('wrapper keeps maxDuration = 800 export (Vercel entry, P165 안전망 + P270 vercel.json 동기화)', () => {
    // P165 (2026-05-23): 300 → 600 안전망. P270 (2026-05-29): 600 → 800 + vercel.json:71 동기화.
    // faab8777 plan (legacy 1-pass 다도시) 가 vercel.json maxDuration:300 (export 보다 우선) 직격 timeout 검증.
    expect(wrapperSrc).toMatch(/export\s+const\s+maxDuration\s*=\s*800/);
  });

  it('wrapper keeps runtime config export', () => {
    expect(wrapperSrc).toMatch(/export\s+const\s+config\s*=\s*\{\s*runtime\s*:\s*['"]nodejs['"]/);
  });
});

describe('P129 — handlerCore.js orchestrator', () => {
  it('exports default async handler function', () => {
    expect(handlerCoreSrc).toMatch(/export\s+default\s+async\s+function\s+handler\b/);
  });

  it('does NOT export maxDuration (only wrapper file does)', () => {
    // Vercel 은 handler entry file 만 read — handlerCore 가 export 하면 인식 안 됨.
    expect(handlerCoreSrc).not.toMatch(/export\s+const\s+maxDuration\s*=/);
  });

  it('size cap ≤500 lines (orchestrator 분리 트리거)', () => {
    // P170 (2026-05-23): P168/P169 의 Pass3 background + streaming early-response 를
    // backgroundPipelines.js 로 추출 → cap 600→500 복귀. handlerCore 는 orchestrator
    // 단일 책임 (try/catch + withStep + 합성). 추가 로직은 backgroundPipelines 로 추가.
    const lines = handlerCoreSrc.split(/\r?\n/).length;
    expect(lines).toBeLessThanOrEqual(500);
  });

  it('imports the 4 split helper modules', () => {
    expect(handlerCoreSrc).toMatch(/from\s+['"]\.\/requestShaper(\.js)?['"]/);
    expect(handlerCoreSrc).toMatch(/from\s+['"]\.\/userMessageBuilder(\.js)?['"]/);
    expect(handlerCoreSrc).toMatch(/from\s+['"]\.\/postResponsePipeline(\.js)?['"]/);
  });
});

describe('P129 — airportInference (pure function)', () => {
  it('exports CITY_DEFAULT_AIRPORT with seoul/busan/jeju/daegu', () => {
    expect(CITY_DEFAULT_AIRPORT.seoul).toBe('ICN');
    expect(CITY_DEFAULT_AIRPORT.busan).toBe('PUS');
    expect(CITY_DEFAULT_AIRPORT.jeju).toBe('CJU');
    expect(CITY_DEFAULT_AIRPORT.daegu).toBe('TAE');
  });

  it('returns arrival airport for single-city plans', () => {
    expect(inferDepartureAirport('ICN', ['seoul'], null)).toBe('ICN');
    expect(inferDepartureAirport('PUS', ['busan'], null)).toBe('PUS');
  });

  it('infers departure from last city for multi-city plans', () => {
    expect(inferDepartureAirport('PUS', ['busan', 'seoul'], null)).toBe('ICN');
    expect(inferDepartureAirport('ICN', ['seoul', 'busan'], null)).toBe('PUS');
    expect(inferDepartureAirport('ICN', ['seoul', 'jeju'], null)).toBe('CJU');
  });

  it('uses cities array when regions empty', () => {
    expect(inferDepartureAirport('PUS', null, ['busan', 'seoul'])).toBe('ICN');
  });

  it('falls back to arrival airport when both lists empty', () => {
    expect(inferDepartureAirport('ICN', [], [])).toBe('ICN');
    expect(inferDepartureAirport('PUS', null, null)).toBe('PUS');
  });

  it('matches Korean city names (서울/부산/제주)', () => {
    expect(inferDepartureAirport('PUS', ['부산', '서울'], null)).toBe('ICN');
    expect(inferDepartureAirport('ICN', ['서울', '제주'], null)).toBe('CJU');
  });

  it('handles substring matching (e.g. seoul_city → seoul)', () => {
    expect(inferDepartureAirport('PUS', ['busan_city', 'seoul_city'], null)).toBe('ICN');
  });
});

describe('P129 — requestShaper (pure function) — body normalization', () => {
  it('applies defaults for missing fields', () => {
    const r = shapeRequest({}, 'test@example.com');
    expect(r.guestName).toBe('Guest');
    expect(r.pax).toBe(2);
    expect(r.styles).toEqual(['culture']);
    expect(r.area).toBe('seoul_city');
    expect(r.duration).toBe('full_day');
    expect(r.durationDays).toBe(1);
    expect(r.language).toBe('en');
    expect(r.email).toBe('test@example.com');
    expect(r.regions).toEqual(['seoul_city']);
  });

  it('clamps pax to [1, 50]', () => {
    // pax=0 → Number(0) || Number(undefined) || 2 = falsy → default 2 (legacy behavior).
    expect(shapeRequest({ pax: 0 }, '').pax).toBe(2);
    expect(shapeRequest({ pax: 999 }, '').pax).toBe(50);
    expect(shapeRequest({ pax: 'invalid' }, '').pax).toBe(2);
    expect(shapeRequest({ pax: 5 }, '').pax).toBe(5);
    // explicit guest_count fallback path.
    expect(shapeRequest({ guest_count: 10 }, '').pax).toBe(10);
  });

  it('caps special_request to 1000 chars', () => {
    const long = 'x'.repeat(2000);
    const r = shapeRequest({ special_request: long }, '');
    expect(r.specialRequest.length).toBe(1000);
  });

  it('preserves regions array (max 5 entries, trimmed)', () => {
    const r = shapeRequest(
      { regions: ['seoul', '', '  ', 'busan', 'jeju', 'daegu', 'gwangju'] },
      '',
    );
    expect(r.regions).toEqual(['seoul', 'busan', 'jeju', 'daegu', 'gwangju']);
  });

  it('builds hotelByCity Record (lowercased keys, trimmed values)', () => {
    const r = shapeRequest(
      { hotelByCity: { Seoul: '명동 호텔', Busan: '해운대 호텔', Jeju: '' } },
      '',
    );
    expect(r.hotelByCity).toEqual({
      seoul: '명동 호텔',
      busan: '해운대 호텔',
    });
  });

  it('falls back recommended_zones from legacy recommended_zone + area', () => {
    const r = shapeRequest(
      { recommended_zone: 'myeongdong', area: 'seoul_city' },
      '',
    );
    expect(r.recommendedZones).toEqual({ seoul: 'myeongdong' });
  });

  it('routeHotelAddress uses hotel_address when present, zone fallback otherwise', () => {
    const r1 = shapeRequest(
      { hotel_address: 'Lotte Hotel Seoul', recommended_zone_address: 'Hongdae' },
      '',
    );
    expect(r1.routeHotelAddress).toBe('Lotte Hotel Seoul');

    const r2 = shapeRequest(
      { hotel_address: '', recommended_zone_address: 'Hongdae' },
      '',
    );
    expect(r2.routeHotelAddress).toBe('Hongdae');
  });

  it('caps revisionReason/Note/avoidList at known lengths', () => {
    const long = 'x'.repeat(2000);
    const r = shapeRequest(
      { revisionReason: long, revisionNote: long, avoidList: long },
      '',
    );
    expect(r.revisionReason.length).toBe(200);
    expect(r.revisionNote.length).toBe(300);
    expect(r.avoidListBody.length).toBe(1000);
  });

  it('caps bucketDishes to 10 entries (string only)', () => {
    const r = shapeRequest(
      { bucketDishes: ['김치찌개', '비빔밥', null, 123, 'tteokbokki', '갈비', '냉면', '족발', '삼겹살', '치킨', '회', '국밥', '잡채'] },
      '',
    );
    expect(r.bucketDishes.length).toBe(10);
  });

  it('derives pace from tourPace if pace missing', () => {
    expect(shapeRequest({ tourPace: 'half' }, '').pace).toBe('relaxed');
    expect(shapeRequest({ tourPace: 'short' }, '').pace).toBe('relaxed');
    expect(shapeRequest({ tourPace: 'action' }, '').pace).toBe('packed');
    expect(shapeRequest({}, '').pace).toBe('standard');
  });

  it('prefers explicit pace over tourPace', () => {
    expect(shapeRequest({ pace: 'packed', tourPace: 'half' }, '').pace).toBe('packed');
  });
});

describe('P129 — module file presence + sources', () => {
  it('all 5 helper modules exist and are non-empty', () => {
    expect(handlerCoreSrc.length).toBeGreaterThan(100);
    expect(requestShaperSrc.length).toBeGreaterThan(100);
    expect(userMessageBuilderSrc.length).toBeGreaterThan(100);
    expect(postResponsePipelineSrc.length).toBeGreaterThan(100);
    expect(airportInferenceSrc.length).toBeGreaterThan(100);
  });

  it('userMessageBuilder exports buildUserMessage', () => {
    expect(userMessageBuilderSrc).toMatch(/export\s+function\s+buildUserMessage/);
  });

  it('postResponsePipeline exports 5 helpers', () => {
    expect(postResponsePipelineSrc).toMatch(/export\s+async\s+function\s+runRouteEnrichment/);
    expect(postResponsePipelineSrc).toMatch(/export\s+function\s+applyBackfillsAndTmoney/);
    expect(postResponsePipelineSrc).toMatch(/export\s+async\s+function\s+applyRecommendedRestaurants/);
    expect(postResponsePipelineSrc).toMatch(/export\s+function\s+computePricing/);
    expect(postResponsePipelineSrc).toMatch(/export\s+async\s+function\s+savePlan/);
  });

  it('requestShaper exports shapeRequest', () => {
    expect(requestShaperSrc).toMatch(/export\s+function\s+shapeRequest/);
  });

  it('airportInference exports CITY_DEFAULT_AIRPORT + inferDepartureAirport', () => {
    expect(airportInferenceSrc).toMatch(/export\s+const\s+CITY_DEFAULT_AIRPORT/);
    expect(airportInferenceSrc).toMatch(/export\s+function\s+inferDepartureAirport/);
  });
});
