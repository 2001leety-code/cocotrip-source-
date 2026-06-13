/**
 * paypal-webhook REFUNDED — 부분/전체 환불 status 판별 회귀 (2026-06-13 버그헌트).
 * 결함: 부분환불(refundedUSD < 원결제)도 status='REFUNDED'(전액) 로 기록 → 운영자/고객
 *   화면에 전액환불로 오표시.
 * fix: 이번 환불 KRW < 원결제 priceKRW(1% 허용) 면 'PARTIALLY_REFUNDED'.
 *   (누적 increment 미도입 — admin mark-refunded → refundPaypalCapture → 같은 환불로 webhook
 *    이중발사 시 set+increment 중복합산 위험. 이번 이벤트 금액 set 유지가 안전.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'api/paypal-webhook.js'), 'utf8');

describe('paypal-webhook 부분환불 status (소스 가드)', () => {
  it('PARTIALLY_REFUNDED status 도입', () => {
    expect(src).toContain('PARTIALLY_REFUNDED');
  });
  it('부분 판별 = 이번 환불 KRW < 원결제 priceKRW (1% 허용)', () => {
    expect(src).toMatch(
      /isPartialRefund\s*=\s*priceKRW\s*>\s*0\s*&&\s*refundedKRW\s*<\s*Math\.round\(priceKRW\s*\*\s*0\.99\)/,
    );
  });
  it('status 가 isPartialRefund 분기로 결정 (전액환불 무조건 REFUNDED 제거)', () => {
    expect(src).toMatch(
      /status:\s*isPartialRefund\s*\?\s*['"]PARTIALLY_REFUNDED['"]\s*:\s*['"]REFUNDED['"]/,
    );
  });
});
