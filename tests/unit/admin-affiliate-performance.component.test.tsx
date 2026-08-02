// @vitest-environment jsdom
//
// 관리자 매출판 — 제휴 성과 카드 렌더 검증. (2026-08-02)
//
// 로그인 벽 때문에 눈으로 못 본다는 말이 안 되게, authFetch 를 mock 해서 화면을 실제로 그린다.
// 특히 확인하는 것: 조회 실패가 "제휴 성과 0" 처럼 보이면 운영자가 판단을 틀린다 —
// 실패는 실패로 보여야 한다.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const authFetchMock = vi.fn();
vi.mock('../../src/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetchMock(...a) }));

const { AffiliatePerformance } = await import('../../src/components/admin/AffiliatePerformance');

void React;

/** fetch 응답 흉내. */
function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const DATA = {
  days: 30,
  summary: { impressions: 120, clicks: 9, ctr: 7.5 },
  byProduct: [{ key: 'hotel', impressions: 80, clicks: 7, ctr: 8.75 }],
  byPlacement: [{ key: 'plan_pretrip', impressions: 80, clicks: 7, ctr: 8.75 }],
  byLanguage: [{ key: 'en', impressions: 100, clicks: 8, ctr: 8 }],
  generatedAt: '2026-08-02T00:00:00.000Z',
};

beforeEach(() => {
  cleanup();
  authFetchMock.mockReset();
});

describe('AffiliatePerformance', () => {
  it('노출·클릭·클릭률과 세 가지 분해표를 그린다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, { ok: true, data: DATA }));
    render(<AffiliatePerformance days={30} />);

    await waitFor(() => expect(screen.getByText('120')).toBeInTheDocument());
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('7.5%')).toBeInTheDocument();
    // 내부 키가 아니라 운영자가 읽는 이름으로 나와야 한다.
    expect(screen.getByText('호텔')).toBeInTheDocument();
    expect(screen.getByText('플랜 여행 준비')).toBeInTheDocument();
    expect(screen.getByText('영어')).toBeInTheDocument();
    expect(authFetchMock).toHaveBeenCalledWith('/api/admin-posthog-affiliate?days=30');
  });

  it('조회가 실패하면 0이 아니라 오류로 보여준다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(500, { ok: false, error: 'PostHog query 403 — 키 확인' }));
    render(<AffiliatePerformance days={30} />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PostHog query 403'));
    // 실패인데 "데이터 없음" 안내가 같이 뜨면 0건으로 오해한다.
    expect(screen.queryByText(/제휴 노출·클릭 데이터가 없습니다/)).toBeNull();
  });

  it('네트워크 자체가 끊겨도 화면이 죽지 않는다', async () => {
    authFetchMock.mockRejectedValue(new Error('Failed to fetch'));
    render(<AffiliatePerformance days={7} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch'));
  });

  it('기간에 데이터가 없으면 0 대신 없다고 말한다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, {
      ok: true,
      data: { ...DATA, summary: { impressions: 0, clicks: 0, ctr: 0 }, byProduct: [], byPlacement: [], byLanguage: [] },
    }));
    render(<AffiliatePerformance days={30} />);
    await waitFor(() => expect(screen.getByText(/제휴 노출·클릭 데이터가 없습니다/)).toBeInTheDocument());
  });
});
