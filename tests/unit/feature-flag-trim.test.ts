/**
 * featureEnabled — FEATURE_* env 플래그 공백 방어 (2026-06-05)
 *
 * prod 사고: FEATURE_TRANSFER_CHECKOUT = "\ttrue" (앞 탭) → 옛 `String(env).toLowerCase()==='true'`
 *   (trim 없음) 가 false 판정 → transfer 즉시결제 백엔드 silent OFF (프론트는 ON) → 결제 실패.
 *   featureEnabled 가 trim 후 비교 → 운영자 의도(true) 정확히 honor.
 */
import { describe, it, expect } from 'vitest';
import { featureEnabled } from '../../api/_shared/feature-flag.js';

describe('featureEnabled — env 플래그 공백 방어', () => {
  it('정상 "true" → true', () => {
    expect(featureEnabled('true')).toBe(true);
  });

  it('🔴 prod 버그 케이스 "\\ttrue" (앞 탭) → true (trim)', () => {
    expect(featureEnabled('\ttrue')).toBe(true);
  });

  it('공백/개행 둘러싼 값 → true (" true ", "true\\n", "\\n\\ttrue ")', () => {
    expect(featureEnabled(' true ')).toBe(true);
    expect(featureEnabled('true\n')).toBe(true);
    expect(featureEnabled('\n\ttrue ')).toBe(true);
  });

  it('대소문자 무관 ("TRUE", "True") → true', () => {
    expect(featureEnabled('TRUE')).toBe(true);
    expect(featureEnabled('True')).toBe(true);
  });

  it('false/빈값/undefined/null → false (결제 게이트 닫힘)', () => {
    expect(featureEnabled('false')).toBe(false);
    expect(featureEnabled('')).toBe(false);
    expect(featureEnabled(undefined)).toBe(false);
    expect(featureEnabled(null)).toBe(false);
    expect(featureEnabled('  ')).toBe(false);
  });

  it('"true" 외 truthy 문자열은 false (1/yes/on/truthy)', () => {
    expect(featureEnabled('1')).toBe(false);
    expect(featureEnabled('yes')).toBe(false);
    expect(featureEnabled('on')).toBe(false);
    expect(featureEnabled('truthy')).toBe(false);
  });
});
