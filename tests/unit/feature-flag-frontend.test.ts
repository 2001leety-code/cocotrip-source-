import { describe, it, expect } from 'vitest';
import { isFeatureFlagOn } from '../../src/lib/featureFlag';

// 2026-06-11 사고 회귀: 운영자가 Vercel 에 VITE_FEATURE_CART 를 켰는데 값에 보이지 않는 앞 공백/탭이
// 섞여(" true" / "\ttrue") 바닐라 `=== 'true'` 가 false → 장바구니/검수 안 보임. trim+lowercase 로 방어.
describe('isFeatureFlagOn — env 앞뒤 공백/탭 방어 (백 featureEnabled 와 동일 규칙)', () => {
  it('실제 사고 값: 앞 공백/탭 있어도 true', () => {
    expect(isFeatureFlagOn(' true')).toBe(true);   // VITE_FEATURE_CART 실측
    expect(isFeatureFlagOn('\ttrue')).toBe(true);  // VITE_FEATURE_REVIEW_EDIT 실측
    expect(isFeatureFlagOn('true ')).toBe(true);   // 뒤 공백
    expect(isFeatureFlagOn(' true ')).toBe(true);
  });
  it('value 는 엄격 — 대문자 TRUE/True 는 false (실수 활성 방지, isCartEnabled 의도 보존)', () => {
    expect(isFeatureFlagOn('TRUE')).toBe(false);
    expect(isFeatureFlagOn(' True ')).toBe(false);
  });
  it('깨끗한 true', () => {
    expect(isFeatureFlagOn('true')).toBe(true);
  });
  it('off: false/빈값/undefined/숫자', () => {
    expect(isFeatureFlagOn('false')).toBe(false);
    expect(isFeatureFlagOn('')).toBe(false);
    expect(isFeatureFlagOn('   ')).toBe(false);
    expect(isFeatureFlagOn(undefined)).toBe(false);
    expect(isFeatureFlagOn('1')).toBe(false);
    expect(isFeatureFlagOn('yes')).toBe(false);
  });
});
