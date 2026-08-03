/**
 * 회귀 잠금 (2026-08-03) — 품질 표본에서 운영자·CI 테스트 플랜 제외.
 *
 * L3 Daily Quality Score Monitor 는 "손님 플랜 품질" 을 본다고 하면서 실제로는
 * 자기 스모크 테스트를 재고 있었다. 운영 실측: 24h 25건 · 7일 43건이 **전부**
 * `isAdminBypass:true` · `paymentSource:'admin-bypass'` · guestEmail = 운영자 계정.
 * 손님 플랜은 0건. daily-health 의 플랜 스모크가 매주 운영 Firestore 에 실제
 * 플랜을 만들기 때문이다.
 *
 * 제외 건수는 반드시 함께 노출한다 — 조용히 0건이 되면 "품질 회귀" 인지
 * "손님 트래픽 0" 인지 구분할 수 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — JS module
import { isOperatorTestPlan, keepCustomerPlans } from '../../api/_shared/quality-summary-helper.js';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const scored = (over: Record<string, unknown> = {}) => ({
  qualityScore: { score: 90, metrics: {} },
  ...over,
});

describe('테스트 플랜 판정', () => {
  it('isAdminBypass 플래그를 잡는다', () => {
    expect(isOperatorTestPlan(scored({ isAdminBypass: true }))).toBe(true);
  });

  it("paymentSource 'admin-bypass' 를 잡는다", () => {
    expect(isOperatorTestPlan(scored({ paymentSource: 'admin-bypass' }))).toBe(true);
  });

  it('운영자 계정 guestEmail 을 잡는다 (매출 집계와 같은 허용목록)', () => {
    expect(isOperatorTestPlan(scored({ guestEmail: '2001leety@gmail.com' }))).toBe(true);
    expect(isOperatorTestPlan(scored({ guestEmail: '2001LEETY@Gmail.com ' }))).toBe(true);
  });

  it('손님 플랜은 남긴다', () => {
    expect(isOperatorTestPlan(scored({ guestEmail: 'guest@example.com', paymentSource: 'paypal' }))).toBe(false);
    expect(isOperatorTestPlan(scored({}))).toBe(false);
  });

  it('isAdminBypass=false 는 테스트 플랜이 아니다 (플래그 존재만으로 걸리면 안 된다)', () => {
    expect(isOperatorTestPlan(scored({ isAdminBypass: false, guestEmail: 'guest@example.com' }))).toBe(false);
  });

  it('null / undefined 안전', () => {
    expect(isOperatorTestPlan(null)).toBe(false);
    expect(isOperatorTestPlan(undefined)).toBe(false);
  });
});

describe('keepCustomerPlans', () => {
  it('제외 건수를 함께 돌려준다', () => {
    const { customer, excludedTestPlans } = keepCustomerPlans([
      scored({ isAdminBypass: true }),
      scored({ paymentSource: 'admin-bypass' }),
      scored({ guestEmail: 'guest@example.com' }),
    ]);
    expect(customer).toHaveLength(1);
    expect(excludedTestPlans).toBe(2);
  });

  it('운영 재현: 전부 테스트 플랜이면 손님 0건 + 제외 건수가 남는다', () => {
    const { customer, excludedTestPlans } = keepCustomerPlans(
      Array.from({ length: 25 }, () => scored({ isAdminBypass: true, paymentSource: 'admin-bypass' })),
    );
    expect(customer).toHaveLength(0);
    // 조용히 0 이 되면 안 된다 — 왜 0 인지가 남아야 한다.
    expect(excludedTestPlans).toBe(25);
  });

  it('빈 입력·비배열 안전', () => {
    expect(keepCustomerPlans([]).customer).toHaveLength(0);
    expect(keepCustomerPlans(undefined).excludedTestPlans).toBe(0);
  });
});

describe('제외 건수가 실제로 밖으로 나간다', () => {
  it('admin-quality-summary 가 window.excludedTestPlans 를 응답에 넣는다', () => {
    const code = read('api/admin-quality-summary.js');
    expect(code).toContain('keepCustomerPlans');
    expect(code).toContain('excludedTestPlans');
  });

  it('L3 모니터가 그 값을 읽어 상태 파일·요약에 남긴다', () => {
    const code = read('scripts/check-quality-score.mjs');
    expect(code).toContain('excludedTestPlans');
  });

  it('주간 리포트 helper 도 같은 필터를 탄다', () => {
    const code = read('api/_shared/quality-summary-helper.js');
    expect(code).toContain('keepCustomerPlans(scored)');
    // 이메일 허용목록을 두 곳에 적지 않는다.
    expect(code).toContain("from './admin-bypass-detector.js'");
  });
});
