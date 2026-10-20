// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

type Lang = 'ko' | 'en' | 'ja' | 'zh';
type TestUser = { getIdToken: () => Promise<string> };

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

const { default: CommunityPage, CommunityPostPage } = await import('../../src/pages/CommunityPage');

void React;

// ── fixtures (공개 API 응답 모양과 동일) ──
type Translations = Partial<Record<Lang, { title: string | null; body: string }>>;
type PostFixture = {
  id: string; title: string; body: string; lang: Lang; type: string; category: string;
  authorName: string; isOwn: boolean; likeCount: number; replyCount: number;
  createdAt: number; translations: Translations; images: string[];
};
type ReplyFixture = {
  id: string; body: string; lang: Lang; authorName: string; isOwn: boolean;
  createdAt: number; translations: Translations;
};

function makePost(id: string, title: string, category = 'seoul'): PostFixture {
  return {
    id, title, body: `${title} body`, lang: 'en', type: 'tip', category,
    authorName: 'Mina', isOwn: false, likeCount: 0, replyCount: 0,
    createdAt: Date.now(), translations: {}, images: [],
  };
}

function makeReply(id: string, body: string): ReplyFixture {
  return { id, body, lang: 'en', authorName: 'Jun', isOwn: false, createdAt: Date.now(), translations: {} };
}

// ── deferred fetch ──
type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
type PendingRequest = Deferred<FetchResult> & { url: string };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function okResponse(data: unknown): FetchResult {
  return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
}

const requests: PendingRequest[] = [];

function deferFetches() {
  fetchMock.mockImplementation((input: unknown) => {
    const request = deferred<FetchResult>();
    requests.push({ ...request, url: String(input) });
    return request.promise;
  });
}

