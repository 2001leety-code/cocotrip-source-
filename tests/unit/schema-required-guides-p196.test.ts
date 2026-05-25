/**
 * P196 (2026-05-25): responseSchema required 강제 회귀 테스트.
 *
 * 배경:
 *   - 5/25 21:35 prod alert "arrival_guide+departure_guide never-emitted"
 *   - raw 15621 chars, cut at 15612 (= maxOutputTokens 24K 의 16% 사용)
 *   - root cause: required:['days'] 만 → Gemini Flash 3.5 가 days 완료 후 schema
 *     충족으로 stop → guides 누락. 사용자 PDF 첫/마지막 페이지 빈 페이지 (B-16 환불 사유)
 *
 * fix: required 에 arrival_guide + departure_guide 추가 강제 emit.
 *
 * assertion 5종:
 *   1. PLAN_RESPONSE_SCHEMA.required 에 'days' 유지
 *   2. PLAN_RESPONSE_SCHEMA.required 에 'arrival_guide' 추가 (P196)
 *   3. PLAN_RESPONSE_SCHEMA.required 에 'departure_guide' 추가 (P196)
 *   4. properties.arrival_guide.type === 'OBJECT' (회귀 차단)
 *   5. properties.departure_guide.type === 'OBJECT' (회귀 차단)
 */
import { describe, it, expect } from 'vitest';
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';

describe('P196 PLAN_RESPONSE_SCHEMA — required guides 강제 emit', () => {
  it('assertion 1: required 에 days 유지 (회귀 차단)', () => {
    expect(PLAN_RESPONSE_SCHEMA.required).toContain('days');
  });

  it('assertion 2: required 에 arrival_guide 추가 (P196 fix)', () => {
    expect(PLAN_RESPONSE_SCHEMA.required).toContain('arrival_guide');
  });

  it('assertion 3: required 에 departure_guide 추가 (P196 fix)', () => {
    expect(PLAN_RESPONSE_SCHEMA.required).toContain('departure_guide');
  });

  it('assertion 4: properties.arrival_guide.type === OBJECT 유지', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.arrival_guide).toBeDefined();
    expect(PLAN_RESPONSE_SCHEMA.properties.arrival_guide.type).toBe('OBJECT');
  });

  it('assertion 5: properties.departure_guide.type === OBJECT 유지', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.departure_guide).toBeDefined();
    expect(PLAN_RESPONSE_SCHEMA.properties.departure_guide.type).toBe('OBJECT');
  });

  it('assertion 6: required 최소 3개 키 (days + 2 guides)', () => {
    expect(PLAN_RESPONSE_SCHEMA.required.length).toBeGreaterThanOrEqual(3);
  });

  it('assertion 7: PLAN_RESPONSE_SCHEMA.type === OBJECT (회귀 차단)', () => {
    expect(PLAN_RESPONSE_SCHEMA.type).toBe('OBJECT');
  });
});
