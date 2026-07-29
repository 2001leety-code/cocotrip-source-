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

// 🔴 2026-07-29 (원자화): 판정 로직이 api/_shared/refund-ledger.js 로 옮겨졌다.
//   읽기-판정-쓰기-완료기록을 하나의 transaction 에 넣기 위해서다(동시 부분환불 갱신 유실 차단).
//   불변식은 그대로라 검사 대상 파일만 따라간다.
//   실제 금액·상태 **행위 검증은 tests/unit/refund-ledger-race.test.ts** 가 담당한다.
const ledgerSrc = readFileSync(resolve(process.cwd(), 'api/_shared/refund-ledger.js'), 'utf8');

describe('paypal-webhook 부분환불 status (소스 가드)', () => {
  it('PARTIALLY_REFUNDED status 도입', () => {
    expect(ledgerSrc).toContain('PARTIALLY_REFUNDED');
  });
  it('부분 판별은 USD 끼리 비교한다 (환율이 개입하면 안 된다)', () => {
    expect(ledgerSrc).toMatch(/Number\(originalUSD\)\s*>\s*0/);
    // 2026-07-29: 여러 번 나눠 환불한 경우를 위해 **누적액**으로 비교한다.
    //   ($5 + $4.90 처럼 쪼개면 이번 이벤트 금액만 보고는 영원히 부분환불로 남는다)
    expect(ledgerSrc).toMatch(/round2\(cumulativeRefundedUSD\)\s*<\s*Number\(originalUSD\)\s*\*\s*FULL_REFUND_RATIO/);
    expect(ledgerSrc).toContain('refundedUSDTotal');
  });

  it('옛 KRW 기반 판정이 되살아나지 않는다', () => {
    // 이 형태로 되돌아가면 환율 하나로 전액/부분이 뒤집힌다.
    for (const s of [src, ledgerSrc]) {
      expect(s).not.toMatch(
        /isPartialRefund\s*=\s*priceKRW\s*>\s*0\s*&&\s*refundedKRW\s*<\s*Math\.round\(priceKRW\s*\*\s*0\.99\)/,
      );
    }
  });

  it('표시용 KRW 환산은 결제 당시 환율을 우선한다', () => {
    expect(src).toMatch(/const\s+usdToKrw\s*=\s*capturedRate/);
    expect(src).toContain('capturedExchangeRate');
  });

  it('원결제 USD 를 모르는 레거시 문서만 KRW 비교로 폴백한다', () => {
    // USD 분기가 먼저 오고, KRW 는 그 다음 else 가지에서만 쓰인다.
    const usdBranch = ledgerSrc.indexOf('Number(originalUSD) > 0');
    const krwBranch = ledgerSrc.indexOf('Number(priceKRW) > 0');
    expect(usdBranch).toBeGreaterThan(-1);
    expect(krwBranch).toBeGreaterThan(usdBranch);
  });
  it('status 는 전액/부분 두 값 중 하나로 결정된다 (전액환불 무조건 REFUNDED 제거)', () => {
    expect(ledgerSrc).toContain("? 'PARTIALLY_REFUNDED'");
    expect(ledgerSrc).toContain(": 'REFUNDED'");
  });
  it('상태 서열이 낮은 쪽으로 내려가지 않는다 (늦게 온 부분환불 방어)', () => {
    expect(ledgerSrc).toMatch(/rankOf\(next\)\s*>=\s*rankOf\(priorStatus\)/);
  });
});
