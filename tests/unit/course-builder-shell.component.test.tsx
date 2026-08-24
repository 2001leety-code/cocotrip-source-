// @vitest-environment jsdom
/**
 * CourseBuilderShell 행동 잠금 (2026-08-24, planner-trust-course).
 *
 * 1. 빈 코스 공유 버튼 — disabled + 클릭/키보드로 fetch·navigator.share·clipboard 0회.
 * 2. 시간제약(시간대) + 체류시간 입력 → 표시 + 접근성 순서변경(44px 버튼)으로 실제 이동.
 * 3. Radix 저장 다이얼로그 — 초기 포커스·Escape 닫힘·실제 form submit.
 * 4. 비동기 stale 안전망 — Day 를 바꾼 뒤 도착한 느린 실경로 응답이 화면에 반영되지 않음.
 * 5. 분석 이벤트 — opened 1회(마운트), started 는 최초 유효 추가 1회만(재추가 시 재발화 없음).
 * 6. 결정론적 목업 플로우 — 추가 → 수동 이동 → AI 최적화 → 저장 → 공유.
 * 7. Day 번호와 장소 수 — 시각·접근성 이름에서 `Day 10`으로 붙지 않음.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en', t: {}, changeLanguage: () => {} }) }));

let mockUser: { uid: string } | null = null;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser, loading: false, error: null }) }));

const signInMock = vi.fn();
vi.mock('@/lib/firebase', () => ({ signInWithGoogle: () => signInMock(), auth: {} }));

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

const createItineraryMock = vi.fn();
vi.mock('@/hooks/useItinerary', () => ({
  useItinerary: () => ({ itineraries: [], loading: false, deleteItinerary: vi.fn(), createItineraryWithSlots: createItineraryMock }),
}));

const trackEventMock = vi.fn();
vi.mock('@/lib/analytics', () => ({ trackEvent: (...args: unknown[]) => trackEventMock(...args) }));

vi.mock('@/pages/PlannerPage/components/courseBuilder/CourseMiniMap', () => ({
  CourseMiniMap: (props: { stops: unknown[]; routeSegments?: unknown[]; nearby?: unknown[] }) => (
    <div
      data-testid="mini-map"
      data-stop-count={props.stops.length}
      data-route-count={(props.routeSegments || []).length}
      data-nearby-count={(props.nearby || []).length}
    />
  ),
}));

vi.mock('@/pages/PlannerPage/components/courseBuilder/CoursePlaceSearch', () => ({
  CoursePlaceSearch: (props: {
    value: string; onChange: (v: string) => void; onPick: (p: { title: string; lat?: number; lng?: number }) => void; placeholder: string;
  }) => (
    <div>
      <input data-testid="place-search-input" value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} />
      <button type="button" data-testid="place-pick-btn" onClick={() => props.onPick({ title: 'Picked Cafe', lat: 37.55, lng: 126.99 })}>pick</button>
    </div>
  ),
}));

vi.mock('@/pages/PlannerPage/components/courseBuilder/zoneCourseTemplates', () => ({
  loadZoneCourseTemplates: vi.fn(async () => []),
  zoneCourseTemplateToStops: () => [],
}));

import { CourseBuilderShell } from '../../src/pages/PlannerPage/components/CourseBuilderShell';

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  authFetchMock.mockReset();
  createItineraryMock.mockReset();
  trackEventMock.mockReset();
  signInMock.mockReset();
  vi.unstubAllGlobals();
});

/** 폼에 제목을 채우고 "Add to Day" 버튼을 눌러 자유입력 stop 을 하나 추가한다. */
async function addManualStop(user: ReturnType<typeof userEvent.setup>, title: string) {
  const input = screen.getByTestId('place-search-input');
  await user.clear(input);
  await user.type(input, title);
  const addBtn = screen.getByRole('button', { name: /Add to Day/ });
  await user.click(addBtn);
}

describe('CourseBuilderShell — 빈 코스 공유 안전망', () => {
  it('Day 번호와 장소 수를 분리해 `Day 10` 오독을 막는다', () => {
    render(<CourseBuilderShell />);

    const dayTab = screen.getByRole('button', { name: 'Day 1, 0 stops' });
    expect(dayTab).toHaveTextContent('Day 1(0)');
    expect(dayTab.querySelector('[aria-hidden="true"]')).toHaveTextContent('(0)');
    expect(screen.queryByRole('button', { name: 'Day 10' })).not.toBeInTheDocument();
  });

  it('stop 이 0개면 공유 버튼이 disabled — 클릭해도 fetch/share/clipboard 0회', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const shareMock = vi.fn();
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });
    const clipboardWriteMock = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWriteMock }, configurable: true });

    render(<CourseBuilderShell />);
    const shareBtn = screen.getByRole('button', { name: /Share/ });
    expect(shareBtn).toBeDisabled();

    fireEvent.click(shareBtn);
    fireEvent.keyDown(shareBtn, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(shareMock).not.toHaveBeenCalled();
    expect(clipboardWriteMock).not.toHaveBeenCalled();
  });
});

