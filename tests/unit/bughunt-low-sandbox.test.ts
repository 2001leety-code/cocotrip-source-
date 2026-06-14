/**
 * Regression guard — bughunt LOW: PROMO 자동환불 isSandbox 하드코딩 수정
 *
 * 버그: api/capturePaypalOrder.js 의 PROMO_LIMIT_EXCEEDED 자동환불 경로에서
 *   refundPaypalCapture({ ..., isSandbox: false })
 * 처럼 isSandbox 를 false 로 하드코딩. capture 자체는 L121 resolveIsSandbox()
 * 런타임 결정(VERCEL_ENV + PAYPAL_ENV 이중 가드) — sandbox preview e2e 중
 * PROMO 한도 초과 시 sandbox 캡처를 LIVE PayPal 로 환불 시도 → 실패.
 *
 * 수정: isSandbox: false → isSandbox: _isSandboxCapture
 *   prod(_isSandboxCapture=false) 에서는 동작 동일, sandbox 에서만 올바른
 *   환경(sandbox PayPal)으로 환불.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const captureSrc = readFileSync(
  resolve(process.cwd(), 'api/capturePaypalOrder.js'),
  'utf8',
);

describe('bughunt-low: PROMO 자동환불 isSandbox 하드코딩 수정', () => {
  it('PROMO_LIMIT_EXCEEDED 환불 호출에 isSandbox: false 하드코딩이 없다', () => {
    // PROMO_LIMIT_EXCEEDED 블록 내 refundPaypalCapture 호출에서
    // isSandbox: false 가 남아 있으면 sandbox e2e 환불이 LIVE PayPal 로 향함.
    // 이 패턴이 없어야 버그 fix 상태.
    const hardcodedFalse = /PROMO_LIMIT_EXCEEDED[\s\S]{0,600}isSandbox\s*:\s*false/;
    expect(captureSrc).not.toMatch(hardcodedFalse);
  });

  it('PROMO_LIMIT_EXCEEDED 환불 호출이 _isSandboxCapture 변수를 사용한다', () => {
    // 수정 후: isSandbox: _isSandboxCapture 로 런타임 결정값 전달.
    const dynamicSandbox = /PROMO_LIMIT_EXCEEDED[\s\S]{0,600}isSandbox\s*:\s*_isSandboxCapture/;
    expect(captureSrc).toMatch(dynamicSandbox);
  });

  it('_isSandboxCapture 는 resolveIsSandbox() 호출로 선언된다', () => {
    // capture 진입점에서 런타임 결정 — 이중 가드(VERCEL_ENV + PAYPAL_ENV).
    expect(captureSrc).toMatch(/const\s+_isSandboxCapture\s*=\s*resolveIsSandbox\s*\(\s*\)/);
  });

  it('refundPaypalCapture 는 여전히 PROMO 경로에서 호출된다 (환불 로직 제거 방지)', () => {
    // 환불 자체가 제거되지 않았는지 확인.
    const promoRefund = /PROMO_LIMIT_EXCEEDED[\s\S]{0,800}refundPaypalCapture\s*\(/;
    expect(captureSrc).toMatch(promoRefund);
  });

  it('다른 isSandbox 사용처(_isSandboxCapture 런타임 변수)는 건드리지 않았다', () => {
    // _isSandboxCapture 를 올바르게 전달하는 다른 호출들(getPaypalAccessToken 등)
    // 이 여전히 존재하는지 — capture 파일 전체에 _isSandboxCapture 가 2회 이상 등장.
    const occurrences = (captureSrc.match(/_isSandboxCapture/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
