// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiOpsCenter, { type OpsCenterData } from '@/pages/AdminAiOpsCenter';

void React;

const authUser = vi.hoisted(() => ({
  uid: 'operator',
  token: 'server-token',
  getIdToken: vi.fn(function getIdToken(this: { token: string }) {
    if (this.token !== 'server-token') throw new Error('Firebase User receiver가 보존되지 않았습니다.');
    return Promise.resolve(this.token);
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser, loading: false }),
}));

vi.mock('@/hooks/usePageMeta', () => ({
  usePageMeta: () => undefined,
}));

vi.mock('@/components/OwnerControllerSetupPanel', () => ({
  OwnerControllerSetupPanel: () => <div data-testid="owner-controller-setup-panel" />,
}));

const NOW = '2026-09-01T09:00:00+09:00';
const FOREGROUND_REFRESH_DEBOUNCE_MS = 900;

function jsonResponse(payload: unknown, init: Omit<ResponseInit, 'body'> = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeOpsData(overrides: Partial<OpsCenterData> = {}): OpsCenterData {
  return {
    generatedAt: NOW,
    summary: {
      actionRequired: 1,
      urgent: 1,
      todayReservations: 2,
      upcoming7d: 4,
      openInquiries: 1,
      openCs: 0,
      paymentReviews: 1,
      automationAttention: 0,
      ...overrides.summary,
    },
    workItems: [],
    reservations: [],
    inboxItems: [],
    automation: [],
    sources: [
      { key: 'bookings', label: '온라인', ok: true, count: 0, possiblyTruncated: false },
    ],
    partialErrors: [],
    deduplication: { rule: 'stable-default', removedMirrorCount: 0 },
    window: { perSourceLimit: 180, note: 'integration test window' },
    ...overrides,
  };
}

function renderPage(opts: { previewData?: OpsCenterData }) {
  return render(
    <MemoryRouter initialEntries={['/admin/ai-center']}>
      <AdminAiOpsCenter previewData={opts.previewData} />
    </MemoryRouter>,
  );
}

function renderStrictPage(opts: { previewData?: OpsCenterData }) {
  return render(
    <React.StrictMode>
      <MemoryRouter initialEntries={['/admin/ai-center']}>
        <AdminAiOpsCenter previewData={opts.previewData} />
      </MemoryRouter>
    </React.StrictMode>,
  );
}

beforeEach(() => {
  cleanup();
  authUser.getIdToken.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AdminAiOpsCenter 운영/미리보기 모드 로딩 동작', () => {
  it('미리보기 모드에서는 탭 포커스·가시성 이벤트에 fetch가 실행되지 않는다', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPage({ previewData: makeOpsData({ generatedAt: NOW }) });

    expect(screen.getByText('미리보기 모드')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(0);

    fireEvent(window, new Event('focus'));
    fireEvent(document, new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('운영 모드 초기 진입 시 Firebase User receiver를 보존해 토큰을 받고 1회 fetch한다', async () => {
    const payload = makeOpsData({ generatedAt: NOW });
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: payload }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage({});

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(authUser.getIdToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin-ai-ops-center?limit=180',
      { headers: { Authorization: 'Bearer server-token' } },
    );
    expect(await screen.findByText(/갱신 완료/)).toBeInTheDocument();
  });
});

describe('AdminAiOpsCenter 포그라운드 갱신 가드', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('포커스·가시성 복귀 이벤트는 900ms 디바운스로 중복 호출을 줄인다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: makeOpsData({ generatedAt: NOW }) }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage({});
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    await act(async () => {
      fireEvent(window, new Event('focus'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent(window, new Event('focus'));
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(FOREGROUND_REFRESH_DEBOUNCE_MS + 20);
      await Promise.resolve();
      fireEvent(window, new Event('focus'));
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('갱신 요청이 진행 중이면 추가 포커스 이벤트는 중복 호출을 만들지 않는다', async () => {
    const payload = makeOpsData({ generatedAt: NOW });
    let resolveSecond: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: payload }))
      .mockImplementationOnce(async () => pending);
    vi.stubGlobal('fetch', fetchMock);

    renderPage({});
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    await act(async () => {
      fireEvent(window, new Event('focus'));
    });
    await act(async () => {
      vi.advanceTimersByTime(FOREGROUND_REFRESH_DEBOUNCE_MS + 20);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent(window, new Event('focus'));
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveSecond(jsonResponse(payload));
    await act(async () => {
      await pending;
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('StrictMode에서 cleanup 직후 다시 렌더링되어도 isMountedRef가 false로 머물지 않는다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data: makeOpsData({ generatedAt: NOW }) }));
    vi.stubGlobal('fetch', fetchMock);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderStrictPage({});
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/갱신 완료/)).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('AdminAiOpsCenter 헤더 레이아웃', () => {
  it('390px 기준에서 헤더 행은 가로 overflow가 나지 않도록 flex wrap 구조를 유지한다', () => {
    const headerData = makeOpsData();
    const payload = {
      ...headerData,
      generatedAt: NOW,
      summary: {
        ...headerData.summary,
        actionRequired: 2,
        urgent: 2,
        todayReservations: 3,
        upcoming7d: 8,
        openInquiries: 2,
        paymentReviews: 1,
      },
    };

    renderPage({ previewData: payload });

    const banner = screen.getByRole('banner');
    const headerRow = banner.firstElementChild as HTMLElement | null;
    const refreshButton = screen.getByRole('button', { name: '새로고침' });
    const controls = refreshButton.parentElement as HTMLElement | null;

    expect(headerRow).toBeTruthy();
    expect(controls).toBeTruthy();
    expect(headerRow).toHaveClass('flex-wrap');
    expect(controls).toHaveClass('flex-wrap');
    expect(controls).toHaveClass('justify-end');
  });
});

describe('AdminAiOpsCenter 언마운트 안전성', () => {
  it('언마운트 후 응답이 와도 콘솔 경고가 기록되지 않는다', async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(async () => await pending);
    vi.stubGlobal('fetch', fetchMock);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { unmount } = renderPage({});

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();
    resolveFetch(jsonResponse(makeOpsData({ generatedAt: NOW })));

    await act(async () => {
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });
});
