/**
 * P271 (2026-05-28): block_mode expand 의 arrival_guide / departure_guide /
 * daily_budget_summary minimal default.
 *
 * 배경: 5/28 P266 결과물 검증 cycle → 5/5 plan 모두 `arrival_guide_self_healed` +
 * `daily_budget_self_healed` 발동. block_mode 가 itinerary 만들 때 3 field 누락 →
 * backend self_heal 가 generic 5-step placeholder 합성.
 *
 * P271 fix (2 파일):
 *   1. handlerCore.js: tryRunBlockMode 호출 userInput 에 arrival_airport, departure_airport,
 *      pax 추가 → expand 가 받음
 *   2. blockMode.js: expandBlocksToItinerary + expandBlocksToItineraryMultiCity 둘 다
 *      arrival_guide/departure_guide/daily_budget_summary minimal default 추가
 *      ('already_in_korea' 시 skip — buildPrompt:340 SKIP 패턴 동일)
 *
 * 회귀 시: block_mode plan 의 arrival/departure_guide 누락 → self_heal generic placeholder
 *         → 운영자 만족도 손상 (사용자 VIP 안내 차별성 부족).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('P271 block_mode arrival_guide / daily_budget minimal default', () => {
  const handlerCoreSrc = readFileSync(
    resolve(ROOT, 'api/_ai_core/handlerCore.js'),
    'utf8',
  );
  const blockModeSrc = readFileSync(
    resolve(ROOT, 'api/_ai_core/blockMode.js'),
    'utf8',
  );

  it('handlerCore.js: tryRunBlockMode userInput 에 arrival_airport/departure_airport/pax 추가', () => {
    // tryRunBlockMode 호출 라인 안에 3 field 모두 포함
    expect(handlerCoreSrc).toMatch(/tryRunBlockMode/);
    // arrival_airport 키 명시 (shorthand). #tour-end (2026-06-05): tour_end_time 가 tour_start_time 뒤 삽입.
    expect(handlerCoreSrc).toMatch(/tour_start_time:\s*tourStartTime,\s*tour_end_time:\s*tourEndTime,\s*arrival_airport,\s*departure_airport,\s*pax/);
  });

  it('blockMode.js: expandBlocksToItinerary — arrival_guide 추가 ("already_in_korea" 시 skip)', () => {
    // arrival_guide 분기 + 'already_in_korea' skip 패턴
    expect(blockModeSrc).toMatch(
      /arrivalAirport\.toLowerCase\(\)\s*!==\s*['"]already_in_korea['"]/,
    );
    expect(blockModeSrc).toMatch(/itinerary\.arrival_guide\s*=\s*\{\s*airport:\s*arrivalAirport\s*\}/);
  });

  it('blockMode.js: expandBlocksToItinerary — departure_guide 추가', () => {
    expect(blockModeSrc).toMatch(/itinerary\.departure_guide\s*=\s*\{\s*airport:\s*departureAirport\s*\}/);
  });

  it('blockMode.js: expandBlocksToItinerary — daily_budget_summary per-day skeleton', () => {
    // daily_budget_summary = days.map(...) 패턴 + 5 field 모두 존재
    expect(blockModeSrc).toMatch(/daily_budget_summary\s*=\s*days\.map/);
    expect(blockModeSrc).toMatch(/transport_krw:\s*0/);
    expect(blockModeSrc).toMatch(/food_krw:\s*0/);
    expect(blockModeSrc).toMatch(/activity_krw:\s*0/);
    expect(blockModeSrc).toMatch(/total_krw:\s*0/);
  });

  it('blockMode.js: expandBlocksToItineraryMultiCity 도 동일 패턴 적용 (mcArrivalAirport)', () => {
    expect(blockModeSrc).toMatch(/mcArrivalAirport/);
    expect(blockModeSrc).toMatch(/mcItinerary\.arrival_guide\s*=\s*\{\s*airport:\s*mcArrivalAirport\s*\}/);
    expect(blockModeSrc).toMatch(/mcItinerary\.departure_guide/);
    expect(blockModeSrc).toMatch(/mcItinerary\.daily_budget_summary/);
  });

  it('P271 주석 + 운영자 의도 명시', () => {
    expect(blockModeSrc).toMatch(/P271/);
    expect(blockModeSrc).toMatch(/minimal default|self_heal/);
  });
});
