// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type SnapshotDoc = { id: string; data: () => Record<string, unknown> };

const testState = vi.hoisted(() => ({
  language: 'en' as Language,
  nextSnapshot: null as null | ((snapshot: { docs: SnapshotDoc[] }) => void),
  failSnapshot: null as null | ((error: Error) => void),
  getDocs: vi.fn(),
  subscriptions: 0,
}));

const copy = {
  ko: { title: '내 플랜', bookings: '내 예약', search: '제목·지역으로 검색', loadMore: '더 보기', ready: '완료', generating: '생성 중', empty: '아직 플랜이 없어요', emptyBody: '첫 AI 한국 여행 일정을 만들어 보세요', start: '플랜 만들기', pax: '명', noMatch: '검색 결과가 없어요' },
  en: { title: 'My Plans', bookings: 'My Bookings', search: 'Search by title or area', loadMore: 'Load more', ready: 'Ready', generating: 'Generating', empty: 'No plans yet', emptyBody: 'Create your first AI-powered Korea itinerary', start: 'Start planning', pax: 'pax', noMatch: 'No matching plans' },
  ja: { title: 'マイプラン', bookings: '予約一覧', search: 'タイトル・地域で検索', loadMore: 'もっと見る', ready: '完了', generating: '作成中', empty: 'まだプランがありません', emptyBody: '最初のAI韓国旅行プランを作成しましょう', start: 'プランを作る', pax: '名', noMatch: '該当するプランがありません' },
  zh: { title: '我的计划', bookings: '我的预订', search: '按标题或地区搜索', loadMore: '加载更多', ready: '已完成', generating: '生成中', empty: '还没有行程', emptyBody: '创建您的第一个 AI 韩国行程', start: '开始规划', pax: '人', noMatch: '没有匹配的行程' },
} as const;

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'editorial-owner', displayName: 'Coco Traveler', email: 'traveler@example.com' }, loading: false }),
}));

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => {
    const current = copy[testState.language];
    return {
      language: testState.language,
      changeLanguage: vi.fn(),
      t: {
        planner: { my_plans: current.title },
        mypage: {
          tabBookings: current.bookings,
          myPlansSearch: current.search,
          myPlansLoadMore: current.loadMore,
          myPlansStatusReady: current.ready,
          myPlansStatusGenerating: current.generating,
          myPlansEmptyTitle: current.empty,
          myPlansEmptyBody: current.emptyBody,
          myPlansStartCta: current.start,
          myPlansPaxUnit: current.pax,
          myPlansNoMatch: current.noMatch,
        },
        pageMeta: { myPlans: { title: current.title, description: current.emptyBody } },
      },
    };
  },
}));

vi.mock('../../src/hooks/useLoyalty', () => ({ useLoyalty: () => ({ loyalty: { tier: 'Bronze' } }) }));
vi.mock('../../src/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/sections/Header', () => ({ Header: () => <header data-testid="header" /> }));
vi.mock('../../src/sections/Footer', () => ({ Footer: () => <footer data-testid="footer" /> }));
vi.mock('../../src/components/MyBookingsTab', () => ({ MyBookingsTab: () => <div data-testid="bookings-boundary" /> }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ kind: 'collection' })),
  query: vi.fn((...parts: unknown[]) => ({ parts })),
  orderBy: vi.fn(() => ({ kind: 'order' })),
  limit: vi.fn(() => ({ kind: 'limit' })),
  startAfter: vi.fn(() => ({ kind: 'cursor' })),
  onSnapshot: vi.fn((_query: unknown, next: (snapshot: { docs: SnapshotDoc[] }) => void, fail: (error: Error) => void) => {
    testState.subscriptions += 1;
    testState.nextSnapshot = next;
    testState.failSnapshot = fail;
    return vi.fn();
  }),
  getDocs: (...args: unknown[]) => testState.getDocs(...args),
}));

import MyPlansPage from '../../src/pages/MyPlansPage';

function renderPage(path = '/my-plans') {
  return render(<MemoryRouter initialEntries={[path]}><MyPlansPage /></MemoryRouter>);
}

function snapshotDoc(index: number, status: 'ready' | 'generating' = 'ready'): SnapshotDoc {
  return {
    id: `ref-${index}`,
    data: () => ({
      planId: `plan-${index}`,
      createdAt: '2026-08-13T00:00:00.000Z',
      status,
      tourTitle: index === 1 ? 'Seoul field notes' : `Korea plan ${index}`,
      area: index === 1 ? 'Seoul' : 'Busan',
      startDate: '2026-09-10',
      pax: 2,
    }),
  };
}

async function emitSnapshot(docs: SnapshotDoc[]) {
  await act(async () => { testState.nextSnapshot?.({ docs }); });
}

