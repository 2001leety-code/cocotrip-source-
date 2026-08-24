// @vitest-environment jsdom
//
// 관리자 전환 퍼널 카드 — 순서형 동일인 5단계 렌더 검증 (2026-08-24).
//
// 서버가 이미 검증한 steps 를 그대로 그리는지(하드코딩 라벨/개수 없음), generatedAt/window*/
// latestEventAt 을 정확히 보여주는지, 503(미설정)·500(조회 실패)·불변식 위반(malformed/
// nonmonotonic)을 서로 다른 상태로 구분하는지 확인한다. "실시간" 표현이 없는지도 잠근다.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const authFetchMock = vi.fn();
vi.mock('../../src/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetchMock(...a) }));

const { default: ConversionFunnel } = await import('../../src/components/admin/ConversionFunnel');

void React;

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const VALID_DATA = {
  semanticsVersion: 'ordered-same-person-v1',
  generatedAt: '2026-08-24T12:00:00.000Z',
  windowStart: '2026-07-25T12:00:00.000Z',
  windowEnd: '2026-08-24T12:00:00.000Z',
  latestEventAt: '2026-08-24T11:30:00.000Z',
  days: 30,
  steps: [
    { id: 'wizard_seen', label: '위저드 노출', count: 100 },
    { id: 'preview_success', label: '미리보기 생성 성공', count: 80 },
    { id: 'payment_started', label: '결제 시작 (AI 플래너)', count: 20 },
    { id: 'payment_completed', label: '결제 완료 (AI 플래너)', count: 18 },
    { id: 'planner_complete', label: '플랜 생성 완료', count: 15 },
  ],
};

beforeEach(() => {
  cleanup();
  authFetchMock.mockReset();
});

describe('ConversionFunnel — 정상 데이터', () => {
  it('서버가 준 단계 라벨·개수를 그대로 그린다 (하드코딩 아님)', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, { ok: true, data: VALID_DATA }));
    render(<ConversionFunnel />);

    await waitFor(() => expect(screen.getByText('위저드 노출')).toBeInTheDocument());
    expect(screen.getByText('미리보기 생성 성공')).toBeInTheDocument();
    expect(screen.getByText('결제 시작 (AI 플래너)')).toBeInTheDocument();
    expect(screen.getByText('결제 완료 (AI 플래너)')).toBeInTheDocument();
    expect(screen.getByText('플랜 생성 완료')).toBeInTheDocument();
    expect(screen.getByText('100건')).toBeInTheDocument();
    expect(screen.getByText('15건')).toBeInTheDocument();
    expect(authFetchMock).toHaveBeenCalledWith('/api/admin-posthog-funnel?days=30');
  });

  it('generatedAt/window/최근 이벤트 시각을 표시한다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, { ok: true, data: VALID_DATA }));
    render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByText(/조회 시각/)).toBeInTheDocument());
    expect(screen.getByText(/기간:/)).toBeInTheDocument();
    expect(screen.getByText(/최근 이벤트:/)).toBeInTheDocument();
    expect(screen.getByText(/ordered-same-person-v1/)).toBeInTheDocument();
  });

  it('🔴 "실시간" 표현을 쓰지 않는다', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, { ok: true, data: VALID_DATA }));
    const { container } = render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByText('위저드 노출')).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/실시간/);
  });

  it('latestEventAt 이 없으면 "기간 내 이벤트 없음" 안내로 대체한다 (없는 임계값 발명 안 함)', async () => {
    authFetchMock.mockResolvedValue(jsonRes(200, { ok: true, data: { ...VALID_DATA, latestEventAt: null } }));
    render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByText(/선택한 기간 내 이벤트 없음/)).toBeInTheDocument());
  });
});

describe('ConversionFunnel — 503 미설정과 500 조회 실패를 구분한다', () => {
  it('503 → PostHog 미연결 안내(오류 아님, status)', async () => {
    authFetchMock.mockResolvedValue(jsonRes(503, { ok: false, error: 'PostHog not configured', code: 'POSTHOG_DISABLED' }));
    render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByText(/PostHog 미연결/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('500 POSTHOG_QUERY_FAILED → 조회 실패 alert', async () => {
    authFetchMock.mockResolvedValue(jsonRes(500, { ok: false, error: 'PostHog query 403', code: 'POSTHOG_QUERY_FAILED' }));
    render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PostHog 조회 실패'));
  });

  it('500 FUNNEL_INVALID_NONMONOTONIC → 조회 실패와 다른 "검증 실패" alert', async () => {
    authFetchMock.mockResolvedValue(jsonRes(500, { ok: false, error: 'downstream exceeded upstream', code: 'FUNNEL_INVALID_NONMONOTONIC' }));
    render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('순서·단조성 검증에 실패'));
  });

  it('500 FUNNEL_MALFORMED_RESULT → 검증 실패 alert (조회 실패 문구 아님)', async () => {
    authFetchMock.mockResolvedValue(jsonRes(500, { ok: false, error: 'malformed', code: 'FUNNEL_MALFORMED_RESULT' }));
    render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('순서·단조성 검증에 실패'));
    expect(screen.queryByText(/PostHog 조회 실패/)).toBeNull();
  });

  it('네트워크 자체가 끊겨도 화면이 죽지 않는다', async () => {
    authFetchMock.mockRejectedValue(new Error('Failed to fetch'));
    render(<ConversionFunnel />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch'));
  });
});
