// @vitest-environment jsdom
/**
 * 라우트 전환 회귀 잠금 (2026-08-02).
 *
 * 잠근 버그: App.tsx 라우트 전환부가 framer-motion `AnimatePresence mode="wait"` 였을 때,
 *   다음 페이지 mount 가 "이전 페이지 exit 애니메이션 완료" 에 묶여 있었다. 그 완료 신호는
 *   requestAnimationFrame 으로만 온다 → 백그라운드/비가시 탭에서는 rAF 가 안 돌아
 *   URL 만 바뀌고 화면은 이전 페이지에 영원히 멈춘다(에러 없음).
 *   /community → /community/new 에서 발견됐지만 커뮤니티 전용 문제가 아니라 전 라우트 문제였다.
 *
 * 그래서 이 테스트는 rAF 를 죽인 상태(= 백그라운드 탭)로 렌더한다.
 * vi.hoisted 로 import 보다 먼저 죽인다 — 애니메이션 라이브러리가 모듈 로드 시점에
 * 전역 rAF 를 캡처하는 경우까지 덮기 위해(누가 mode="wait" 를 되살려도 잡히게).
 */
import React, { Suspense, lazy } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
});

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: {}, changeLanguage: () => {} }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
// useAuth / authFetch / storage-upload 는 @/lib/firebase 를 끌고 오므로 mock (로그인 없는 게스트 상태).
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ posts: [] }) })) }));
vi.mock('@/lib/storage-upload', () => ({ uploadCommunityPhoto: vi.fn() }));
// 2026-08-02: 커뮤니티 화면이 분석 모듈(analytics → posthog → consent → analyticsProps)을
// 직접 쓰게 되면서 이 테스트의 lazy import 경로에 실제 분석 스택이 딸려 들어왔다.
// 라우트 전환 테스트가 진짜 분석 초기화를 돌릴 이유가 없고(위 firebase mock 과 같은 이유),
// 전체 스위트를 함께 돌릴 때 이 모듈들 변환 시간이 아래 **setup 대기**를 1초 넘겨 실패시켰다.
// ⚠️ 잠금 대상(클릭 직후 동기 검사)은 그대로다 — 여기서 줄인 건 준비 단계 비용뿐.
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { RouteTransition } from '../../src/components/RouteTransition';

// App.tsx 와 같은 모양: 형제 커뮤니티 화면 전부가 **같은 모듈**을 가리키는 lazy 래퍼.
const CommunityPage = lazy(() => import('../../src/pages/CommunityPage'));
const CommunityComposePage = lazy(() =>
  import('../../src/pages/CommunityPage').then((m) => ({ default: m.CommunityComposePage })),
);
const CommunityPostPage = lazy(() =>
  import('../../src/pages/CommunityPage').then((m) => ({ default: m.CommunityPostPage })),
);

// App.tsx 의 AnimatedRoutes 와 같은 모양 — `<Routes location={...}>` 로 현재 location 을
// 명시 전달하는 것까지 동일해야 한다. 이걸 빼면 mode="wait" 회귀를 놓친다:
// AnimatePresence 가 붙잡아 둔 옛 엘리먼트 안의 <Routes> 가 context 의 새 location 을
// 읽어버려서, 실제로는 화면이 멈추는데 테스트만 통과한다.
function AppRoutes() {
  const location = useLocation();
  return (
    <RouteTransition>
      <Routes location={location}>
        <Route path="/community" element={<Suspense fallback={<div>loading</div>}><CommunityPage /></Suspense>} />
        <Route path="/community/new" element={<Suspense fallback={<div>loading</div>}><CommunityComposePage /></Suspense>} />
        <Route path="/community/post/:postId" element={<Suspense fallback={<div>loading</div>}><CommunityPostPage /></Suspense>} />
      </Routes>
    </RouteTransition>
  );
}

function SiblingRoutes() {
  const location = useLocation();
  return (
    <RouteTransition>
      <Routes location={location}>
        <Route path="/alpha" element={<><h1>Alpha screen</h1><Link to="/beta">go beta</Link></>} />
        <Route path="/beta" element={<><h1>Beta screen</h1><Link to="/alpha">back alpha</Link></>} />
      </Routes>
    </RouteTransition>
  );
}

const renderSiblings = () =>
  render(<MemoryRouter initialEntries={['/alpha']}><SiblingRoutes /></MemoryRouter>);

const renderFeed = () =>
  render(<MemoryRouter initialEntries={['/community']}><AppRoutes /></MemoryRouter>);

