// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Language = 'ko' | 'en' | 'ja' | 'zh';

const navigateMock = vi.fn();
let languageMock: Language = 'en';

vi.mock('react-router-dom', async (original) => ({
  ...(await original() as object),
  useNavigate: () => navigateMock,
}));
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: languageMock, t: {}, changeLanguage: vi.fn() }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/sections/Header', () => ({ Header: () => <header data-testid="header" /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <footer data-testid="footer" /> }));
vi.mock('@/pages/PlannerPage/components/courseBuilder/CourseMiniMap', () => ({
  CourseMiniMap: () => <div data-testid="course-map" />,
}));

import SharedCoursePage from '@/pages/SharedCoursePage';

const readyPayload = {
  ok: true,
  data: {
    v: 1,
    title: 'Seoul morning',
    days: [
      { stops: [{ id: 'stop-1', title: 'Gyeongbokgung', time: '09:00', category: 'sight', memo: 'North gate' }] },
      { stops: [{ id: 'stop-2', title: 'Mangwon Market', time: '12:00', category: 'food', memo: '' }] },
    ],
  },
};

function response(status: number, payload: object) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function renderPage(id = 'abcd1234') {
  return render(
    <MemoryRouter initialEntries={[`/s/${id}`]}>
      <Routes>
        <Route path="/s/:id" element={<SharedCoursePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  languageMock = 'en';
  navigateMock.mockReset();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('SharedCoursePage editorial state contract', () => {
  it('announces a meaningful loading skeleton', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderPage();

    const loading = screen.getByTestId('shared-course-loading');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.textContent).toContain('Loading shared course');
  });

  it('keeps a missing share separate from a temporary error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(404, { ok: false, code: 'NOT_FOUND' })));
    renderPage('missing1');

    await waitFor(() => expect(screen.getByTestId('shared-course-not-found')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers retry for a temporary failure and recovers in place', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(500, { ok: false, code: 'INTERNAL_ERROR' }))
      .mockResolvedValueOnce(response(200, readyPayload));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const error = await screen.findByTestId('shared-course-error');
    fireEvent.click(error.querySelector('button') as HTMLButtonElement);

    await waitFor(() => expect(screen.getByTestId('shared-course-ready')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a constructive empty state when the shared course has no stops', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {
      ok: true,
      data: { v: 1, title: '', days: [{ stops: [] }] },
    })));
    renderPage();

    await waitFor(() => expect(screen.getByTestId('shared-course-empty')).toBeTruthy());
    expect(screen.queryByTestId('shared-course-ready')).toBeNull();
  });

  it('keeps valid places visible and announces partial data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {
      ok: true,
      data: {
        v: 1,
        days: [{ stops: [
          readyPayload.data.days[0].stops[0],
          { id: 'broken-stop', title: '', time: '', category: 'etc', memo: '' },
        ] }],
      },
    })));
    renderPage();

    await screen.findByText('Gyeongbokgung');
    expect(screen.getByText('Some place details are unavailable.')).toBeTruthy();
  });

  it('preserves the local draft handoff without changing the public API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, readyPayload)));
    renderPage();

    await screen.findByText('Gyeongbokgung');
    fireEvent.click(screen.getByRole('button', { name: 'Use this course in my planner' }));

    const draft = JSON.parse(localStorage.getItem('cocotrip:course:draft:v1') || 'null');
    expect(draft.days[0].stops[0].title).toBe('Gyeongbokgung');
    expect(navigateMock).toHaveBeenCalledWith('/planner?mode=course');
  });

  it('moves between day tabs with the standard arrow-key pattern', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, readyPayload)));
    renderPage();

    const tabs = await screen.findAllByRole('tab');
    expect(tabs[0].textContent).toContain('Day 1');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });

    await waitFor(() => expect(tabs[1].getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(tabs[1]);
  });

  it.each([
    ['ko', '공유된 코스'],
    ['en', 'Shared course'],
    ['ja', '共有されたコース'],
    ['zh', '共享行程'],
  ] as const)('renders the %s heading without English fallback', async (language, heading) => {
    languageMock = language;
    vi.stubGlobal('fetch', vi.fn(async () => response(200, readyPayload)));
    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: heading })).toBeTruthy());
  });
});
