// @vitest-environment jsdom
//
// /admin/payment-reviews 화면 렌더 검증 (미사용 감사 2026-07-26).
//
// 왜 이 테스트가 필요한가: 이 화면은 **돈이 묶인 주문**을 다루는 유일한 제품 표면이다.
// 특히 "불러오기 실패" 가 "격리된 결제 없음 ✅" 로 보이면 운영자가 묶인 돈을 없다고 착각한다 —
// 그 위장이 안 생기는지를 회귀로 못박는다.
//
// ⚠️ authFetch·Header·useLanguage 를 mock 하는 이유: 이들이 `@/lib/firebase` 를 끌어와
//    CI(FIREBASE_* env 없음)에서 수집 단계가 통째로 죽는다("CI 수집 사망" 함정, PR #1172 선례).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

void React;

const authFetchMock = vi.fn();

vi.mock('../../src/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetchMock(...a) }));
vi.mock('../../src/sections/Header', () => ({ Header: () => null }));
vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: {}, changeLanguage: () => {} }),
}));

const { default: AdminPaymentReviews } = await import('../../src/pages/AdminPaymentReviews');

const ITEM = {
  orderID: 'TEST-ORDER-1',
  flow: 'single',
  mismatchCode: 'AMOUNT_MISMATCH',
  mismatchDetail: 'expected 99.00 got 1.00',
  expectedAmountMinor: 9900,
  expectedCurrency: 'USD',
  actualAmountMinor: 100,
  actualCurrency: 'USD',
  paymentCaptured: true,
  captureID: 'TESTCAP1',
  captureStatus: 'COMPLETED',
  userEmail: 'test@example.com',
  createdAtMs: 1753400000000,
};

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminPaymentReviews />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // 이 레포는 vitest globals 를 안 켜서 testing-library 자동 cleanup 이 안 돈다 →
  // 명시 정리하지 않으면 앞 테스트의 DOM 이 남아 "버튼이 2개" 로 잡힌다.
  cleanup();
  authFetchMock.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('AdminPaymentReviews — 격리 목록 렌더', () => {
  it('격리 건이 있으면 주문번호·기대금액·실제금액을 보여준다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, { items: [ITEM], count: 1, truncated: false }));
    renderPage();

    await waitFor(() => expect(screen.getByText('TEST-ORDER-1')).toBeInTheDocument());
    // 금액은 minor unit(센트) → 통화 표기로 환산돼야 한다. 9900 이 그대로 뜨면 100배 오표시.
    expect(screen.getByText(/\$99\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.00/)).toBeInTheDocument();
    expect(screen.getByText(/AMOUNT_MISMATCH/)).toBeInTheDocument();
    expect(screen.getByText(/돈 빠져나감/)).toBeInTheDocument();
  });

  it('한계 고지를 항상 화면에 띄운다 — 확정해도 예약은 자동 생성되지 않는다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, { items: [], count: 0, truncated: false }));
    renderPage();

    await waitFor(() => expect(screen.getByText(/격리된 결제 없음/)).toBeInTheDocument());
    expect(screen.getByText(/예약 문서는 자동 생성되지 않습니다/)).toBeInTheDocument();
  });

  it('🔴 불러오기 실패를 "격리된 결제 없음" 으로 위장하지 않는다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(500, { error: 'Internal error' }));
    renderPage();

    await waitFor(() => expect(screen.getByText(/Internal error/)).toBeInTheDocument());
    expect(screen.queryByText(/격리된 결제 없음/)).toBeNull();
  });

  it('네트워크 자체가 죽어도 빈 목록으로 위장하지 않는다', async () => {
    authFetchMock.mockRejectedValue(new Error('network down'));
    renderPage();

    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    expect(screen.queryByText(/격리된 결제 없음/)).toBeNull();
  });
});

describe('AdminPaymentReviews — 해결 기록', () => {
  it('정상 확정 클릭 → 서버 화이트리스트 값 MANUALLY_CONFIRMED 로 POST 한다', async () => {
    authFetchMock.mockResolvedValueOnce(jsonRes(200, { items: [ITEM], count: 1, truncated: false }));
    renderPage();
    await waitFor(() => expect(screen.getByText('TEST-ORDER-1')).toBeInTheDocument());

    authFetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true, orderID: ITEM.orderID, resolution: 'MANUALLY_CONFIRMED' }));
    // 안내 배너에도 같은 문구가 <b> 로 들어있다 — role 로 버튼만 집는다.
    fireEvent.click(screen.getByRole('button', { name: /정상 확정/ }));

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = authFetchMock.mock.calls[1];
    expect(url).toBe('/api/admin-payment-reviews');
    expect(init.method).toBe('POST');
    // 서버(PAYMENT_REVIEW_RESOLUTION)와 리터럴이 어긋나면 400 INVALID_RESOLUTION 이 난다.
    expect(JSON.parse(init.body)).toMatchObject({ orderID: 'TEST-ORDER-1', resolution: 'MANUALLY_CONFIRMED' });
    // 처리한 건은 목록에서 사라진다.
    await waitFor(() => expect(screen.queryByText('TEST-ORDER-1')).toBeNull());
  });

  it('확인 창에서 취소하면 아무것도 보내지 않는다 — 돈 경로 오클릭 방지', async () => {
    authFetchMock.mockResolvedValueOnce(jsonRes(200, { items: [ITEM], count: 1, truncated: false }));
    renderPage();
    await waitFor(() => expect(screen.getByText('TEST-ORDER-1')).toBeInTheDocument());

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /환불 기록/ }));

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('TEST-ORDER-1')).toBeInTheDocument();
  });
});