describe('라우트 전환은 애니메이션 프레임에 의존하지 않는다 (rAF 죽은 백그라운드 탭)', () => {
  it('일반 형제 라우트 — 링크 클릭한 그 커밋에서 화면이 교체된다', () => {
    const { container } = renderSiblings();
    expect(screen.getByText('Alpha screen')).toBeTruthy();

    fireEvent.click(screen.getByText('go beta'));

    // 🔴 기다리지 않는다. 애니메이션 완료를 기다리는 구현이면 여기서 터진다.
    expect(container.textContent).toContain('Beta screen');
    expect(container.textContent).not.toContain('Alpha screen');
  });

  it('/community → /community/new — 링크 클릭 시 작성 화면으로 교체된다', async () => {
    const { container } = renderFeed();
    await waitFor(() => expect(container.querySelector('.community-intro')).toBeTruthy());

    const write = container.querySelector('a[href="/community/new"]') as HTMLAnchorElement;
    expect(write).toBeTruthy();
    fireEvent.click(write);

    // 🔴 여기서 기다리지 않는다. 클릭이 처리된 그 커밋에서 이미 피드가 내려가 있어야 한다.
    //   기다리면(waitFor) mode="wait" 회귀를 못 잡는다 — jsdom 에서는 애니메이션이
    //   결국 끝나버려서 늦게라도 교체되기 때문. 잠글 대상은 "애니메이션을 기다리는가" 자체다.
    expect(container.querySelector('.community-intro')).toBeNull();

    // 그 다음 작성 화면이 뜬다 (lazy chunk resolve 한 틱).
    await waitFor(() => expect(screen.getByText('Share with the community')).toBeTruthy());
  });

  it('/community → /community/post/:postId — 글 상세로 교체된다', async () => {
    const POST = {
      id: 'p1', title: '경복궁 같이 가실 분', body: '토요일 오전에 갑니다', lang: 'ko',
      type: 'buddy', category: 'buddies', authorName: '코코', likeCount: 0, replyCount: 0,
      createdAt: 1, translations: {},
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('id=')
        ? { ok: true, data: { post: POST, replies: [] } }
        : { ok: true, data: { posts: [POST] } }),
    })) as unknown as typeof fetch);

    const { container } = renderFeed();
    const link = await waitFor(() => {
      const a = container.querySelector('a[href="/community/post/p1"]');
      if (!a) throw new Error('post link not rendered');
      return a as HTMLAnchorElement;
    });

    fireEvent.click(link);
    expect(container.querySelector('.community-intro')).toBeNull();   // 기다리지 않는다 (위 주석)
    await waitFor(() => expect(container.querySelector('.community-detail-title')).toBeTruthy());
    vi.unstubAllGlobals();
  });

  it('첫 렌더는 fade 없음 · 이동하면 붙고 · 안전 타이머가 다시 걷어낸다', async () => {
    const { container } = renderSiblings();
    const wrapper = () => container.firstElementChild as HTMLElement;

    // 첫 로드 = fade 없음 (프리렌더 콘텐츠 깜빡임 방지 — 기존 initial={false} 동작).
    expect(wrapper().className).toBe('');

    fireEvent.click(screen.getByText('go beta'));
    expect(wrapper().className).toBe('route-fade');

    // 타임라인이 멈춘 탭(비가시·headless)에서 CSS 애니메이션이 opacity:0 첫 프레임에
    // 갇히는 것 방지 — 안전 타이머가 클래스를 걷어내 기본 opacity(1) 로 돌아와야 한다.
    await waitFor(() => expect(wrapper().className).toBe(''), { timeout: 2000 });
  });

  it('첫 경로로 되돌아와도 "첫 로드"로 오인해 fade 를 빼먹지 않는다', async () => {
    const { container } = renderSiblings();
    const wrapper = () => container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByText('go beta'));
    await waitFor(() => expect(wrapper().className).toBe(''), { timeout: 2000 });

    fireEvent.click(screen.getByText('back alpha'));
    expect(container.textContent).toContain('Alpha screen');
    expect(wrapper().className).toBe('route-fade');
  });
});

describe('fade CSS 는 콘텐츠를 숨긴 채로 끝날 수 없다', () => {
  // 타임라인이 멈춘 환경(비가시 탭·headless)에서 애니메이션이 첫 프레임(opacity:0)에
  // 갇히지 않도록: routeFade 에 to/100% 가 없어야 하고 fill-mode 도 없어야 한다.
  // 둘 중 하나라도 들어오면 "화면이 안 보인다" 버그가 CSS 로 되살아난다.
  const css = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8');

  it('@keyframes routeFade 는 from 만 가진다', () => {
    const block = css.match(/@keyframes\s+routeFade\s*\{[\s\S]*?\n\}/);
    expect(block).toBeTruthy();
    expect(block![0]).toContain('from');
    expect(block![0]).not.toMatch(/\bto\b|100%/);
  });

  it('.route-fade 는 animation-fill-mode 를 쓰지 않는다', () => {
    const block = css.match(/\.route-fade\s*\{[\s\S]*?\n\}/);
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/fill-mode|forwards|both/);
  });
});