describe('/my-plans editorial state contract', () => {
  beforeEach(() => {
    testState.language = 'en';
    testState.nextSnapshot = null;
    testState.failSnapshot = null;
    testState.getDocs.mockReset();
    testState.subscriptions = 0;
  });

  it('announces loading and renders an actionable empty state', async () => {
    renderPage();
    expect(screen.getByTestId('my-plans-list-loading')).toHaveAttribute('aria-busy', 'true');
    await emitSnapshot([]);
    expect(screen.getByTestId('my-plans-list-empty')).toHaveTextContent('No plans yet');
    expect(screen.getByRole('link', { name: 'Start planning' })).toHaveAttribute('href', '/planner');
  });

  it('names both tab panels and supports roving arrow-key focus', async () => {
    renderPage();
    await emitSnapshot([]);
    const plansTab = screen.getByRole('tab', { name: 'My Plans' });
    const bookingsTab = screen.getByRole('tab', { name: 'My Bookings' });

    expect(plansTab).toHaveAttribute('aria-controls', 'my-plans-plans-panel');
    expect(plansTab).toHaveAttribute('tabindex', '0');
    expect(bookingsTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'My Plans' })).toBeVisible();

    fireEvent.keyDown(plansTab, { key: 'ArrowRight' });
    expect(bookingsTab).toHaveFocus();
    expect(bookingsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'My Bookings' })).toBeVisible();

    fireEvent.keyDown(bookingsTab, { key: 'Home' });
    expect(plansTab).toHaveFocus();
    expect(plansTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a retryable error instead of pretending the library is empty', async () => {
    renderPage();
    await act(async () => { testState.failSnapshot?.(new Error('permission-denied')); });
    expect(screen.getByTestId('my-plans-list-error')).toHaveTextContent('Could not load your plans');
    expect(screen.queryByTestId('my-plans-list-empty')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(testState.subscriptions).toBe(2));
  });

  it('keeps loaded plans visible when the next page fails', async () => {
    testState.getDocs.mockRejectedValueOnce(new Error('network'));
    renderPage();
    await emitSnapshot(Array.from({ length: 30 }, (_, index) => snapshotDoc(index + 1, index === 1 ? 'generating' : 'ready')));

    expect(screen.getByRole('link', { name: /Seoul field notes/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByTestId('my-plans-list-partial')).toHaveTextContent('Some plans could not be loaded');
    expect(screen.getByRole('link', { name: /Seoul field notes/ })).toBeVisible();
  });

  it('retries only the failed next page and appends it to the visible plans', async () => {
    testState.getDocs
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ docs: [snapshotDoc(31)] });
    renderPage();
    await emitSnapshot(Array.from({ length: 30 }, (_, index) => snapshotDoc(index + 1)));

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByTestId('my-plans-list-partial')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: /Korea plan 31/ })).toBeVisible();
    expect(screen.queryByTestId('my-plans-list-partial')).not.toBeInTheDocument();
  });

  it('turns a search miss into a reversible state', async () => {
    renderPage();
    await emitSnapshot([snapshotDoc(1)]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by title or area' }), { target: { value: 'Jeju' } });
    expect(screen.getByTestId('my-plans-list-no-match')).toHaveTextContent('No matching plans');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('link', { name: /Seoul field notes/ })).toBeVisible();
  });

  it('omits empty date metadata instead of leaving an orphan calendar icon', async () => {
    const undatedPlan: SnapshotDoc = {
      id: 'undated-ref',
      data: () => ({
        planId: 'undated-plan',
        createdAt: 'not-a-date',
        status: 'ready',
        tourTitle: 'Undated field notes',
      }),
    };
    renderPage();
    await emitSnapshot([undatedPlan]);

    const planCard = screen.getByRole('link', { name: /Undated field notes/ });
    expect(planCard.querySelector('.my-plans-editorial-meta')).not.toBeInTheDocument();
  });

  it('does not render zero passengers as stray metadata text', async () => {
    const zeroPaxPlan: SnapshotDoc = {
      id: 'zero-pax-ref',
      data: () => ({
        planId: 'zero-pax-plan',
        createdAt: '2026-08-13T00:00:00.000Z',
        startDate: '2026-09-10',
        status: 'ready',
        tourTitle: 'Solo field notes',
        pax: 0,
      }),
    };
    renderPage();
    await emitSnapshot([zeroPaxPlan]);

    const planCard = screen.getByRole('link', { name: /Solo field notes/ });
    const metadata = planCard.querySelector('.my-plans-editorial-meta');
    expect(metadata).toBeInTheDocument();
    expect(metadata?.children.length).toBe(1);
    expect(metadata).not.toHaveTextContent(/0\s+pax/);
  });

  it('keeps load more available when a search only misses the loaded page', async () => {
    testState.getDocs.mockResolvedValueOnce({ docs: [snapshotDoc(31)] });
    renderPage();
    await emitSnapshot(Array.from({ length: 30 }, (_, index) => snapshotDoc(index + 1)));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by title or area' }), {
      target: { value: 'Korea plan 31' },
    });

    expect(screen.getByTestId('my-plans-list-no-match')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('link', { name: /Korea plan 31/ })).toBeVisible();
    expect(screen.queryByTestId('my-plans-list-no-match')).not.toBeInTheDocument();
  });

  it.each([
    ['ko', '일정을 불러오지 못했어요', '다시 시도'],
    ['en', 'Could not load your plans', 'Try again'],
    ['ja', 'プランを読み込めませんでした', '再試行'],
    ['zh', '无法加载行程', '重试'],
  ] as const)('localizes the error state in %s', async (language, title, retry) => {
    testState.language = language;
    renderPage();
    await act(async () => { testState.failSnapshot?.(new Error('fixture')); });
    expect(screen.getByTestId('my-plans-list-error')).toHaveTextContent(title);
    expect(screen.getByRole('button', { name: retry })).toBeVisible();
  });
});
