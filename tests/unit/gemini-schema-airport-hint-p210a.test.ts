/**
 * P210-A (2026-05-26): arrival_guide / departure_guide 의 airport hint 회귀 테스트.
 *
 * 배경:
 *   - 5/26 시각 검증 sample 1/2: departure_guide.airport null
 *   - RC-1 (확정): Vercel 배포 지연 (P205 merge +4분 시점 측정)
 *   - RC-2 (부분 확정): Gemini Flash 2.0/2.5 — OBJECT type 만 명시 시 nested field 누락
 *     (GitHub google-gemini/cookbook #539, #449)
 *
 * P210-A fix:
 *   - arrival_guide / departure_guide 에 properties.airport: { type: 'STRING' } 명시
 *   - required 추가 X (P196 lesson: "satisfy required then stop" 패턴 → 3.6x fallback 회귀)
 *   - P205 backend self-heal (postResponsePipeline.js) 유지 필수
 *
 * assertions 6종:
 *   1. arrival_guide.properties.airport 존재
 *   2. arrival_guide.properties.airport.type === 'STRING'
 *   3. departure_guide.properties.airport 존재
 *   4. departure_guide.properties.airport.type === 'STRING'
 *   5. arrival_guide 에 required 없음 (P196 회귀 방지 R-P210A)
 *   6. departure_guide 에 required 없음 (P196 회귀 방지 R-P210A)
 */
import { describe, it, expect } from 'vitest';
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';

describe('P210-A PLAN_RESPONSE_SCHEMA — arrival/departure_guide airport hint', () => {
  it('assertion 1: arrival_guide.properties.airport 존재', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.arrival_guide.properties?.airport).toBeDefined();
  });

  it('assertion 2: arrival_guide.properties.airport.type === STRING', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.arrival_guide.properties?.airport?.type).toBe('STRING');
  });

  it('assertion 3: departure_guide.properties.airport 존재', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.departure_guide.properties?.airport).toBeDefined();
  });

  it('assertion 4: departure_guide.properties.airport.type === STRING', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.departure_guide.properties?.airport?.type).toBe('STRING');
  });

  it('assertion 5: arrival_guide 에 required 없음 (P196 회귀 방지 — nested required = fallback 3.6x)', () => {
    // P196 lesson: nested required 추가 → Flash "satisfy required then stop" → P181 fallback 3.6x
    expect(PLAN_RESPONSE_SCHEMA.properties.arrival_guide.required).toBeUndefined();
  });

  it('assertion 6: departure_guide 에 required 없음 (P196 회귀 방지 — nested required = fallback 3.6x)', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.departure_guide.required).toBeUndefined();
  });
});
