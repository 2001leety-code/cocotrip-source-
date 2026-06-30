/**
 * charter_custom_estimate 즉시결제 배선 회귀 가드.
 *
 * 배경(2026-06-30): zone-fallback 추정가 상품 charter_custom_estimate 가 결제 전면차단
 *   ("Unknown productType or invalid amount: charter_custom_estimate"). 두 곳 배선 단절:
 *   (A) api/createPaypalOrder.js: charter_custom_estimate 분기 없음 → resolveKrwAmount→null→400.
 *   (B) src/components/PayPalBookingButton.tsx: createPaypalOrder fetch body 에 customAmountKRW 미전달.
 *
 * 이 테스트는 (1) SSOT sanity range 상수/판별 헬퍼, (2) 가드 predicate 경계,
 *   (3) 양 배선이 소스에 실제로 존재함(grep) 을 잠가 회귀를 차단한다.
 *   실 PayPal capture e2e 는 외부 인증벽 → 운영자.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CUSTOM_ESTIMATE_PRODUCT,
  CUSTOM_ESTIMATE_MIN_KRW,
  CUSTOM_ESTIMATE_MAX_KRW,
  isCustomEstimateProduct,
} from '../../api/_shared/pricing.js';

// createPaypalOrder.js 의 charter_custom_estimate 분기와 동일한 sanity predicate(순수 복제).
// 실 핸들러는 PayPal/Firebase 의존이라 직접 호출 불가 → 가격 가드 로직만 격리 검증.
function customAmountAccepted(raw: unknown): boolean {
  const n = Number(raw);
  return Number.isFinite(n) && n >= CUSTOM_ESTIMATE_MIN_KRW && n <= CUSTOM_ESTIMATE_MAX_KRW;
}

describe('charter_custom_estimate — SSOT sanity 상수', () => {
  it('상품키 = charter_custom_estimate', () => {
    expect(CUSTOM_ESTIMATE_PRODUCT).toBe('charter_custom_estimate');
  });
  it('MIN 30,000 / MAX 10,000,000 (운영자 정산 범위)', () => {
    expect(CUSTOM_ESTIMATE_MIN_KRW).toBe(30_000);
    expect(CUSTOM_ESTIMATE_MAX_KRW).toBe(10_000_000);
    expect(CUSTOM_ESTIMATE_MIN_KRW).toBeLessThan(CUSTOM_ESTIMATE_MAX_KRW);
  });
  it('isCustomEstimateProduct: hyphen/underscore 정규화', () => {
    expect(isCustomEstimateProduct('charter_custom_estimate')).toBe(true);
    expect(isCustomEstimateProduct('charter-custom-estimate')).toBe(true);
    expect(isCustomEstimateProduct('charter_multiday')).toBe(false);
    expect(isCustomEstimateProduct('ai_planner_full')).toBe(false);
    expect(isCustomEstimateProduct(undefined as unknown as string)).toBe(false);
  });
});

describe('charter_custom_estimate — customAmountKRW sanity 가드 경계', () => {
  it('범위 내 금액 통과', () => {
    expect(customAmountAccepted(30_000)).toBe(true);       // 하한 경계
    expect(customAmountAccepted(124_000)).toBe(true);      // 전형 차터 견적
    expect(customAmountAccepted(10_000_000)).toBe(true);   // 상한 경계
  });
  it('하한 미만 차단 (1원·0·MIN-1)', () => {
    expect(customAmountAccepted(1)).toBe(false);
    expect(customAmountAccepted(0)).toBe(false);
    expect(customAmountAccepted(29_999)).toBe(false);
  });
  it('상한 초과 차단', () => {
    expect(customAmountAccepted(10_000_001)).toBe(false);
    expect(customAmountAccepted(50_000_000)).toBe(false);
  });
  it('음수·NaN·비수치 차단', () => {
    expect(customAmountAccepted(-124_000)).toBe(false);
    expect(customAmountAccepted(NaN)).toBe(false);
    expect(customAmountAccepted('abc')).toBe(false);
    expect(customAmountAccepted(null)).toBe(false);
    expect(customAmountAccepted(undefined)).toBe(false);
    expect(customAmountAccepted(Infinity)).toBe(false);
  });
});

describe('charter_custom_estimate — 배선 회귀 가드 (소스 존재 확인)', () => {
  const apiSrc = readFileSync(join(process.cwd(), 'api/createPaypalOrder.js'), 'utf-8');
  const btnSrc = readFileSync(join(process.cwd(), 'src/components/PayPalBookingButton.tsx'), 'utf-8');

  it('(A) createPaypalOrder 가 isCustomEstimateProduct 분기 + SSOT range 가드 보유', () => {
    expect(apiSrc).toContain('isCustomEstimateProduct(productType)');
    expect(apiSrc).toContain('CUSTOM_ESTIMATE_MIN_KRW');
    expect(apiSrc).toContain('CUSTOM_ESTIMATE_MAX_KRW');
    expect(apiSrc).toContain('body.customAmountKRW');
    // 분기는 resolveKrwAmount else 폴백보다 앞서야 함(폴백=null→400 회피).
    const idxBranch = apiSrc.indexOf('isCustomEstimateProduct(productType)');
    const idxElseFallback = apiSrc.indexOf('krwAmount = resolveKrwAmount(productType');
    expect(idxBranch).toBeGreaterThan(0);
    expect(idxBranch).toBeLessThan(idxElseFallback);
  });

  it('(B) PayPalBookingButton createPaypalOrder body 가 customAmountKRW 전달', () => {
    expect(btnSrc).toContain("productType === 'charter_custom_estimate' && customAmountKRW != null && customAmountKRW > 0 ? { customAmountKRW } : {}");
  });
});
