// @vitest-environment jsdom
import React, { createContext, useContext, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiOpsCenter, { type OpsCenterData } from '@/pages/AdminAiOpsCenter';
import { adminAiOpsCopy } from '@/lib/adminAiOpsCopy';
import type { Language } from '@/i18n';

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

const languageChange = vi.hoisted(() => vi.fn());
const TestLanguageContext = createContext<{ language: Language; changeLanguage: (language: Language) => void }>({
  language: 'ko', changeLanguage: languageChange,
});

vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => useContext(TestLanguageContext) }));

function TestLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('ko');
  return <TestLanguageContext.Provider value={{
    language,
    changeLanguage: (next) => {
      languageChange(next);
      setLanguage(next);
    },
  }}>{children}</TestLanguageContext.Provider>;
}

vi.mock('@/components/OwnerControllerSetupPanel', () => ({
  OwnerControllerSetupPanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="owner-controller-setup-panel">{children}</div>,
}));

vi.mock('@/components/OwnerNotificationSetup', () => ({
  OwnerNotificationSetup: () => <div data-testid="owner-notification-setup" />,
}));

// The independent company-inbox request/auth/race behavior has its own component suite.
// This suite retains the original PII-free aggregate request's exact call-count assertions.
vi.mock('@/components/AdminExternalInbox', () => ({ AdminExternalInbox: () => <div data-testid="company-inbox" /> }));
// Each independent panel has its own real request/race suite; do not weaken the aggregate count contract.
vi.mock('@/components/AdminWebchatInbox', () => ({ AdminWebchatInbox: () => <div data-testid="webchat-inbox" /> }));
vi.mock('@/components/AdminOperationalChecks', () => ({ AdminOperationalChecks: () => <div data-testid="operational-checks" /> }));

const NOW = '2026-09-01T09:00:00+09:00';
const FOREGROUND_REFRESH_DEBOUNCE_MS = 900;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_START = Date.parse('2026-09-01T00:00:00+09:00');

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
      actionRequired: 0,
      urgent: 0,
      todayReservations: 0,
      upcoming7d: 0,
      openInquiries: 0,
      openCs: 0,
      paymentReviews: 0,
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

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="test-location">{location.pathname}{location.search}{location.hash}</output>
    <button type="button" onClick={() => navigate(-1)}>테스트 뒤로</button>
  </>;
}

function PageHarness(opts: { previewData?: OpsCenterData; initialEntries?: string[]; initialIndex?: number }) {
  return <TestLanguageProvider>
    <MemoryRouter initialEntries={opts.initialEntries || ['/admin/ai-center']} initialIndex={opts.initialIndex}>
      <Routes>
        <Route path="/admin/ai-center" element={<AdminAiOpsCenter previewData={opts.previewData} />} />
        <Route path="*" element={<div>가짜 원본 화면</div>} />
      </Routes>
      <NavigationProbe />
    </MemoryRouter>
  </TestLanguageProvider>;
}

function renderPage(opts: { previewData?: OpsCenterData; initialEntries?: string[]; initialIndex?: number }) {
  return render(<PageHarness {...opts} />);
}

function renderStrictPage(opts: { previewData?: OpsCenterData }) {
  return render(
    <React.StrictMode>
      <TestLanguageProvider>
        <MemoryRouter initialEntries={['/admin/ai-center']}>
          <AdminAiOpsCenter previewData={opts.previewData} />
        </MemoryRouter>
      </TestLanguageProvider>
    </React.StrictMode>,
  );
}

beforeEach(() => {
  cleanup();
  authUser.getIdToken.mockClear();
  languageChange.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('외부 호출 차단: 테스트 응답을 먼저 지정하세요.'); }));
});

