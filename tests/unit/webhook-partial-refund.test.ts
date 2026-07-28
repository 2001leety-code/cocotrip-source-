/**
 * paypal-webhook REFUNDED — 부분/전체 환불 status 판별 회귀 (2026-06-13 버그헌트).
 * 결함: 부분환불(refundedUSD < 원결제)도 status='REFUNDED'(전액) 로 기록 → 운영자/고객
 *   화면에 전액환불로 오표시.
 * fix: 환불액 < 원결제(1% 허용) 면 'PARTIALLY_REFUNDED'.
 *   (누적 increment 미도입 — admin mark-refunded → refundPaypalCapture → 같은 환불로 webhook
 *    이중발사 시 set+increment 중복합산 위험. 이번 이벤트 금액 set 유지가 안전.)
 *
 * 🔴 2026-07-29 갱신: 판정을 KRW → **USD** 로 옮겼다.
 *   옛 공식은 환불 USD 를 "지금 시점 env 환율(없으면 1430)"로 KRW 환산해 비교했다.
 *   원결제 환율과 다르면 판정이 뒤집힌다 — 실제 구조: ₩13,300 을 환율 1,468 로 $9.06
 *   청구 → 전액 환불 $9.06 을 1,430 으로 환산하면 ₩12,956 < ₩13,167(99%) →
 *   **전액인데 부분으로 오기록**. PayPal 은 USD 로 결제·환불하므로 USD 끼리 비교가 진실이다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/paypal-webhook.js'), 'utf8');

describe('paypal-webhook 부분환불 status (소스 가드)', () => {
  it('PARTIALLY_REFUNDED status 도입', () => {
    expect(src).toContain('PARTIALLY_REFUNDED');
  });
  it('부분 판별은 USD 끼리 비교한다 (환율이 개입하면 안 된다)', () => {
    expect(src).toMatch(/isPartialRefund\s*=\s*originalUSD\s*>\s*0/);
    // 2026-07-29: 여러 번 나눠 환불한 경우를 위해 **누적액**으로 비교한다.
    //   ($5 + $4.90 처럼 쪼개면 이번 이벤트 금액만 보고는 영원히 부분환불로 남는다)
    expect(src).toMatch(/cumulativeRefundedUSD\s*<\s*originalUSD\s*\*\s*0\.99/);
    expect(src).toContain('refundedUSDTotal');
  });

  it('옛 KRW 기반 판정이 되살아나지 않는다', () => {
    // 이 형태로 되돌아가면 환율 하나로 전액/부분이 뒤집힌다.
    expect(src).not.toMatch(
      /isPartialRefund\s*=\s*priceKRW\s*>\s*0\s*&&\s*refundedKRW\s*<\s*Math\.round\(priceKRW\s*\*\s*0\.99\)/,
    );
  });

  it('표시용 KRW 환산은 결제 당시 환율을 우선한다', () => {
    expect(src).toMatch(/const\s+usdToKrw\s*=\s*capturedRate/);
    expect(src).toContain('capturedExchangeRate');
  });

  it('원결제 USD 를 모르는 레거시 문서만 KRW 비교로 폴백한다', () => {
    expect(src).toMatch(/priceKRW\s*>\s*0\s*&&\s*refundedKRW\s*<\s*Math\.round\(priceKRW\s*\*\s*0\.99\)/);
  });
  it('status 가 isPartialRefund 분기로 결정 (전액환불 무조건 REFUNDED 제거)', () => {
    expect(src).toMatch(
      /status:\s*isPartialRefund\s*\?\s*['"]PARTIALLY_REFUNDED['"]\s*:\s*['"]REFUNDED['"]/,
    );
  });
});
