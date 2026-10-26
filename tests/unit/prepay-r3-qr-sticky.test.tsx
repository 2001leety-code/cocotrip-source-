// @vitest-environment jsdom
/**
 * 2026-10-26 B6-1 r3 (C) — Astra r2 재현: QR 검사 통과 → 외부 송금 → 사이트 언어 변경(입력 바뀜) → 재검사 실패·통신 실패.
 *   QR 을 한 번 보여 준 뒤에는 신고 경로가 남고 '결제 안 됨' 으로 단정하지 않는다. 실호출 0 (fetch mock).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));

import { PayPalQrPanel } from '../../src/components/PayPalQrPanel';

const input = (language: string) => ({ regions: ['Seoul'], dietaryRestrictions: ['Halal'], startDate: '2099-12-01', durationDays: 3, planner_intent_v1: { language } });
const props = { productType: 'ai-planner-full', passengers: 1, priceKRW: 14000 };

beforeEach(() => {
  cleanup();
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-user');
});

describe('QR panel keeps the report path once the QR was shown', () => {
  it('check passes → QR + report shown; a later input change whose re-check would fail (or network error) does not revoke it', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { checked: true } }) }));
    global.fetch = fetchSpy as never;
    const { rerender } = render(<PayPalQrPanel {...props} plannerInput={input('en')} />);
    expect(await screen.findByText('Report payment complete')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 송금 뒤 언어 변경 → 입력이 바뀐다. 재검사가 돈다면 실패(422)·통신 실패를 돌려준다.
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as never;
    rerender(<PayPalQrPanel {...props} plannerInput={input('ja')} />);
    await waitFor(() => expect(screen.getByText('Report payment complete')).toBeInTheDocument());
    expect(screen.queryByText(/You have not been charged/)).toBeNull();
  });

  it('a check that fails BEFORE any QR was shown still shows no QR / link (no remittance guidance)', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, code: 'DIETARY_COVERAGE_UNAVAILABLE' }) })) as never;
    render(<PayPalQrPanel {...props} plannerInput={input('en')} />);
    expect(await screen.findByText(/You have not been charged/)).toBeInTheDocument();
    expect(screen.queryByText('Report payment complete')).toBeNull();
  });
});