describe('CourseBuilderShell — 시간제약/체류시간 + 접근성 순서변경', () => {
  it('시간대(window) + 체류시간을 입력해 추가하면 표시되고, 44px 버튼으로 실제 순서가 바뀐다', async () => {
    const user = userEvent.setup();
    render(<CourseBuilderShell />);

    await addManualStop(user, 'Gyeongbokgung');
    await addManualStop(user, 'Bukchon Village');

    // 두 stop 이 순서대로 렌더됐는지 — timeline row 텍스트 순서로 확인.
    const rows = screen.getAllByText(/Gyeongbokgung|Bukchon Village/);
    expect(rows[0].textContent).toBe('Gyeongbokgung');
    expect(rows[1].textContent).toBe('Bukchon Village');

    // 첫 stop 을 아래로 이동 → 두 번째가 된다.
    const moveDownButtons = screen.getAllByRole('button', { name: /Move .* down/ });
    const firstMoveDown = moveDownButtons[0];
    expect(firstMoveDown.className).toContain('min-h-[44px]');
    expect(firstMoveDown.className).toContain('min-w-[44px]');
    await user.click(firstMoveDown);

    const reordered = screen.getAllByText(/Gyeongbokgung|Bukchon Village/);
    expect(reordered[0].textContent).toBe('Bukchon Village');
    expect(reordered[1].textContent).toBe('Gyeongbokgung');

    // 경계에서는 버튼이 disabled — 맨 위 stop 의 "위로" 버튼.
    const moveUpButtons = screen.getAllByRole('button', { name: /Move .* up/ });
    expect(moveUpButtons[0]).toBeDisabled();
  });
});

describe('CourseBuilderShell — 시간 입력 접근성 이름', () => {
  it('추가 폼 시간 입력을 로컬라이즈드 accessible name("Time")으로 찾을 수 있다', () => {
    render(<CourseBuilderShell />);
    const timeInput = screen.getByLabelText('Time', { selector: 'input[type="time"]' });
    expect(timeInput).toBeInTheDocument();
  });

  it('인라인 수정 시간 입력도 같은 accessible name — 추가 폼 것과 합쳐 2개가 잡힌다', async () => {
    const user = userEvent.setup();
    render(<CourseBuilderShell />);
    await addManualStop(user, 'Insadong');
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const timeInputs = screen.getAllByLabelText('Time', { selector: 'input[type="time"]' });
    expect(timeInputs).toHaveLength(2);
    // Regression: both time inputs carry safe w-[132px] class to prevent clipping
    timeInputs.forEach((input) => {
      expect(input.className).toContain('w-[132px]');
    });
  });
});

describe('CourseBuilderShell — Radix 저장 다이얼로그', () => {
  beforeEach(() => { mockUser = { uid: 'u1' }; });

  it('열림: 제목 입력에 초기 포커스, Escape 로 닫힘, 실제 form submit', async () => {
    const user = userEvent.setup();
    createItineraryMock.mockResolvedValue('it-1');
    render(<CourseBuilderShell />);
    await addManualStop(user, 'Namsan Tower');

    await user.click(screen.getByRole('button', { name: /Save to my account/ }));
    const titleInput = await screen.findByPlaceholderText('e.g. My Seoul food trip');
    await waitFor(() => expect(document.activeElement).toBe(titleInput));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByPlaceholderText('e.g. My Seoul food trip')).not.toBeInTheDocument());

    // 다시 열고 이번엔 실제 제출까지.
    await user.click(screen.getByRole('button', { name: /Save to my account/ }));
    const titleInput2 = await screen.findByPlaceholderText('e.g. My Seoul food trip');
    await user.type(titleInput2, 'My Course');
    const form = titleInput2.closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => expect(createItineraryMock).toHaveBeenCalledTimes(1));
    expect(createItineraryMock.mock.calls[0][0]).toBe('My Course');
  });

  it('필수값(제목 비어있음) — submit 해도 저장 호출 없음', async () => {
    const user = userEvent.setup();
    render(<CourseBuilderShell />);
    await addManualStop(user, 'Namsan Tower');
    await user.click(screen.getByRole('button', { name: /Save to my account/ }));
    const titleInput = await screen.findByPlaceholderText('e.g. My Seoul food trip');
    const form = titleInput.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(createItineraryMock).not.toHaveBeenCalled();
  });
});

