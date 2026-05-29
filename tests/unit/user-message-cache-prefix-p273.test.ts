/**
 * P273 (2026-05-29): userMessage cache-friendly 순서 재배치 회귀 차단.
 *
 * 배경: P195 baseline prod 측정 (plan 696b273d, P266-P268 chain 후) =
 *   _debug.cacheMetrics.cacheHitRate = 0%. root cause = userMessage prefix 가
 *   JSON.stringify(userInput) 으로 시작 → 매 요청 unique → Gemini implicit cache
 *   prefix match 실패. Gemini 2.5 implicit caching (90% 할인, 2025-10 Logan
 *   Kilpatrick) 은 prefix exact byte match 필요.
 *
 * Fix: userMessage 순서 STATIC PREFIX → SEMI-STATIC MIDDLE → DYNAMIC SUFFIX →
 *   RANDOM TAIL 로 재배치. 동일 city+styles+diet+language 요청의 prefix 가 byte-level
 *   identical 가져 cache hit 활성.
 *
 * 회귀 시: userInput JSON 이 prefix 로 복귀 → cache hit 0% 회귀 → Gemini 비용 100%.
 *   prod 비용 ~$0.48/day → 0.05/day (현재) 의 ROI 손실.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUserMessage } from '../../api/_ai_core/userMessageBuilder.js';

describe('P273 userMessage cache-friendly 순서 (prefix determinism)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/userMessageBuilder.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — STATIC PREFIX 가 가장 먼저 (spotContext + foodContext 가 return 의 prefix)', () => {
    // return statement 마지막 = staticPrefix + semiStaticMiddle + userInputJson + variationTail
    expect(src).toMatch(/return\s+staticPrefix\s*\+\s*semiStaticMiddle\s*\+\s*userInputJson\s*\+\s*variationTail/);
    // staticPrefix = spotContext 로 시작
    expect(src).toMatch(/const\s+staticPrefix\s*=\s*[\s\S]{0,80}spotContext\s*\+\s*\n?\s*foodContext/);
  });

  it('source — JSON.stringify(userInput) 가 prefix 가 아님 (DYNAMIC SUFFIX)', () => {
    // userInputJson 변수에 JSON.stringify 가 할당
    expect(src).toMatch(/const\s+userInputJson\s*=\s*JSON\.stringify/);
    // userInputJson 가 return 의 prefix 아닌 middle/suffix
    expect(src).not.toMatch(/return\s+JSON\.stringify/);
    expect(src).not.toMatch(/return\s+userInputJson\s*\+/);
  });

  it('source — variationAngle (Math.random) 가 가장 끝 (RANDOM TAIL, cache 영향 X)', () => {
    expect(src).toMatch(/const\s+variationTail\s*=\s*buildVariationAngleBlock\(\)/);
    expect(src).toMatch(/userInputJson\s*\+\s*variationTail\s*;/);
  });

  it('source — P273 reference 명시 + Phase 1A 컨텍스트', () => {
    expect(src).toMatch(/P273/);
    expect(src).toMatch(/cache-friendly/);
    expect(src).toMatch(/STATIC PREFIX/);
  });

  // ── runtime 검증: 실제 buildUserMessage 호출 ──────────────────────────────
  function makeShaped(overrides: any = {}) {
    return {
      guestName: 'Sarah',
      pax: 2,
      startDate: '2026-06-15',
      durationDays: 3,
      styles: ['Food', 'Photo'],
      area: 'seoul_city',
      regions: ['서울'],
      duration: '3-day',
      vehicle: 'staria_8',
      arrival_airport: 'ICN_T1',
      departure_airport: 'ICN_T1',
      arrivalAddress: '',
      departureAddress: '',
      arrivalTime: '14:30',
      departureTime: '18:00',
      tourStartTime: '09:00',
      hotel_address: '',
      hotelByCity: {},
      arrivalCity: '',
      departureCity: '',
      recommendedZone: '명동',
      recommendedZones: { seoul: '명동' },
      mobility: 'walking',
      luggage: 'medium',
      specialRequest: '',
      dietPrefs: [],
      allergies: [],
      spiceLevel: 'medium',
      bucketDishes: [],
      priceRange: 'Any',
      pace: 'standard',
      wantAccom: false,
      accomBudget: '',
      language: 'en',
      ...overrides,
    };
  }

  const SHARED_CTX = {
    spotContext: '\n\n[SPOT_CTX]static-spot-data-seoul',
    foodContext: '\n\n[FOOD_CTX]static-food-data-seoul',
    attractionsContext: '\n\n[ATTR_CTX]static-attr-data',
    mountainContext: '',
    runningContext: '',
  };

  it('runtime — 동일 city+styles+diet+language 의 두 요청은 prefix 동일 (cache hit 가능)', () => {
    const shared = SHARED_CTX;
    const msg1 = buildUserMessage({ shaped: makeShaped({ guestName: 'Sarah', startDate: '2026-06-15' }), body: {}, ...shared });
    const msg2 = buildUserMessage({ shaped: makeShaped({ guestName: 'John', startDate: '2026-08-20' }), body: {}, ...shared });

    // prefix = static context 부분 (spotContext + foodContext + attractionsContext) 가 동일
    const commonPrefixLength = (() => {
      let i = 0;
      while (i < Math.min(msg1.length, msg2.length) && msg1[i] === msg2[i]) i++;
      return i;
    })();

    // SPOT + FOOD + ATTR context 합 = 약 90자 — prefix 가 그 이상이어야 함
    expect(commonPrefixLength).toBeGreaterThan(80);
    // prefix 가 SPOT_CTX 로 시작
    expect(msg1.slice(0, 30)).toContain('[SPOT_CTX]');
    expect(msg2.slice(0, 30)).toContain('[SPOT_CTX]');
  });

  it('runtime — userInput JSON 이 prefix 가 아님 (회귀 차단)', () => {
    const msg = buildUserMessage({ shaped: makeShaped(), body: {}, ...SHARED_CTX });
    // 첫 30자에 JSON 시작 ('{"guest_name') 없음
    expect(msg.slice(0, 30)).not.toContain('"guest_name"');
    expect(msg.slice(0, 30)).not.toContain('{"');
  });

  it('runtime — JSON.stringify(userInput) 는 message 내부 존재 (middle/suffix)', () => {
    const msg = buildUserMessage({ shaped: makeShaped({ guestName: 'TestUser' }), body: {}, ...SHARED_CTX });
    expect(msg).toContain('"guest_name":"TestUser"');
    expect(msg).toContain('"duration_days":3');
  });

  it('runtime — variation_angle (RANDOM TAIL) 가 가장 끝, cache prefix 영향 X', () => {
    // variation_angle 은 매번 random — 두 요청의 suffix 다를 수 있음
    const m1 = buildUserMessage({ shaped: makeShaped(), body: {}, ...SHARED_CTX });
    const m2 = buildUserMessage({ shaped: makeShaped(), body: {}, ...SHARED_CTX });
    // suffix 의 'VARIATION SEED' / 'ANGLE' 키워드 존재
    expect(m1).toMatch(/\[VARIATION SEED:|ANGLE:/);
    // tail 다를 수 있어도 prefix (SPOT_CTX) 는 동일
    expect(m1.slice(0, 50)).toBe(m2.slice(0, 50));
  });

  it('runtime — 빈 context 일 때도 동작 (안전)', () => {
    const msg = buildUserMessage({ shaped: makeShaped(), body: {}, spotContext: '', foodContext: '', attractionsContext: '' });
    // empty static prefix → semi-static + userInput JSON 부터 시작 가능
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    // userInput JSON 포함
    expect(msg).toContain('"guest_name":"Sarah"');
  });
});
