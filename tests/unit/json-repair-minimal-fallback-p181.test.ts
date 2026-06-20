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

// ── #6 (2026-06-20): backward-walk inString 추적 — 문자열 내부 숫자에서 cut 금지 ──
// 버그: backward walk 가 inString 미추적 → `"tour_title":"call 02-123` 처럼 문자열 내부
//   숫자(또는 true/false/null 부분문자열)에서 cut → 열린 따옴표 미닫힘 fragment → 수리/복원
//   실패. fix: forward 패스로 index 별 inString 마킹 → 숫자/리터럴 cut + 여는따옴표 cut 을
//   문자열 밖에서만 허용. days[] 완결 + trailing top-level 문자열 잘림 = prod 실 케이스.
describe('#6 repairAndParseJSON — 문자열 내부 숫자/리터럴 오절단 방지 (inString 추적)', () => {
  it('days[] 완결 + trailing 문자열 내부 숫자에서 잘림 → days 온전 복원', () => {
    // "tour_title":"call 02-123 — 따옴표 미닫힘 + 내부 숫자. 이전엔 '3' 에서 cut 하여
    //   `"call 02-12` dangling 문자열 fragment 생성. fix 후엔 문자열 밖까지 walk back →
    //   완결 days[] 가 손상 없이 복원.
    const raw =
      '{"days":[{"day":1,"stops":[{"name":"경복궁"}]}],' +
      '"t_money_recommended_load":50000,"tour_title":"call 02-123';
    const out = repairAndParseJSON(raw);
    expect(out).toBeTruthy();
    expect(Array.isArray(out.days)).toBe(true);
    expect(out.days).toHaveLength(1);
    expect(out.days[0].stops[0].name).toBe('경복궁');
  });

  it('days[] 완결 + 문자열 내부 "true" 부분문자열에서 잘림 → 두 day 모두 복원', () => {
    // "note":"this is true — 문자열 내부 "true" 가 backward 리터럴 매칭에 걸리면 오절단.
    //   inString 가드로 cut 금지 → days[] 2건 온전.
    const raw =
      '{"days":[{"day":1,"stops":[{"name":"A"}]},{"day":2,"stops":[{"name":"B"}]}],' +
      '"note":"this is true';
    const out = repairAndParseJSON(raw);
    expect(out).toBeTruthy();
    expect(out.days).toHaveLength(2);
    expect(out.days[0].stops[0].name).toBe('A');
    expect(out.days[1].stops[0].name).toBe('B');
  });

  it('문자열 밖 숫자에서는 정상 cut (회귀 방지) — 값 보존', () => {
    // base_price_krw 값(문자열 밖 숫자)이 마지막이면 그 숫자에서 cut 해도 valid + 값 유지.
    const raw = '{"days":[{"day":1,"stops":[{"name":"A"}]}],"base_price_krw":480000';
    const out = repairAndParseJSON(raw);
    expect(out).toBeTruthy();
    expect(out.base_price_krw).toBe(480000); // out-of-string 숫자 cut 정상 동작
    expect(out.days[0].stops[0].name).toBe('A');
  });
});
