/**
 * P290 (2026-05-29): selfHealLodgingBookend personalize 회귀 차단.
 *
 * P288 (#697) + P289 (#698) 패턴 동일. P276+P277 (PR #695 → revert #696) lesson 적용:
 *   buildPrompt 변경 0 = Gemini cache miss risk 0. backend self_heal 시 user input 으로
 *   synthesized lodging stop 의 name/address personalize.
 *
 * P290 우선순위 (day.lodging 없을 때만 발동):
 *   1. day.lodging?.name (multi-city plan 의 city-별 호텔 보존 — 기존 동작)
 *   2. ctx.hotel_address (NEW — 사용자 입력 호텔 주소/명)
 *   3. ctx.recommendedZone → "{zone} 호텔 (위치 미정)" (NEW)
 *   4. CITY_LODGING_DEFAULT[city].placeholder (기존)
 *   5. generic "{city} 호텔 (위치 미정)" (기존)
 *
 * 회귀 시: 단일 도시 plan + 호텔 입력 → 합성 lodging 이 "해운대 호텔" / "명동 호텔"
 *   같은 city-default placeholder → 사용자 personalize 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selfHealLodgingBookend } from '../../api/_ai_core/planPersister.js';

describe('P290 selfHealLodgingBookend personalize (Gemini prompt 변경 X)', () => {
  const persisterPath = resolve(__dirname, '../../api/_ai_core/planPersister.js');
  const persisterSrc = readFileSync(persisterPath, 'utf8');

  // ── source pattern ────────────────────────────────────────────────────────

  it('source — P290 ctx 인자 추가 (hotel_address / recommendedZone)', () => {
    expect(persisterSrc).toMatch(/selfHealLodgingBookend\(itinerary,\s*ctx\s*=\s*\{\}\)/);
    expect(persisterSrc).toContain('P290');
    expect(persisterSrc).toContain('ctxHotelLabel');
    expect(persisterSrc).toContain('ctxZoneLabel');
  });

  it('source — fallback chain 에 ctxFallbackName / ctxFallbackAddress 포함', () => {
    // 두 곳 (prepend + append) 모두 day.lodging?.name → ctxFallbackName → defaultMeta 순
    expect(persisterSrc).toMatch(/day\?\.\s*lodging\?\.\s*name\s*\|\|\s*ctxFallbackName/);
    expect(persisterSrc).toMatch(/day\?\.\s*lodging\?\.\s*address\s*\|\|\s*ctxFallbackAddress/);
  });

  it('source — postResponsePipeline 가 ctx 전달', () => {
    const postSrcPath = resolve(__dirname, '../../api/_ai_core/postResponsePipeline.js');
    const postSrc = readFileSync(postSrcPath, 'utf8');
    expect(postSrc).toMatch(/selfHealLodgingBookend\(\s*itinerary,\s*\{/);
    expect(postSrc).toContain('P290');
  });

  it('source — handlerCore.js 가 applyBackfillsAndTmoney 에 ctx 확장 전달', () => {
    const coreSrcPath = resolve(__dirname, '../../api/_ai_core/handlerCore.js');
    const coreSrc = readFileSync(coreSrcPath, 'utf8');
    // applyBackfillsAndTmoney(itinerary, { hotelByCity, body, hotel_address, ... }) 패턴
    expect(coreSrc).toMatch(/applyBackfillsAndTmoney\(\s*itinerary,\s*\{[\s\S]{0,400}recommendedZone/);
    expect(coreSrc).toContain('P290');
  });

  it('source — processPlanAfterAI.js (Inngest worker) 도 동일 ctx 전달', () => {
    const inngestSrcPath = resolve(__dirname, '../../api/_inngest/functions/processPlanAfterAI.js');
    const inngestSrc = readFileSync(inngestSrcPath, 'utf8');
    expect(inngestSrc).toMatch(/applyBackfillsAndTmoney\(\s*itinAfterRoute,\s*\{[\s\S]{0,500}recommendedZone/);
    expect(inngestSrc).toContain('P290');
  });

  // ── runtime — Day 마지막 stop append (block_mode plan 의 주요 경로) ─────

  it('runtime — ctx.hotel_address → 합성 lodging name 으로 사용', () => {
    const itinerary = {
      days: [{
        day: 1,
        city: 'seoul',
        stops: [
          { category: 'food', name: '식당 A', start_time: '12:00', stay_min: 60 },
          { category: 'culture', name: '경복궁', start_time: '14:00', stay_min: 90 },
        ],
      }],
    };
    selfHealLodgingBookend(itinerary, {
      hotel_address: '명동 롯데호텔',
      recommendedZone: null,
    });
    const stops = itinerary.days[0].stops;
    const lastLodging = stops[stops.length - 1];
    expect(lastLodging.category).toBe('lodging');
    expect(lastLodging.name).toBe('명동 롯데호텔');
    expect(lastLodging.address).toBe('명동 롯데호텔');
    expect(lastLodging._self_healed).toBe(true);
  });

  it('runtime — ctx.recommendedZone fallback (hotel_address 없음)', () => {
    const itinerary = {
      days: [{
        day: 1,
        city: 'seoul',
        stops: [
          { category: 'food', name: '식당 A', start_time: '12:00', stay_min: 60 },
        ],
      }],
    };
    selfHealLodgingBookend(itinerary, {
      hotel_address: '',
      recommendedZone: 'myeongdong',
    });
    const stops = itinerary.days[0].stops;
    const lastLodging = stops[stops.length - 1];
    expect(lastLodging.category).toBe('lodging');
    expect(lastLodging.name).toContain('myeongdong');
    expect(lastLodging.name).toContain('호텔');
    expect(lastLodging.address).toContain('myeongdong');
  });

  it('runtime — day.lodging 우선 (multi-city 보존, ctx 무시)', () => {
    const itinerary = {
      days: [{
        day: 1,
        city: 'busan',
        lodging: { name: '해운대 시그니엘', address: '해운대구 우동' },
        stops: [
          { category: 'food', name: '회집', start_time: '12:00', stay_min: 60 },
        ],
      }],
    };
    selfHealLodgingBookend(itinerary, {
      hotel_address: '명동 롯데호텔',  // ctx 가 있어도
      recommendedZone: 'myeongdong',
    });
    const stops = itinerary.days[0].stops;
    const lastLodging = stops[stops.length - 1];
    expect(lastLodging.name).toBe('해운대 시그니엘');  // day.lodging 우선
    expect(lastLodging.address).toBe('해운대구 우동');
  });

  it('runtime — ctx 없으면 기존 동작 유지 (backward compat)', () => {
    const itinerary = {
      days: [{
        day: 1,
        city: 'seoul',
        stops: [
          { category: 'food', name: '식당 A', start_time: '12:00', stay_min: 60 },
        ],
      }],
    };
    selfHealLodgingBookend(itinerary);  // ctx 안 전달
    const stops = itinerary.days[0].stops;
    const lastLodging = stops[stops.length - 1];
    expect(lastLodging.category).toBe('lodging');
    // CITY_LODGING_DEFAULT['seoul'].placeholder 또는 generic
    expect(lastLodging.name).toMatch(/호텔|hotel/i);
    expect(lastLodging._self_healed).toBe(true);
  });

  it('runtime — 첫 stop prepend 시도 ctx.hotel_address 사용 (block_mode)', () => {
    const itinerary = {
      days: [{
        day: 1,
        city: 'seoul',
        stops: [
          { category: 'food', name: '식당 A', start_time: '10:00', stay_min: 60 },
          { category: 'lodging', name: '호텔 (Day 마지막)', start_time: '21:00', stay_min: 0 },
        ],
      }],
    };
    selfHealLodgingBookend(itinerary, {
      hotel_address: '강남 그랜드 인터컨티넨탈',
    });
    const firstLodging = itinerary.days[0].stops[0];
    expect(firstLodging.category).toBe('lodging');
    expect(firstLodging.name).toBe('강남 그랜드 인터컨티넨탈');
  });

  it('runtime — ctx 빈 값 (false-y) → defaultMeta fallback 정상 동작', () => {
    const itinerary = {
      days: [{
        day: 1,
        city: 'busan',
        stops: [
          { category: 'food', name: '회집', start_time: '12:00', stay_min: 60 },
        ],
      }],
    };
    selfHealLodgingBookend(itinerary, {
      hotel_address: '',
      recommendedZone: '',
    });
    const stops = itinerary.days[0].stops;
    const lastLodging = stops[stops.length - 1];
    expect(lastLodging.category).toBe('lodging');
    // CITY_LODGING_DEFAULT['busan'] 의 placeholder 또는 generic
    expect(lastLodging.name).toBeTruthy();
    expect(lastLodging.address).toBeTruthy();
  });

  it('runtime — quality_warnings 박제 (P160 회귀 차단)', () => {
    const itinerary = {
      days: [{
        day: 1,
        city: 'seoul',
        stops: [
          { category: 'food', name: '식당 A', start_time: '12:00', stay_min: 60 },
        ],
      }],
    };
    selfHealLodgingBookend(itinerary, { hotel_address: '명동 롯데호텔' });
    expect(itinerary.quality_warnings).toBeDefined();
    expect(itinerary.quality_warnings.length).toBeGreaterThan(0);
    const warning = itinerary.quality_warnings.find((w) => w.kind === 'lodging_bookend_self_healed');
    expect(warning).toBeDefined();
    expect(warning.type).toBe('lodging_bookend_self_healed');
  });
});
