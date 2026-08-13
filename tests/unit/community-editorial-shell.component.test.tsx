// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const state = vi.hoisted(() => ({
  language: 'en' as 'ko' | 'en' | 'ja' | 'zh',
  auth: { user: null as null | { getIdToken: () => Promise<string> }, loading: false, error: null as string | null },
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: state.language,
    changeLanguage: vi.fn(),
  }),
}));
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => state.auth }));
vi.mock('../../src/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/lib/appReady', () => ({ signalAppReady: vi.fn() }));
vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../src/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('../../src/lib/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../src/lib/storage-upload', () => ({ uploadCommunityPhoto: vi.fn() }));

vi.stubGlobal('fetch', fetchMock);

const { default: CommunityPage, CommunityComposePage, CommunityPostPage } = await import('../../src/pages/CommunityPage');

void React;

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  };
}

function renderRoute(element: React.ReactNode, entry: string, path?: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      {path ? <Routes><Route path={path} element={element} /></Routes> : element}
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  state.language = 'en';
  state.auth = { user: null, loading: false, error: null };
  fetchMock.mockReset();
});

describe('community editorial public shell', () => {
  it('uses the shared empty state with a useful action', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { posts: [] } }));

    renderRoute(<CommunityPage />, '/community');

    const empty = await screen.findByTestId('community-feed-empty');
    expect(empty).toHaveTextContent('Be the first to post');
    expect(empty).toHaveAccessibleName(/Be the first to post/i);
    expect(within(empty).getByRole('link', { name: 'Create post' })).toHaveAttribute('href', '/community/new');
  });

  it('announces loading instead of showing an unlabeled spinner', () => {
    state.auth = { user: null, loading: true, error: null };
    fetchMock.mockImplementation(() => new Promise(() => {}));

    renderRoute(<CommunityPage />, '/community');

    const loading = screen.getByTestId('community-feed-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent('Loading community posts');
  });

  it('retries a failed feed request through the shared error state', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'fixture-error' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { posts: [] } }));

    renderRoute(<CommunityPage />, '/community');

    const error = await screen.findByTestId('community-feed-error');
    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('community-feed-empty')).toHaveTextContent('Be the first to post');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses a dedicated loading label for alerts', () => {
    state.auth = { user: { getIdToken: async () => 'fixture-token' }, loading: false, error: null };
    fetchMock.mockImplementation(() => new Promise(() => {}));

    renderRoute(<CommunityPage />, '/community?tab=alerts');

    expect(screen.getByTestId('community-alerts-loading')).toHaveTextContent('Loading alerts');
  });

  it('keeps alerts failures retryable instead of showing a false empty state', async () => {
    state.auth = { user: { getIdToken: async () => 'fixture-token' }, loading: false, error: null };
    let notificationRequests = 0;
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input).includes('/api/community-notifications')) {
        notificationRequests += 1;
        if (notificationRequests === 1) return jsonResponse({ ok: false, error: 'fixture-error' });
        return jsonResponse({ ok: true, data: { items: [], unread: 0 } });
      }
      return jsonResponse({ ok: true, data: { posts: [] } });
    });

    renderRoute(<CommunityPage />, '/community?tab=alerts');

    const error = await screen.findByTestId('community-alerts-error');
    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No alerts yet')).toBeInTheDocument();
    expect(notificationRequests).toBe(2);
  });

  it('keeps transient post failures retryable instead of calling them missing', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ ok: false, error: 'fixture-error' }) })
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        data: {
          post: {
            id: 'fixture-post', title: 'Recovered post', body: 'The retry succeeded.', lang: 'en', type: 'tip', category: 'seoul',
            authorName: 'Mina', isOwn: false, likeCount: 0, replyCount: 0, createdAt: Date.now(), translations: {}, images: [],
          },
          replies: [],
        },
      }));

    renderRoute(<CommunityPostPage />, '/community/post/fixture-post', '/community/post/:postId');

    const error = await screen.findByTestId('community-post-error');
    expect(error).toHaveTextContent('Could not load this post.');
    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Recovered post' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a missing post distinct from a retryable request failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ ok: false, error: 'not-found' }) });

    renderRoute(<CommunityPostPage />, '/community/post/missing-post', '/community/post/:postId');

    const missing = await screen.findByRole('region', { name: 'This post is unavailable' });
    expect(missing).toHaveTextContent('It may have been removed or the link may be incorrect.');
    expect(within(missing).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('localizes owner and like controls in Japanese', async () => {
    state.language = 'ja';
    state.auth = { user: { getIdToken: async () => 'fixture-token' }, loading: false, error: null };
    fetchMock.mockResolvedValue(jsonResponse({
      ok: true,
      data: {
        posts: [{
          id: 'fixture-post',
          title: 'ソウルで静かに過ごせる場所',
          body: '朝の散歩に向く場所を共有します。',
          lang: 'ja',
          type: 'tip',
          category: 'seoul',
          authorName: 'Mina',
          isOwn: true,
          likeCount: 2,
          replyCount: 1,
          createdAt: Date.now(),
          translations: {},
          images: [],
        }],
      },
    }));

    renderRoute(<CommunityPage />, '/community');

    expect(await screen.findByRole('button', { name: '削除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'いいね' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Like' })).not.toBeInTheDocument();
  });

  it('keeps report dialog focus contained and returns it to the trigger', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      ok: true,
      data: {
        posts: [{
          id: 'fixture-post',
          title: 'A quiet walk in Seoul',
          body: 'A calm place for an early walk.',
          lang: 'en',
          type: 'tip',
          category: 'seoul',
          authorName: 'Mina',
          isOwn: false,
          likeCount: 2,
          replyCount: 1,
          createdAt: Date.now(),
          translations: {},
          images: [],
        }],
      },
    }));

    renderRoute(<CommunityPage />, '/community');

    const trigger = (await screen.findAllByRole('button', { name: 'Report' }))[0];
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Why are you reporting this?' });
    const closeButton = within(dialog).getAllByRole('button', { name: 'Cancel' })[0];
    const submitButton = within(dialog).getByRole('button', { name: 'Send report' });
    const reportOptions = within(dialog).getAllByRole('radio');
    expect(closeButton).toHaveFocus();

    reportOptions[0].focus();
    fireEvent.keyDown(reportOptions[0], { key: 'ArrowDown' });
    expect(reportOptions[1]).toHaveFocus();
    expect(reportOptions[1]).toHaveAttribute('aria-checked', 'true');

    submitButton.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('waits for authentication before showing the compose sign-in state', () => {
    state.auth = { user: null, loading: true, error: null };

    renderRoute(<CommunityComposePage />, '/community/new');

    expect(screen.getByTestId('community-compose-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('renders a deterministic dev-only compose form without enabling writes', async () => {
    state.auth = { user: null, loading: true, error: null };

    renderRoute(<CommunityComposePage />, '/community/new?__fixture=compose');

    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Details')).toBeInTheDocument();
    const postTypes = screen.getAllByRole('radio');
    expect(postTypes).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Question' })).toHaveAttribute('aria-checked', 'true');
    postTypes[0].focus();
    fireEvent.keyDown(postTypes[0], { key: 'ArrowRight' });
    expect(postTypes[1]).toHaveFocus();
    expect(postTypes[1]).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(screen.queryByTestId('community-compose-loading')).not.toBeInTheDocument());
  });
});