/** 결과를 흘려보내고 남은 마이크로태스크까지 비운다 — "반영되지 않음"을 확인할 때 쓴다. */
async function settle(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function PostNav({ ids }: { ids: string[] }) {
  const navigate = useNavigate();
  return <>{ids.map((id) => <button key={id} type="button" onClick={() => navigate(`/community/post/${id}`)}>{`open ${id}`}</button>)}</>;
}

function renderFeed(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CommunityPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function renderPost(entry: string, navIds: string[] = []) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PostNav ids={navIds} />
      <Routes><Route path="/community/post/:postId" element={<CommunityPostPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  state.language = 'en';
  state.auth = { user: null, loading: false, error: null };
  fetchMock.mockReset();
  requests.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('community feed request ordering', () => {
  it('keeps the newer tab result when an older request resolves last', async () => {
    deferFetches();
    renderFeed('/community');
    fireEvent.click(screen.getByRole('button', { name: 'Popular' }));
    expect(requests.map((r) => r.url)).toEqual(['/api/community-posts?sort=latest', '/api/community-posts?sort=popular']);

    await settle(() => requests[1].resolve(okResponse({ posts: [makePost('b', 'Popular B')] })));
    expect(screen.getByRole('heading', { name: 'Popular B' })).toBeInTheDocument();

    await settle(() => requests[0].resolve(okResponse({ posts: [makePost('a', 'Latest A')] })));
    expect(screen.getByRole('heading', { name: 'Popular B' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Latest A' })).not.toBeInTheDocument();
  });

  it('ignores a stale failure instead of replacing the newer feed with an error', async () => {
    deferFetches();
    renderFeed('/community');
    fireEvent.click(screen.getByRole('button', { name: 'Popular' }));

    await settle(() => requests[1].resolve(okResponse({ posts: [makePost('b', 'Popular B')] })));
    await settle(() => requests[0].reject(new Error('fixture-network')));

    expect(screen.queryByTestId('community-feed-error')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Popular B' })).toBeInTheDocument();
  });

  it('keeps the newer request loading when an older request completes first', async () => {
    deferFetches();
    renderFeed('/community');
    fireEvent.click(screen.getByRole('button', { name: 'Popular' }));

    await settle(() => requests[0].resolve(okResponse({ posts: [makePost('a', 'Latest A')] })));
    expect(screen.getByTestId('community-feed-loading')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Latest A' })).not.toBeInTheDocument();

    await settle(() => requests[1].resolve(okResponse({ posts: [makePost('b', 'Popular B')] })));
    expect(screen.queryByTestId('community-feed-loading')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Popular B' })).toBeInTheDocument();
  });

  it('applies only the latest of two requests for the same tab', async () => {
    deferFetches();
    renderFeed('/community');
    fireEvent.click(screen.getByRole('button', { name: 'Popular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(requests.map((r) => r.url)).toEqual([
      '/api/community-posts?sort=latest', '/api/community-posts?sort=popular', '/api/community-posts?sort=latest',
    ]);

    await settle(() => requests[2].resolve(okResponse({ posts: [makePost('fresh', 'Fresh latest')] })));
    await settle(() => requests[1].resolve(okResponse({ posts: [makePost('pop', 'Old popular')] })));
    await settle(() => requests[0].resolve(okResponse({ posts: [makePost('stale', 'Stale latest')] })));

    expect(screen.getByRole('heading', { name: 'Fresh latest' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Old popular' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Stale latest' })).not.toBeInTheDocument();
  });

  it('lets a retry recover after a failure', async () => {
    deferFetches();
    renderFeed('/community');
    await settle(() => requests[0].reject(new Error('fixture-network')));

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByTestId('community-feed-loading')).toBeInTheDocument();
    await settle(() => requests[1].resolve(okResponse({ posts: [makePost('r', 'Recovered feed')] })));

    expect(screen.queryByTestId('community-feed-error')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recovered feed' })).toBeInTheDocument();
  });

  it('discards a request that started before auth went back to loading', async () => {
    deferFetches();
    const view = renderFeed('/community');
    const rerenderFeed = () => view.rerender(
      <MemoryRouter initialEntries={['/community']}>
        <CommunityPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    state.auth = { user: null, loading: true, error: null };
    rerenderFeed();
    expect(requests).toHaveLength(1);
    state.auth = { user: null, loading: false, error: null };
    rerenderFeed();
    expect(requests).toHaveLength(2);

    await settle(() => requests[0].resolve(okResponse({ posts: [makePost('old', 'Before auth')] })));
    expect(screen.getByTestId('community-feed-loading')).toBeInTheDocument();
    await settle(() => requests[1].resolve(okResponse({ posts: [makePost('new', 'After auth')] })));
    expect(screen.getByRole('heading', { name: 'After auth' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Before auth' })).not.toBeInTheDocument();
  });

  it('does not start an obsolete request after a slow token resolves', async () => {
    deferFetches();
    const tokens: Deferred<string>[] = [];
    const user: TestUser = {
      getIdToken: () => {
        const token = deferred<string>();
        tokens.push(token);
        return token.promise;
      },
    };
    state.auth = { user, loading: false, error: null };

    renderFeed('/community');
    fireEvent.click(screen.getByRole('button', { name: 'Popular' }));
    expect(tokens).toHaveLength(2);

    await settle(() => tokens[1].resolve('fixture-token-b'));
    await settle(() => tokens[0].resolve('fixture-token-a'));
    expect(requests.map((r) => r.url)).toEqual(['/api/community-posts?sort=popular']);

    await settle(() => requests[0].resolve(okResponse({ posts: [makePost('b', 'Popular B')] })));
    expect(screen.getByRole('heading', { name: 'Popular B' })).toBeInTheDocument();
  });

  it('settles safely after unmount without starting new requests', async () => {
    deferFetches();
    const consoleError = vi.spyOn(console, 'error');
    const view = renderFeed('/community');
    view.unmount();

    await settle(() => requests[0].resolve(okResponse({ posts: [makePost('a', 'Late feed')] })));
    expect(requests).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('community feed URL state', () => {
  const feedPosts = [
    makePost('s1', 'Seoul walk', 'seoul'),
    makePost('s2', 'Seoul food', 'seoul'),
    makePost('l1', 'Living walk tips', 'living'),
  ];

  beforeEach(() => {
    fetchMock.mockImplementation(async () => okResponse({ posts: feedPosts }));
  });

  it('resets popular tab and topic when navigating back to the base feed, keeping local filters working', async () => {
    renderFeed('/community?tab=popular&topic=seoul');

    expect(await screen.findByRole('heading', { name: 'Seoul walk' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Living walk tips' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Popular' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getAllByRole('link', { name: 'Feed' })[0]);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/community$/);
    expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Living walk tips' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seoul walk' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Living in Korea' }));
    expect(screen.getByRole('button', { name: 'Living in Korea' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Seoul walk' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Popular' }));
    expect(screen.getByRole('button', { name: 'Popular' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Living walk tips' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Seoul walk' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/community$/);
  });

  it('resets a combined popular/topic view to the defaults when only a search query remains', async () => {
    renderFeed('/community?tab=popular&topic=seoul');
    expect(await screen.findByRole('heading', { name: 'Seoul food' })).toBeInTheDocument();

    const search = screen.getByRole('textbox', { name: 'Search Korea tips, places and people' });
    fireEvent.change(search, { target: { value: 'walk' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/community\?q=walk$/);
    expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'Living walk tips' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seoul walk' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Seoul food' })).not.toBeInTheDocument();
  });
});

describe('community post detail request ordering', () => {
  it('keeps the newer post when the older post resolves last', async () => {
    deferFetches();
    renderPost('/community/post/a', ['b']);
    fireEvent.click(screen.getByRole('button', { name: 'open b' }));
    expect(requests.map((r) => r.url)).toEqual(['/api/community-posts?id=a', '/api/community-posts?id=b']);

    await settle(() => requests[1].resolve(okResponse({ post: makePost('b', 'Post B'), replies: [makeReply('rb', 'Reply on B')] })));
    await settle(() => requests[0].resolve(okResponse({ post: makePost('a', 'Post A'), replies: [makeReply('ra', 'Reply on A')] })));

    expect(screen.getByRole('heading', { name: 'Post B' })).toBeInTheDocument();
    expect(screen.getByText('Reply on B')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Post A' })).not.toBeInTheDocument();
    expect(screen.queryByText('Reply on A')).not.toBeInTheDocument();
  });

  it('ignores a stale failure instead of showing an error over the newer post', async () => {
    deferFetches();
    renderPost('/community/post/a', ['b']);
    fireEvent.click(screen.getByRole('button', { name: 'open b' }));

    await settle(() => requests[1].resolve(okResponse({ post: makePost('b', 'Post B'), replies: [] })));
    await settle(() => requests[0].reject(new Error('fixture-network')));

    expect(screen.queryByTestId('community-post-error')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Post B' })).toBeInTheDocument();
  });

  it('keeps the newer post loading when the older post completes first', async () => {
    deferFetches();
    renderPost('/community/post/a', ['b']);
    fireEvent.click(screen.getByRole('button', { name: 'open b' }));

    await settle(() => requests[0].resolve(okResponse({ post: makePost('a', 'Post A'), replies: [] })));
    expect(screen.getByTestId('community-post-loading')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Post A' })).not.toBeInTheDocument();

    await settle(() => requests[1].resolve(okResponse({ post: makePost('b', 'Post B'), replies: [] })));
    expect(screen.queryByTestId('community-post-loading')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Post B' })).toBeInTheDocument();
  });

  it('applies only the latest of two requests for the same post', async () => {
    deferFetches();
    renderPost('/community/post/a', ['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'open b' }));
    fireEvent.click(screen.getByRole('button', { name: 'open a' }));
    expect(requests.map((r) => r.url)).toEqual([
      '/api/community-posts?id=a', '/api/community-posts?id=b', '/api/community-posts?id=a',
    ]);

    await settle(() => requests[2].resolve(okResponse({ post: makePost('a', 'Fresh A'), replies: [] })));
    await settle(() => requests[1].resolve(okResponse({ post: makePost('b', 'Post B'), replies: [] })));
    await settle(() => requests[0].reject(new Error('fixture-network')));

    expect(screen.getByRole('heading', { name: 'Fresh A' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Post B' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('community-post-error')).not.toBeInTheDocument();
  });

  it('settles safely after unmount without starting new requests', async () => {
    deferFetches();
    const consoleError = vi.spyOn(console, 'error');
    const view = renderPost('/community/post/a');
    view.unmount();

    await settle(() => requests[0].resolve(okResponse({ post: makePost('a', 'Late post'), replies: [] })));
    expect(requests).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not start an obsolete post request after a slow token resolves', async () => {
    deferFetches();
    const tokens: Deferred<string>[] = [];
    const user: TestUser = {
      getIdToken: () => {
        const token = deferred<string>();
        tokens.push(token);
        return token.promise;
      },
    };
    state.auth = { user, loading: false, error: null };

    renderPost('/community/post/a', ['b']);
    fireEvent.click(screen.getByRole('button', { name: 'open b' }));
    expect(tokens).toHaveLength(2);

    await settle(() => tokens[1].resolve('fixture-token-b'));
    await settle(() => tokens[0].resolve('fixture-token-a'));
    expect(requests.map((r) => r.url)).toEqual(['/api/community-posts?id=b']);

    await settle(() => requests[0].resolve(okResponse({ post: makePost('b', 'Post B'), replies: [] })));
    expect(screen.getByRole('heading', { name: 'Post B' })).toBeInTheDocument();
  });
});

describe('community reply completion lifetime', () => {
  const replyInput = () => screen.getByPlaceholderText<HTMLInputElement>('Join the conversation');
  const sendButton = () => screen.getByRole('button', { name: 'Send report' });

  /** A 글을 열고 댓글 POST 를 보낸 채(응답 보류) 둔다. requests[1] 이 그 POST. */
  async function startReplyOnA(navIds: string[] = []) {
    deferFetches();
    const user: TestUser = { getIdToken: async () => 'fixture-token' };
    state.auth = { user, loading: false, error: null };
    renderPost('/community/post/a', navIds);
    await waitFor(() => expect(requests).toHaveLength(1));
    await settle(() => requests[0].resolve(okResponse({ post: makePost('a', 'Post A'), replies: [] })));

    fireEvent.change(replyInput(), { target: { value: 'Reply on A' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].url).toBe('/api/community-post-actions');
    expect(sendButton()).toBeDisabled();
  }

  /** B 로 옮겨 로드를 끝내고 B 초안을 입력한다. requests[2] 가 B 조회. */
  async function moveToBWithDraft() {
    fireEvent.click(screen.getByRole('button', { name: 'open b' }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].url).toBe('/api/community-posts?id=b');
    await settle(() => requests[2].resolve(okResponse({ post: makePost('b', 'Post B'), replies: [makeReply('rb', 'Reply on B')] })));
    fireEvent.change(replyInput(), { target: { value: 'Draft for B' } });
  }

  function expectBUntouched() {
    expect(requests).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Post B' })).toBeInTheDocument();
    expect(screen.getByText('Reply on B')).toBeInTheDocument();
    expect(screen.queryByTestId('community-post-loading')).not.toBeInTheDocument();
    expect(replyInput().value).toBe('Draft for B');
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByText('Could not send your reply. Try again.')).not.toBeInTheDocument();
    expect(screen.queryByText('Your post is being reviewed for safety and will appear once approved.')).not.toBeInTheDocument();
  }

  it('ignores an older reply success that lands after moving to another post', async () => {
    await startReplyOnA(['b']);
    await moveToBWithDraft();
    expect(sendButton()).toBeEnabled();

    await settle(() => requests[1].resolve(okResponse({ status: 'published' })));
    expectBUntouched();
  });

  it('ignores an older reply failure that lands after moving to another post', async () => {
    await startReplyOnA(['b']);
    await moveToBWithDraft();

    await settle(() => requests[1].reject(new Error('fixture-network')));
    expectBUntouched();
  });

  it('still clears the reply and refreshes the same post when the reply completes in place', async () => {
    await startReplyOnA();

    await settle(() => requests[1].resolve(okResponse({ status: 'published' })));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].url).toBe('/api/community-posts?id=a');

    await settle(() => requests[2].resolve(okResponse({ post: makePost('a', 'Post A'), replies: [makeReply('ra', 'Reply on A')] })));
    expect(screen.getByText('Reply on A')).toBeInTheDocument();
    expect(replyInput().value).toBe('');
    expect(sendButton()).toBeDisabled();
    expect(screen.queryByText('Could not send your reply. Try again.')).not.toBeInTheDocument();
  });
});
