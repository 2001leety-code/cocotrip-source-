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

describe('trackPaidConversion — GA4 purchase 전환 발화', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('GA_ID 설정 + gtag 존재 → purchase 를 value/currency/transaction_id/items 로 발화', async () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
    const gtag = vi.fn();
    vi.stubGlobal('window', { gtag });
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
    vi.stubGlobal('window', { gtag });
    const { trackPaidConversion } = await import('../../src/lib/analytics');
    trackPaidConversion({ transactionId: 'X', productType: 'planner', value: 1, currency: 'KRW' });
    expect(gtag).not.toHaveBeenCalled();
  });
});

describe('PayPalBookingButton — GA4 전환 배선 가드 (dead-code 회귀 방지)', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'PayPalBookingButton.tsx'), 'utf8');
  it('analytics trackPaidConversion 을 import', () => {
    expect(src).toMatch(/import\s*\{\s*trackPaidConversion\s*\}\s*from\s*'@\/lib\/analytics'/);
  });
  it('결제 성공 경로에서 orderID + priceKRW 로 호출', () => {
    expect(src).toMatch(/trackPaidConversion\(\{[\s\S]*?transactionId:\s*data\.orderID[\s\S]*?value:\s*priceKRW/);
  });
});
