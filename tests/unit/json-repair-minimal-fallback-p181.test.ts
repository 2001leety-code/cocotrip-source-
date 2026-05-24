/**
 * P181 phase 2 (2026-05-24): JSON repair fail 시 last-resort minimal plan fallback.
 *
 * 운영자 zero-tolerance ("플랜 만들었을때 오류 1도없이"). repair fail (이전 throw
 * 500) 대신 days[] regex extract → minimal plan 반환. user 가 어떤 case 에도 plan.
 *
 * 회귀 시: fallback 누락 → INVALID_JSON throw → user 500.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async () => ({ ok: true })),
}));

import { repairAndParseJSON } from '../../api/_ai_core/responseValidator.js';

describe('P181 phase 2 minimal fallback', () => {
  it('완전 valid JSON → repair 안 거치고 직접 parse', () => {
    const raw = '{"days":[{"day":1,"stops":[]}]}';
    const out = repairAndParseJSON(raw);
    expect(out.days).toHaveLength(1);
    expect(out.__repair_minimal_fallback).toBeUndefined();
  });

  it('truncated JSON (마지막 } 후 cut) → repair 또는 minimal fallback 으로 plan 복원', () => {
    // 마지막 `}` 후 cut — repair 가 outer brace/bracket 추가로 valid 만들거나
    // minimal fallback 이 days[] regex 로 추출
    const raw = '{"days":[{"day":1,"stops":[{"name":"A"}]}';
    const out = repairAndParseJSON(raw);
    expect(out).toBeTruthy();
    expect(Array.isArray(out.days)).toBe(true);
    expect(out.days.length).toBeGreaterThanOrEqual(1);
  });

  it('repair 도 실패 + days[] regex extract 성공 → minimal fallback 반환', () => {
    // 가장 앞 brace 잘려서 cleaned indexOf('{') 가 nested 위치 → cleaned 가 깨진 prefix
    // 인 경우. 단 valid days[] 는 존재.
    const raw = `BROKEN_PREFIX]]]} not json at all but "days": [{"day":1,"stops":[{"name":"Seoul"}]},{"day":2,"stops":[{"name":"Busan"}]}] more broken`;
    const out = repairAndParseJSON(raw);
    expect(out).toBeTruthy();
    expect(out.__repair_minimal_fallback).toBe(true);
    expect(out.days).toHaveLength(2);
    expect(out.days[0].day).toBe(1);
    expect(out.days[1].day).toBe(2);
  });

  it('completely garbage (days[] 없음) → 여전히 throw (last-resort fail)', () => {
    const raw = `complete garbage no JSON structure at all just random text...`;
    expect(() => repairAndParseJSON(raw)).toThrow(/invalid JSON/);
  });
});
