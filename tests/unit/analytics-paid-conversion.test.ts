/**
 * GA4 유료 전환(purchase) 추적 — 홍보 실행안 1순위 (2026-06-04).
 *
 * 배경: GA4 ecommerce(trackPurchase 등)가 정의만 되고 호출 0건(dead code) → GA4 'purchase' 전환
 *   데이터 0 → Google Ads 가 import 할 전환이 없었음. PostHog payment_completed 는 발화 중이나
 *   prod VITE_POSTHOG_KEY 미설정이라 그쪽도 데이터 0(운영자 키 설정 별건). 본 PR=GA4 purchase 발화.
 *
 * 가드: ① trackPaidConversion 이 GA4 표준 'purchase'를 value/currency/transaction_id/items 로 발화
 *       ② GA_ID 미설정 시 no-op  ③ PayPalBookingButton 성공 경로가 실제로 호출(dead-code 회귀 방지)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 2026-07-30: GA4 전송은 **쿠키 동의(accepted)** 가 있을 때만 나간다. 그래서 이 테스트의
 * 가짜 window 도 동의 상태를 들고 있어야 한다(예전에는 gtag 만 있으면 발화했다).
 * 동의 없는 경우는 아래 별도 케이스로 잠근다.
 */
function stubWindow(gtag: ReturnType<typeof vi.fn>, consent: string | null) {
  vi.stubGlobal('window', {
    gtag,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => consent, setItem: () => {} },
  });
}

describe('trackPaidConversion — GA4 purchase 전환 발화', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('GA_ID 설정 + gtag 존재 + 동의 → purchase 를 value/currency/transaction_id/items 로 발화', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    stubWindow(gtag, 'accepted');
    const { trackPaidConversion } = await import('../../src/lib/analytics');
    trackPaidConversion({ transactionId: 'ORDER-1', productType: 'planner', value: 12800, currency: 'KRW' });
    expect(gtag).toHaveBeenCalledTimes(1);
    const args = gtag.mock.calls[0];
    expect(args[0]).toBe('event');
    expect(args[1]).toBe('purchase');
    expect(args[2].transaction_id).toBe('ORDER-1');
    expect(args[2].value).toBe(12800);
    expect(args[2].currency).toBe('KRW');
    expect(Array.isArray(args[2].items)).toBe(true);
    expect(args[2].items[0].item_id).toBe('planner');
    expect(args[2].items[0].price).toBe(12800);
  });

  it('GA_ID 미설정 → no-op (빌드/preview/공개포크 무해)', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '');
    const gtag = vi.fn();
    stubWindow(gtag, 'accepted');
    const { trackPaidConversion } = await import('../../src/lib/analytics');
    trackPaidConversion({ transactionId: 'X', productType: 'planner', value: 1, currency: 'KRW' });
    expect(gtag).not.toHaveBeenCalled();
  });

  it('🔴 동의 없음(선택 전) → 결제 전환도 보내지 않는다', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    stubWindow(gtag, null);
    const { trackPaidConversion } = await import('../../src/lib/analytics');
    trackPaidConversion({ transactionId: 'ORDER-2', productType: 'planner', value: 100, currency: 'KRW' });
    expect(gtag).not.toHaveBeenCalled();
  });

  it('🔴 동의 철회(revoked) → 보내지 않는다', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    stubWindow(gtag, 'revoked');
    const { trackPaidConversion } = await import('../../src/lib/analytics');
    trackPaidConversion({ transactionId: 'ORDER-3', productType: 'planner', value: 100, currency: 'KRW' });
    expect(gtag).not.toHaveBeenCalled();
  });
});

describe('GA4 gtag 스텁 형식 가드 (2026-06-04 GA 데이터 0 버그 회귀 방지)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'lib', 'analytics.ts'), 'utf8');
  it('initGA 가 dataLayer 에 arguments 객체를 push (실제 배열 push 시 gtag.js 명령 미인식 → collect 0)', () => {
    expect(src).toMatch(/window\.dataLayer!?\.push\(arguments\)/);
  });
  it('회귀 형태(배열 push) 부재', () => {
    expect(src).not.toMatch(/window\.dataLayer!?\.push\(args\)/);
  });
});

describe('PayPalBookingButton — GA4 전환 배선 가드 (dead-code 회귀 방지)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'PayPalBookingButton.tsx'), 'utf8');
  it('analytics trackPaidConversion + trackBeginCheckout 를 import', () => {
    expect(src).toMatch(/import\s*\{[^}]*\btrackPaidConversion\b[^}]*\}\s*from\s*'@\/lib\/analytics'/);
    expect(src).toMatch(/import\s*\{[^}]*\btrackBeginCheckout\b[^}]*\}\s*from\s*'@\/lib\/analytics'/);
  });
  it("결제 성공(purchase) 경로에서 orderID + USD(effectiveKRW 환산) 로 호출", () => {
    // 운영자 "달러로 맞춰"(2026-06-15): PayPal 청구통화=USD 와 일치. value=쿠폰/할인 후 실제 낸 금액.
    expect(src).toMatch(/trackPaidConversion\(\{[\s\S]*?transactionId:\s*data\.orderID[\s\S]*?value:\s*Math\.round\(\(effectiveKRW[\s\S]*?currency:\s*'USD'/);
  });
  it('결제창 진입(begin_checkout) 시점에 trackBeginCheckout 호출 — 깔때기 측정', () => {
    expect(src).toMatch(/trackBeginCheckout\(productType,\s*productType,\s*passengers,\s*Math\.round\(\(effectiveKRW/);
  });
});
