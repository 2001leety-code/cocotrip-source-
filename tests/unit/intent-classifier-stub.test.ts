/**
 * intent-classifier-stub.test.ts — PR-A intent classifier 회귀 ([P-Z02]).
 *
 * 2026-05-21. zone_courses 시스템의 사용자 수정 요청 분류.
 * Stub 구현 (rule-based 키워드 매칭). PR-B 에서 LLM fallback 추가 예정.
 *
 * 검증 케이스 (10):
 *  1. DMZ block swap
 *  2. 트레킹 + day 명시 → block_swap (높은 confidence)
 *  3. 식당 바꿔달라 → stop_swap
 *  4. N서울타워 추가 → stop_add
 *  5. 빼주세요 → stop_remove
 *  6. 빈 string → no_change
 *  7. null/undefined → no_change (no throw)
 *  8. day index + stop order 추출
 *  9. 너무 긴 input (>1000 chars) → no_change
 *  10. add trigger 만 있고 known stop 없음 → 낮은 confidence stop_add
 */
import { describe, it, expect } from 'vitest';
import { classifyModification } from '../../src/ai_planner/intent-classifier';

describe('classifyModification — block_swap', () => {
  it('DMZ keyword 만 있어도 block_swap', () => {
    const r = classifyModification('DMZ 가고 싶어요');
    expect(r.intent).toBe('block_swap');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('트레킹 + day 명시 → block_swap (높은 confidence)', () => {
    const r = classifyModification('2일차에 북한산 트레킹 추가해주세요');
    expect(r.intent).toBe('block_swap');
    expect(r.target?.day_index).toBe(2);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe('classifyModification — stop_swap', () => {
  it('식당 바꿔달라 → stop_swap', () => {
    const r = classifyModification('Day 3 식당 다른 곳으로 바꿔주세요');
    expect(r.intent).toBe('stop_swap');
    expect(r.target?.day_index).toBe(3);
    expect(r.target?.stop_name).toBe('식당');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('cafe 영어 keyword + change trigger', () => {
    const r = classifyModification('change cafe to a different one');
    expect(r.intent).toBe('stop_swap');
  });
});

describe('classifyModification — stop_add', () => {
  it('N서울타워 추가 → stop_add', () => {
    const r = classifyModification('N서울타워 추가해주세요');
    expect(r.intent).toBe('stop_add');
    expect(r.target?.stop_name).toBe('N서울타워');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('add trigger 만 있고 known stop / zone keyword 없음 → 낮은 confidence', () => {
    // 'unique place X' 같은 임의 명소 — 키워드 사전에 없음
    const r = classifyModification('어떤 특별한 장소 하나 추가해주세요');
    expect(r.intent).toBe('stop_add');
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.fallback_reason).toContain('LLM');
  });
});

describe('classifyModification — stop_remove', () => {
  it('빼주세요 → stop_remove', () => {
    const r = classifyModification('Day 2 인사동 빼주세요');
    expect(r.intent).toBe('stop_remove');
    expect(r.target?.day_index).toBe(2);
  });

  it('cancel + stop X → stop_remove with stop_order', () => {
    const r = classifyModification('cancel stop 3');
    expect(r.intent).toBe('stop_remove');
    expect(r.target?.stop_order).toBe(3);
  });
});

describe('classifyModification — no_change / safe fallback', () => {
  it('빈 string → no_change', () => {
    const r = classifyModification('');
    expect(r.intent).toBe('no_change');
    expect(r.confidence).toBe(0);
    expect(r.fallback_reason).toBe('empty input');
  });

  it('null 입력 → no_change (no throw)', () => {
    expect(() => classifyModification(null)).not.toThrow();
    const r = classifyModification(null);
    expect(r.intent).toBe('no_change');
    expect(r.fallback_reason).toBe('non-string input');
  });

  it('undefined 입력 → no_change (no throw)', () => {
    expect(() => classifyModification(undefined)).not.toThrow();
    const r = classifyModification(undefined);
    expect(r.intent).toBe('no_change');
  });

  it('비-string (숫자) 입력 → no_change (no throw)', () => {
    expect(() => classifyModification(123 as unknown as string)).not.toThrow();
    const r = classifyModification(123 as unknown as string);
    expect(r.intent).toBe('no_change');
    expect(r.fallback_reason).toBe('non-string input');
  });

  it('너무 긴 input (>1000 chars) → no_change', () => {
    const long = 'a'.repeat(1001);
    const r = classifyModification(long);
    expect(r.intent).toBe('no_change');
    expect(r.fallback_reason).toContain('too long');
  });

  it('의미 없는 keyword 매칭 안 됨 → no_change', () => {
    const r = classifyModification('asdfqwerty zxcvbn');
    expect(r.intent).toBe('no_change');
    expect(r.fallback_reason).toBe('no keyword match');
  });
});