describe('AdminAiOpsCenter 운영/미리보기 모드 로딩 동작', () => {
  it('미리보기 모드에서는 탭 포커스·가시성 이벤트에 fetch가 실행되지 않는다', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPage({ previewData: makeOpsData({ generatedAt: NOW }) });

    expect(screen.getByText('미리보기 모드')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(screen.queryByTestId('owner-notification-setup')).not.toBeInTheDocument();

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

  it('운영 자료 조회가 실패해도 기기 알림 설정을 사용할 수 있다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, error: 'test unavailable' }, { status: 503 })));
    renderPage({});
    expect(await screen.findByText('운영 자료를 불러오지 못했습니다')).toBeInTheDocument();
    expect(screen.getByTestId('owner-controller-setup-panel')).toBeInTheDocument();
    expect(screen.getByTestId('owner-notification-setup')).toBeInTheDocument();
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

    resolveSecond(jsonResponse({ ok: true, data: payload }));
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

describe('AdminAiOpsCenter 헤더 접근성', () => {
  it('새로고침은 작은 화면의 숨겨진 텍스트에 의존하지 않고 이름과 최소 터치 크기를 가진다', () => {
    renderPage({ previewData: makeOpsData() });
    const refreshButton = screen.getByRole('button', { name: '새로고침' });
    expect(refreshButton).toHaveAttribute('aria-label', '새로고침');
    expect(refreshButton).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    // jsdom은 미디어쿼리 실제 너비를 재지 않으므로 브라우저 390px 검증을 대신하지 않는다.
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
    resolveFetch(jsonResponse({ ok: true, data: makeOpsData({ generatedAt: NOW }) }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });
});

function makeWorkItems(count: number): OpsCenterData['workItems'] {
  return Array.from({ length: count }, (_, index) => ({
    workItemId: `synthetic-work-${index + 1}`, type: 'decision', sourceSystem: 'decision_queue',
    sourceRecordId: `synthetic-work-${index + 1}`, title: `가짜 확인 업무 ${index + 1}`,
    status: 'pending', priority: 'P1', nextAction: '내용 확인', actionRequired: true,
    ageHours: 0, eventDate: '', createdAtMs: DAY_START, deepLink: '/admin/decisions',
  }));
}

function makeReservation(offset: number, id = `day-${offset}`): OpsCenterData['reservations'][number] {
  const tripAtMs = DAY_START + offset * DAY_MS;
  return {
    workItemId: `synthetic-reservation-${id}`, sourceSystem: 'bookings', sourceLabel: '코코트립',
    sourceRecordId: id, bookingRef: id, customerIdentityVerified: false,
    tripAt: new Date(tripAtMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10), tripAtMs,
    reservationStatus: 'confirmed', paymentStatus: 'confirmed', dispatchStatus: 'accepted',
    replyStatus: 'not_applicable', priority: 'P3', nextAction: '상세 보기', actionRequired: false,
    updatedAtMs: DAY_START, createdAtMs: DAY_START, deepLink: '/admin/calendar',
    label: `가짜 예약 ${id}`, isTest: true,
  };
}

describe('AdminAiOpsCenter 성공 후 갱신 실패와 회복', () => {
  it.each(['button', 'foreground'] as const)('%s 갱신 실패는 이전 자료·마지막 성공 시각을 보존하되 오류를 표시하고 재시도할 수 있다', async (trigger) => {
    const initial = makeOpsData({ workItems: makeWorkItems(1) });
    const updated = makeOpsData({ generatedAt: '2026-09-01T10:00:00+09:00', workItems: makeWorkItems(2) });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: initial }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'SYNTHETIC_REFRESH_FAILURE' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: updated }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage({});
    expect(await screen.findByText('가짜 확인 업무 1')).toBeInTheDocument();

    if (trigger === 'button') fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    else fireEvent(window, new Event('focus'));

    const refreshAlert = await screen.findByRole('alert');
    expect(refreshAlert).toHaveTextContent('SYNTHETIC_REFRESH_FAILURE');
    expect(refreshAlert).toHaveTextContent('09:00');
    expect(screen.getByText('가짜 확인 업무 1')).toBeInTheDocument();
    const refreshStatus = screen.getByText('운영 연동 모드').closest('[role="status"]');
    expect(refreshStatus).toHaveTextContent('갱신 실패');
    expect(refreshStatus).not.toHaveTextContent('갱신 완료');
    expect(refreshStatus).toHaveTextContent('09:00');
    expect(refreshStatus).not.toHaveTextContent('10:00');
    expect(screen.getByRole('button', { name: '새로고침' })).not.toBeDisabled();

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
    expect(await screen.findByText('가짜 확인 업무 2')).toBeInTheDocument();
    expect(screen.queryByText('SYNTHETIC_REFRESH_FAILURE')).not.toBeInTheDocument();
    expect(refreshStatus).toHaveTextContent('갱신 완료');
    expect(refreshStatus).toHaveTextContent('10:00');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('AdminAiOpsCenter 누락 없는 목록 더보기', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW));
  });

  it('23개 긴급업무를 10개씩 펼쳐 마지막 3개까지 읽을 수 있다', () => {
    renderPage({ previewData: makeOpsData({ workItems: makeWorkItems(23) }) });
    const queue = screen.getByRole('region', { name: '지금 해야 할 일' });
    expect(within(queue).getAllByRole('link')).toHaveLength(10);
    expect(within(queue).queryByText('가짜 확인 업무 11')).not.toBeInTheDocument();

    fireEvent.click(within(queue).getByRole('button', { name: '10건 더 보기' }));
    expect(within(queue).getAllByRole('link')).toHaveLength(20);
    expect(within(queue).getByText('가짜 확인 업무 11')).toBeInTheDocument();
    const lastWorkButton = within(queue).getByRole('button', { name: '3건 더 보기' });
    lastWorkButton.focus();
    fireEvent.click(lastWorkButton);
    expect(within(queue).getAllByRole('link')).toHaveLength(23);
    expect(within(queue).getByText('가짜 확인 업무 23')).toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: '전체 표시 중' })).toBeDisabled();
    expect(document.activeElement).toBe(lastWorkButton);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('65개 예약을 30개씩 펼쳐 마지막 5개와 원본 링크까지 표시한다', () => {
    const reservations = Array.from({ length: 65 }, (_, index) => makeReservation(0, `item-${index + 1}`));
    renderPage({ previewData: makeOpsData({ reservations }) });
    const panel = screen.getByRole('region', { name: '통합 예약 흐름' });
    expect(within(panel).getAllByRole('link')).toHaveLength(30);
    fireEvent.click(within(panel).getByRole('button', { name: '예약 30건 더 보기' }));
    expect(within(panel).getAllByRole('link')).toHaveLength(60);
    const lastReservationButton = within(panel).getByRole('button', { name: '예약 5건 더 보기' });
    lastReservationButton.focus();
    fireEvent.click(lastReservationButton);
    expect(within(panel).getAllByRole('link')).toHaveLength(65);
    expect(within(panel).getByRole('link', { name: /가짜 예약 item-65/ })).toHaveAttribute('href', '/admin/calendar');
    expect(within(panel).queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '전체 표시 중' })).toBeDisabled();
    expect(document.activeElement).toBe(lastReservationButton);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('예약 행은 고정 폭 4열 대신 이름·날짜 두 칸과 상태 다음 줄 구조를 유지한다', () => {
    renderPage({ previewData: makeOpsData({ reservations: [makeReservation(0, 'layout')] }) });
    const panel = screen.getByRole('region', { name: '통합 예약 흐름' });
    const row = within(panel).getByRole('link', { name: /가짜 예약 layout/ });
    expect(row).toHaveClass('grid-cols-[minmax(0,1fr)_auto]');
    expect(row.className).not.toMatch(/minmax\((?:120|160)px/);
    const statusRow = within(row).getByText('확정').parentElement;
    expect(statusRow).toHaveClass('col-span-2');
    expect(statusRow).not.toHaveClass('sm:col-span-1');
    // 구조 회귀만 보호한다. 실제 1024px 겹침 여부는 브라우저 실측으로 따로 확인한다.
  });

  it('빈 목록에는 가짜 행이나 더보기 버튼을 만들지 않는다', () => {
    renderPage({ previewData: makeOpsData() });
    const queue = screen.getByRole('region', { name: '지금 해야 할 일' });
    const panel = screen.getByRole('region', { name: '통합 예약 흐름' });
    expect(within(queue).getByText('지금 급한 업무가 없습니다')).toBeInTheDocument();
    expect(within(panel).getByText('선택한 기간에 표시할 예약이 없습니다.')).toBeInTheDocument();
    for (const section of [queue, panel]) {
      expect(within(section).queryByRole('link')).not.toBeInTheDocument();
      expect(within(section).queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument();
    }
  });
});

describe('AdminAiOpsCenter 기간 경계와 복귀', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW));
  });

  it('오늘은 한국 자정부터 다음 자정 직전까지이고 오늘 + 7일은 기존 8일 범위를 보존한다', () => {
    const reservations = [makeReservation(-1), makeReservation(0), makeReservation(1), makeReservation(7), makeReservation(8)];
    renderPage({ previewData: makeOpsData({ reservations }) });
    const panel = screen.getByRole('region', { name: '통합 예약 흐름' });
    expect(within(panel).getByRole('button', { name: '오늘 + 7일' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getAllByRole('link')).toHaveLength(3);
    expect(within(panel).getByText('가짜 예약 day-7')).toBeInTheDocument();
    expect(within(panel).queryByText('가짜 예약 day-8')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '오늘' }));
    expect(within(panel).getAllByRole('link')).toHaveLength(1);
    expect(within(panel).getByText('가짜 예약 day-0')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: '최근 전체' }));
    expect(within(panel).getAllByRole('link')).toHaveLength(5);
    expect(within(panel).getByText('가짜 예약 day--1')).toBeInTheDocument();
  });

  it.each(['today', 'week', 'all'] as const)('URL period=%s를 초기 기간으로 읽는다', (period) => {
    const names = { today: '오늘', week: '오늘 + 7일', all: '최근 전체' };
    renderPage({ previewData: makeOpsData(), initialEntries: [`/admin/ai-center?period=${period}`] });
    expect(screen.getByRole('button', { name: names[period] })).toHaveAttribute('aria-pressed', 'true');
  });

  it('알 수 없는 기간은 안전하게 기본 범위를 표시한다', () => {
    renderPage({ previewData: makeOpsData(), initialEntries: ['/admin/ai-center?period=unknown'] });
    expect(screen.getByRole('button', { name: '오늘 + 7일' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('기간 변경은 다른 쿼리·해시를 보존하며 원본 화면에서 뒤로 오면 같은 기간이 복원된다', () => {
    renderPage({
      previewData: makeOpsData({ reservations: [makeReservation(-1)] }),
      initialEntries: ['/admin', '/admin/ai-center?work-list=long&reservations=long#ops-reservation'],
      initialIndex: 1,
    });
    fireEvent.click(screen.getByRole('button', { name: '최근 전체' }));
    const locationText = screen.getByTestId('test-location').textContent || '';
    const location = new URL(locationText, 'https://example.invalid');
    expect(location.searchParams.get('period')).toBe('all');
    expect(location.searchParams.get('work-list')).toBe('long');
    expect(location.searchParams.get('reservations')).toBe('long');
    expect(location.hash).toBe('#ops-reservation');

    fireEvent.click(screen.getByRole('link', { name: /가짜 예약 day--1/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/admin/calendar');
    fireEvent.click(screen.getByRole('button', { name: '테스트 뒤로' }));
    expect(screen.getByRole('button', { name: '최근 전체' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: /가짜 예약 day--1/ })).toBeInTheDocument();

    // 기간 선택 자체가 방문 기록을 늘리지 않아 한 번 더 뒤로 가면 원래 관리자 화면이다.
    fireEvent.click(screen.getByRole('button', { name: '테스트 뒤로' }));
    expect(screen.getByTestId('test-location').textContent).toBe('/admin');
  });
});

describe('AdminAiOpsCenter 운영 우선 배치와 부분 실패', () => {
  it('긴급업무·예약·문의가 시스템 상태와 설치 설정보다 먼저 나온다', () => {
    renderPage({ previewData: makeOpsData() });
    const ordered = ['ops-summary', 'ops-queue', 'ops-reservation', 'ops-inbox', 'ops-automation', 'ops-source']
      .map((id) => document.getElementById(id));
    for (let index = 0; index < ordered.length - 1; index += 1) {
      expect(ordered[index]).not.toBeNull();
      expect(ordered[index + 1]).not.toBeNull();
      expect(ordered[index]!.compareDocumentPosition(ordered[index + 1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    const setup = screen.getByTestId('owner-controller-setup-panel');
    expect(ordered[2]!.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(setup.closest('details')).not.toHaveAttribute('open');
  });

  it('원본 하나의 실패를 빈 전체 자료로 숨기지 않고 성공한 예약과 경고를 함께 표시한다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW));
    renderPage({ previewData: makeOpsData({
      reservations: [makeReservation(0)], partialErrors: ['pending_email_retries'],
      sources: [{ key: 'pending_email_retries', label: '고객 이메일 재시도', ok: false, count: 0, possiblyTruncated: false }],
    }) });
    expect(screen.getByRole('alert')).toHaveTextContent('일부 자료를 확인하지 못했습니다.');
    expect(screen.getByText('가짜 예약 day-0')).toBeInTheDocument();
    expect(document.getElementById('ops-source')).toHaveTextContent('1곳 확인 실패');
  });
});

describe('AdminAiOpsCenter 화면 언어와 미리보기 자료 교체', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s 발신 재시도 업무 제목만 구분하고 서버 수량·다음 행동·링크를 보존한다', async (language) => {
    const emailWork: OpsCenterData['workItems'][number] = {
      ...makeWorkItems(1)[0], workItemId: 'automation:email_retry', type: 'automation',
      sourceSystem: 'email_retry', sourceRecordId: 'email_retry', title: '고객 이메일 · 2건',
      status: 'attention', priority: 'P0', nextAction: '수동 처리 필요', deepLink: '/admin/reconciliation',
    };
    const unrelatedWork = {
      ...emailWork, workItemId: 'automation:processor_retry',
      sourceSystem: 'processor_retry', sourceRecordId: 'processor_retry',
    };
    const data = makeOpsData({ workItems: [emailWork, unrelatedWork] });
    const original = JSON.stringify(data);
    renderPage({ previewData: data });
    fireEvent.click(screen.getByText('앱 설치 및 설정'));
    fireEvent.change(screen.getByRole('combobox', { name: '화면 언어' }), { target: { value: language } });

    const copy = adminAiOpsCopy[language];
    const queue = screen.getByRole('region', { name: copy.workTitle });
    const emailLink = within(queue).getByText(`${copy.outboundEmailRetry} · 2건`).closest('a');
    expect(emailLink).toHaveAttribute('href', emailWork.deepLink);
    expect(emailLink).toHaveTextContent(emailWork.nextAction);
    expect(emailLink).toHaveTextContent(copy.priorityLabels.P0);
    const unrelatedLink = within(queue).getByText(unrelatedWork.title).closest('a');
    expect(unrelatedLink).toHaveAttribute('href', unrelatedWork.deepLink);
    expect(unrelatedLink).not.toHaveTextContent(copy.outboundEmailRetry);
    expect(within(queue).getAllByRole('link')).toHaveLength(2);
    expect(JSON.stringify(data)).toBe(original);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(fetch).not.toHaveBeenCalled();
    expect(authUser.getIdToken).not.toHaveBeenCalled();
  });

  it.each([
    { workItemId: 'automation:other' },
    { type: 'inquiry' },
    { sourceSystem: 'other' },
    { sourceRecordId: 'other' },
    { title: '고객 이메일 · 원본 형식 변경' },
    { title: '다른 원본 이름 · 2건' },
  ])('발신 재시도 식별값이나 제목 형식이 다르면 원문을 보존한다: %j', (override) => {
    const item: OpsCenterData['workItems'][number] = {
      ...makeWorkItems(1)[0], workItemId: 'automation:email_retry', type: 'automation',
      sourceSystem: 'email_retry', sourceRecordId: 'email_retry', title: '고객 이메일 · 2건',
      ...override,
    };
    renderPage({ previewData: makeOpsData({ workItems: [item] }) });
    const queue = screen.getByRole('region', { name: adminAiOpsCopy.ko.workTitle });
    expect(within(queue).getByText(item.title)).toBeInTheDocument();
    expect(queue).not.toHaveTextContent(adminAiOpsCopy.ko.outboundEmailRetry);
  });

  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s 이메일 재시도만 발신으로 구분하고 원본 내용·상태·링크를 보존한다', async (language) => {
    const emailRetry = {
      key: 'email_retry', label: '고객 이메일', status: 'retrying' as const,
      pending: 2, manual: 1, count: 3, detail: '가짜 발신 재시도 원문 2건 · 수동 확인 1건',
      deepLink: '/admin/ops?tab=review',
    };
    const unrelated = {
      key: 'unrelated_email', label: '고객 이메일', status: 'unlinked' as const,
      pending: 0, manual: 0, count: 0, detail: '가짜 다른 항목의 원문',
      deepLink: '/admin/claims',
    };
    const data = makeOpsData({ automation: [emailRetry, unrelated] });
    const original = JSON.stringify(data);
    renderPage({ previewData: data });
    fireEvent.click(screen.getByText('앱 설치 및 설정'));
    fireEvent.change(screen.getByRole('combobox', { name: '화면 언어' }), { target: { value: language } });

    const copy = adminAiOpsCopy[language];
    const automation = screen.getByRole('region', { name: copy.automationTitle });
    const emailLink = within(automation).getByText(copy.outboundEmailRetry).closest('a');
    expect(emailLink).toHaveAttribute('href', emailRetry.deepLink);
    expect(emailLink).toHaveTextContent(emailRetry.detail);
    expect(emailLink).toHaveTextContent(copy.automationLabels.retrying);
    expect(emailLink).not.toHaveTextContent('고객 이메일');

    const unrelatedLink = within(automation).getByText(unrelated.label).closest('a');
    expect(unrelatedLink).toHaveAttribute('href', unrelated.deepLink);
    expect(unrelatedLink).toHaveTextContent(unrelated.detail);
    expect(unrelatedLink).toHaveTextContent(copy.automationLabels.unlinked);
    expect(unrelatedLink).not.toHaveTextContent(copy.outboundEmailRetry);
    expect(JSON.stringify(data)).toBe(original);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(fetch).not.toHaveBeenCalled();
    expect(authUser.getIdToken).not.toHaveBeenCalled();
  });

  it.each([
    { language: 'en', title: 'AI Operations Center', refresh: 'Refresh', workTitle: 'Tasks to handle now', languageLabel: 'Screen language' },
    { language: 'ja', title: 'AI運営センター', refresh: '再読み込み', workTitle: '今すぐ対応する業務', languageLabel: '表示言語' },
    { language: 'zh', title: 'AI运营中心', refresh: '刷新', workTitle: '现在需要处理的事项', languageLabel: '界面语言' },
  ] as const)('설정에서 $language 선택 시 같은 화면의 제목·버튼·업무 영역이 바뀐다', async ({ language, title, refresh, workTitle, languageLabel }) => {
    renderPage({ previewData: makeOpsData() });
    expect(screen.getByRole('heading', { name: 'AI 운영센터' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('앱 설치 및 설정'));
    const select = screen.getByRole('combobox', { name: '화면 언어' });
    expect(within(select).getAllByRole('option')).toHaveLength(4);
    fireEvent.change(select, { target: { value: language } });

    expect(languageChange).toHaveBeenCalledExactlyOnceWith(language);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI 운영센터' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: refresh })).toHaveAttribute('aria-label', refresh);
    expect(screen.getByRole('region', { name: workTitle })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: languageLabel })).toBe(select);
    expect(select).toHaveValue(language);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(fetch).not.toHaveBeenCalled();
    expect(authUser.getIdToken).not.toHaveBeenCalled();
  });

  it('같은 마운트에서 previewData를 교체하면 새 목록·기준 시각을 즉시 표시하고 외부 호출하지 않는다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW));
    const original = makeOpsData({
      workItems: [{ ...makeWorkItems(1)[0], title: '교체 전 가짜 업무' }],
      reservations: [makeReservation(0, 'original')],
    });
    const updated = makeOpsData({
      generatedAt: '2026-09-01T10:30:00+09:00',
      workItems: [{ ...makeWorkItems(1)[0], workItemId: 'replacement', title: '교체 후 가짜 업무' }],
      reservations: [makeReservation(0, 'replacement')],
    });
    const view = renderPage({ previewData: original });
    const status = screen.getByText('미리보기 모드').closest('[role="status"]');
    expect(status).toHaveTextContent('09:00');
    expect(screen.getByText('교체 전 가짜 업무')).toBeInTheDocument();
    expect(screen.getByText('가짜 예약 original')).toBeInTheDocument();

    view.rerender(<PageHarness previewData={updated} />);
    expect(screen.queryByText('교체 전 가짜 업무')).not.toBeInTheDocument();
    expect(screen.queryByText('가짜 예약 original')).not.toBeInTheDocument();
    expect(screen.getByText('교체 후 가짜 업무')).toBeInTheDocument();
    expect(screen.getByText('가짜 예약 replacement')).toBeInTheDocument();
    expect(screen.getByText('미리보기 모드').closest('[role="status"]')).toBe(status);
    expect(status).toHaveTextContent('10:30');
    expect(status).not.toHaveTextContent('09:00');
    fireEvent(window, new Event('focus'));
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(fetch).not.toHaveBeenCalled();
    expect(authUser.getIdToken).not.toHaveBeenCalled();
  });
});
