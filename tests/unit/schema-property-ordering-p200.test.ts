/**
 * P200 (2026-05-25): propertyOrdering + required 회귀 테스트 (P196 rollback 후 진짜 fix).
 *
 * 배경:
 *   - P196 (required 단독 추가) → P181 fallback 빈도 5→18건/5분 (3.6x ↑) 회귀
 *   - root cause (Agent A 외부 사례): Flash "satisfy required, then stop" 패턴 + schema/prompt
 *     property ordering mismatch (Google 공식 docs 경고)
 *   - P200 fix: propertyOrdering 명시 + buildPrompt JSON example 순서와 일치 + required 다시 적용
 *
 * assertion 12종:
 *   1. PLAN_RESPONSE_SCHEMA.propertyOrdering 존재 (P200 신규)
 *   2. propertyOrdering 가 array
 *   3. propertyOrdering 의 8 key 모두 존재
 *   4-11. propertyOrdering 순서 = buildPrompt JSON example 순서
 *   12. required 에 days + arrival_guide + departure_guide 모두 존재 (P196 의도 복원)
 */
import { describe, it, expect } from 'vitest';
import { PLAN_RESPONSE_SCHEMA } from '../../api/_ai_core/geminiPipeline.js';

describe('P200 PLAN_RESPONSE_SCHEMA — propertyOrdering + required', () => {
  it('assertion 1: propertyOrdering 필드 존재 (P200 신규)', () => {
    expect(PLAN_RESPONSE_SCHEMA.propertyOrdering).toBeDefined();
  });

  it('assertion 2: propertyOrdering 가 array', () => {
    expect(Array.isArray(PLAN_RESPONSE_SCHEMA.propertyOrdering)).toBe(true);
  });

  it('assertion 3: propertyOrdering 8 key 모두 존재', () => {
    const ordering = PLAN_RESPONSE_SCHEMA.propertyOrdering;
    expect(ordering).toContain('tour_title');
    expect(ordering).toContain('vehicle');
    expect(ordering).toContain('base_price_krw');
    expect(ordering).toContain('arrival_guide');
    expect(ordering).toContain('days');
    expect(ordering).toContain('departure_guide');
    expect(ordering).toContain('daily_budget_summary');
    expect(ordering).toContain('t_money_recommended_load');
  });

  it('assertion 4-11: propertyOrdering 순서 = buildPrompt JSON example 순서', () => {
    // buildPrompt.js 의 JSON example 순서 (L160-262):
    // tour_title → vehicle → base_price_krw → arrival_guide → days → departure_guide →
    // daily_budget_summary → t_money_recommended_load
    const expected = [
      'tour_title',
      'vehicle',
      'base_price_krw',
      'arrival_guide',
      'days',
      'departure_guide',
      'daily_budget_summary',
      't_money_recommended_load',
    ];
    expect(PLAN_RESPONSE_SCHEMA.propertyOrdering).toEqual(expected);
  });

  it('assertion 12: required = ["days", "arrival_guide", "departure_guide"] (P196 의도 복원)', () => {
    expect(PLAN_RESPONSE_SCHEMA.required).toContain('days');
    expect(PLAN_RESPONSE_SCHEMA.required).toContain('arrival_guide');
    expect(PLAN_RESPONSE_SCHEMA.required).toContain('departure_guide');
  });

  it('assertion 13: properties.arrival_guide / departure_guide OBJECT type 회귀 차단', () => {
    expect(PLAN_RESPONSE_SCHEMA.properties.arrival_guide.type).toBe('OBJECT');
    expect(PLAN_RESPONSE_SCHEMA.properties.departure_guide.type).toBe('OBJECT');
  });

  it('assertion 14: PLAN_RESPONSE_SCHEMA.type === OBJECT (회귀 차단)', () => {
    expect(PLAN_RESPONSE_SCHEMA.type).toBe('OBJECT');
  });
});