describe('CourseBuilderShell — 비동기 stale-result 안전망', () => {
  it('Day 를 바꾼 뒤 늦게 도착한 실경로 응답은 화면에 반영되지 않는다', async () => {
    const user = userEvent.setup();
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CourseBuilderShell />);
    // 좌표 있는 stop 2곳이 있어야 실경로 버튼이 뜬다 — place-pick 목업을 두 번 눌러 확보.
    await user.click(screen.getByTestId('place-pick-btn'));
    await user.click(screen.getByTestId('place-pick-btn'));

    const routeBtn = await screen.findByRole('button', { name: /Show transit route/ });
    await user.click(routeBtn);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 응답이 오기 전에 Day 를 하나 늘리고 전환 — basisKey 가 바뀌어 generation 이 올라간다.
    await user.click(screen.getByRole('button', { name: '+ Day' }));
    await user.click(screen.getByRole('button', { name: /Day 2/ }));
    expect(screen.getByTestId('mini-map').getAttribute('data-route-count')).toBe('0');

    // 이제 늦게 응답이 온다 — generation 이 이미 올라가 있어 폐기돼야 한다.
    resolveFetch({ json: async () => ({ segments: [{ to: 1, steps_detail: [] }] }) });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByTestId('mini-map').getAttribute('data-route-count')).toBe('0');
  });
});

describe('CourseBuilderShell — 분석 이벤트', () => {
  it('opened 는 마운트 시 1회, started 는 최초 유효 추가에서만 1회(재추가엔 재발화 없음)', async () => {
    const user = userEvent.setup();
    render(<CourseBuilderShell />);

    expect(trackEventMock).toHaveBeenCalledWith('course_builder_opened', { language: 'en' });
    expect(trackEventMock.mock.calls.filter((c) => c[0] === 'course_builder_started')).toHaveLength(0);

    await addManualStop(user, 'First Stop');
    const startedCalls = trackEventMock.mock.calls.filter((c) => c[0] === 'course_builder_started');
    expect(startedCalls).toHaveLength(1);
    expect(startedCalls[0][1]).toEqual({ source: 'manual', language: 'en' });

    await addManualStop(user, 'Second Stop');
    expect(trackEventMock.mock.calls.filter((c) => c[0] === 'course_builder_started')).toHaveLength(1);
  });

  it('저장 실패에도 이름/좌표/ID 는 절대 실리지 않는다(허용 키만)', async () => {
    mockUser = { uid: 'u1' };
    createItineraryMock.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<CourseBuilderShell />);
    await addManualStop(user, 'Secret Place Name');
    await user.click(screen.getByRole('button', { name: /Save to my account/ }));
    const titleInput = await screen.findByPlaceholderText('e.g. My Seoul food trip');
    await user.type(titleInput, 'My Course');
    fireEvent.submit(titleInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      const savedCalls = trackEventMock.mock.calls.filter((c) => c[0] === 'course_builder_saved');
      expect(savedCalls).toHaveLength(1);
      const payload = savedCalls[0][1];
      expect(Object.keys(payload).sort()).toEqual(['durationMs', 'language', 'reason', 'success']);
      expect(JSON.stringify(payload)).not.toContain('Secret Place Name');
      expect(JSON.stringify(payload)).not.toContain('My Course');
    });
  });
});

describe('CourseBuilderShell — 결정론적 목업 플로우: 추가 → 수동 이동 → AI 최적화 → 저장 → 공유', () => {
  it('전 구간 외부 호출은 목업으로만 — 실제 네트워크 0', async () => {
    mockUser = { uid: 'u1' };
    createItineraryMock.mockResolvedValue('it-42');
    authFetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, optimizedOrder: ['s-b', 's-a'], nearby: [] }),
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/course-share')) {
        return { json: async () => ({ ok: true, id: 'abc12345' }) };
      }
      return { json: async () => ({ segments: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });

    const user = userEvent.setup();
    render(<CourseBuilderShell />);

    // 1) 추가 (좌표 있는 pick 두 번 — AI 최적화·실경로 버튼은 좌표 2곳 이상을 요구한다)
    await user.click(screen.getByTestId('place-pick-btn'));
    await user.click(screen.getByTestId('place-pick-btn'));

    // 2) 수동 이동 — 두 번째 stop 을 위로.
    const upButtons = screen.getAllByRole('button', { name: /Move .* up/ });
    await user.click(upButtons[upButtons.length - 1]);

    // 3) AI 최적화 (authFetch 목업)
    const aiBtn = await screen.findByRole('button', { name: /AI optimize route/ });
    await user.click(aiBtn);
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1));

    // 4) 저장
    await user.click(screen.getByRole('button', { name: /Save to my account/ }));
    const titleInput = await screen.findByPlaceholderText('e.g. My Seoul food trip');
    await user.type(titleInput, 'Flow Course');
    fireEvent.submit(titleInput.closest('form') as HTMLFormElement);
    await waitFor(() => expect(createItineraryMock).toHaveBeenCalledTimes(1));

    // 5) 공유
    await user.click(screen.getByRole('button', { name: /Share/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const names = ['course_builder_opened', 'course_builder_started', 'course_builder_optimize_result', 'course_builder_saved', 'course_builder_shared'];
    for (const n of names) {
      expect(trackEventMock.mock.calls.some((c) => c[0] === n)).toBe(true);
    }
  });
});
