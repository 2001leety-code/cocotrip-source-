/**
 * P205 (2026-05-26): arrival_guide.airport / departure_guide.airport nested field self-heal.
 *
 * 5/26 measure 5/5 sample 모두 arrival.airport ICN_T1 OK 다만 departure.airport 누락.
 * Gemini 가 객체는 emit (P200 required 효과) 하지만 nested airport field 누락 → B-16 SAFETY 위반.
 *
 * fix:
 *   - postResponsePipeline.runRouteEnrichment — departure_guide.airport 누락 시 입력값으로 보충
 *   - planPersister.selfHealArrivalGuide — arrival_guide.airport 누락 분기 추가
 *
 * assertion 7종 (source-level + runtime):
 *   1. postResponsePipeline.js — departure_guide.airport 누락 시 self-heal 코드 존재
 *   2. planPersister.selfHealArrivalGuide — airport 누락 분기 존재
 *   3. selfHealArrivalGuide: arrival_guide 객체 있고 airport 누락 → 보충 (runtime)
 *   4. selfHealArrivalGuide: arrival_guide 없음 → 기존 skeleton 합성 (회귀 차단)
 *   5. selfHealArrivalGuide: arrival_guide.airport 정상 → 무변경 (no-op)
 *   6. arrival_airport='ALREADY' / 'already_in_korea' → no-op (회귀 차단)
 *   7. itinerary null/undefined → false (안전)
 */
import { describe, it, expect } from 'vitest';
import { selfHealArrivalGuide } from '../../api/_ai_core/planPersister.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('P205 postResponsePipeline.js — departure_guide.airport self-heal', () => {
  it('assertion 1: departure_guide.airport 누락 시 self-heal 코드 존재', () => {
    const src = readFileSync(resolve(__dirname, '../../api/_ai_core/postResponsePipeline.js'), 'utf8');
    // P205 주석 존재 + departure_guide.airport = departure_airport 할당 패턴 (별도)
    expect(/P205/.test(src)).toBe(true);
    expect(/departure_guide\.airport\s*=\s*departure_airport/.test(src)).toBe(true);
  });

  it('assertion 2: !itinerary.departure_guide.airport 조건 분기', () => {
    const src = readFileSync(resolve(__dirname, '../../api/_ai_core/postResponsePipeline.js'), 'utf8');
    expect(/!itinerary\.departure_guide\.airport/.test(src)).toBe(true);
  });
});

describe('P205 planPersister.selfHealArrivalGuide — arrival_guide.airport self-heal', () => {
  it('assertion 3: arrival_guide 객체 있고 airport 누락 → 보충 (runtime)', () => {
    const itinerary = {
      arrival_guide: { steps: [{ step: 1, title: 'test' }] }, // steps 있음, airport 없음
    };
    const result = selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(result).toBe(true);
    expect(itinerary.arrival_guide.airport).toBe('ICN T1');
    // steps 보존 (skeleton 재합성 X)
    expect(itinerary.arrival_guide.steps.length).toBe(1);
    expect(itinerary.arrival_guide.steps[0].title).toBe('test');
  });

  it('assertion 4: arrival_guide 없음 → 기존 skeleton 합성 (회귀 차단)', () => {
    const itinerary = {};
    const result = selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(result).toBeTruthy();
    expect(itinerary.arrival_guide?.airport).toBe('ICN T1');
    expect(Array.isArray(itinerary.arrival_guide?.steps)).toBe(true);
    expect(itinerary.arrival_guide.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('assertion 5: arrival_guide.airport 정상 + steps 정상 → 무변경 (no-op)', () => {
    const itinerary = {
      arrival_guide: {
        airport: 'GMP',
        steps: [{ step: 1, title: 'existing' }],
      },
    };
    const result = selfHealArrivalGuide(itinerary, 'ICN T1');
    expect(result).toBe(false);
    expect(itinerary.arrival_guide.airport).toBe('GMP'); // 기존 값 보존
  });

  it('assertion 6: arrival_airport=ALREADY → no-op (회귀 차단)', () => {
    const itinerary = { arrival_guide: { steps: [] } };
    expect(selfHealArrivalGuide(itinerary, 'ALREADY')).toBe(false);
    expect(selfHealArrivalGuide(itinerary, 'already_in_korea')).toBe(false);
  });

  it('assertion 7: itinerary null/undefined → false (안전)', () => {
    expect(selfHealArrivalGuide(null, 'ICN T1')).toBe(false);
    expect(selfHealArrivalGuide(undefined, 'ICN T1')).toBe(false);
  });

  it('assertion 8: arrival_guide.airport 있고 steps 없음 → skeleton 합성 (기존 동작 보존)', () => {
    const itinerary = {
      arrival_guide: { airport: 'GMP' }, // airport 있지만 steps 없음
    };
    const result = selfHealArrivalGuide(itinerary, 'ICN T1');
    // airport 보존 + steps 합성 (skeleton 합성에서 새 객체로 덮어쓰므로 airport=arrival_airport 가 됨)
    expect(result).toBeTruthy();
    expect(Array.isArray(itinerary.arrival_guide.steps)).toBe(true);
    expect(itinerary.arrival_guide.steps.length).toBeGreaterThanOrEqual(1);
  });
});
