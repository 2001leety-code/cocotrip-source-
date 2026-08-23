// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { usePageMeta } from '../../src/hooks/usePageMeta';

const base = {
  title: 'Guide',
  description: 'Guide description',
  ogUrl: 'https://cocotripkr.com/guide/example',
};

afterEach(() => {
  cleanup();
  document.head.querySelector('meta[name="cocotrip:content-sha256"]')?.remove();
  document.head.querySelector('meta[name="robots"]')?.remove();
});

describe('usePageMeta Brain projection hash', () => {
  it('유효한 hash를 운영 검증용 meta로 노출한다', () => {
    const hash = 'a'.repeat(64);
    renderHook(() => usePageMeta({ ...base, contentSha256: hash }));
    expect(document.head.querySelector('meta[name="cocotrip:content-sha256"]')?.getAttribute('content'))
      .toBe(hash);
  });

  it('legacy/다른 라우트로 바뀌면 이전 hash meta를 제거한다', () => {
    const hash = 'b'.repeat(64);
    const props: { contentSha256?: string } = { contentSha256: hash };
    const { rerender } = renderHook(() => usePageMeta({ ...base, contentSha256: props.contentSha256 }));
    expect(document.head.querySelector('meta[name="cocotrip:content-sha256"]')).not.toBeNull();

    props.contentSha256 = undefined;
    rerender();
    expect(document.head.querySelector('meta[name="cocotrip:content-sha256"]')).toBeNull();
  });

  it('형식이 틀린 hash는 meta와 JSON-LD 식별자로 승격하지 않는다', () => {
    renderHook(() => usePageMeta({ ...base, contentSha256: 'not-a-hash' }));
    expect(document.head.querySelector('meta[name="cocotrip:content-sha256"]')).toBeNull();
  });

  it('page-state robots override를 표시하고 unmount 때 marker를 지운다', () => {
    const previous = document.createElement('meta');
    previous.name = 'robots';
    previous.content = 'index, follow';
    document.head.appendChild(previous);
    const { unmount } = renderHook(() => usePageMeta({
      ...base,
      robots: 'noindex, nofollow',
    }));
    const robots = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement;
    expect(robots.content).toBe('noindex, nofollow');
    expect(robots.dataset.pageMetaRobotsOverride).toMatch(/^page-meta-\d+$/);

    unmount();
    expect(robots.content).toBe('index, follow');
    expect(robots.dataset.pageMetaRobotsOverride).toBeUndefined();
  });

  it('같은 detail의 error/loading noindex가 ready index로 바뀌고 cleanup은 이전 route 값을 복원한다', () => {
    const previous = document.createElement('meta');
    previous.name = 'robots';
    previous.content = 'index, follow';
    document.head.appendChild(previous);
    const state: { robots: 'index, follow' | 'noindex, nofollow' } = { robots: 'noindex, nofollow' };
    const { rerender, unmount } = renderHook(() => usePageMeta({ ...base, robots: state.robots }));
    expect(previous.content).toBe('noindex, nofollow');

    state.robots = 'index, follow';
    rerender();
    expect(previous.content).toBe('index, follow');
    expect(previous.dataset.pageMetaRobotsOverride).toMatch(/^page-meta-\d+$/);

    unmount();
    expect(previous.content).toBe('index, follow');
    expect(previous.dataset.pageMetaRobotsOverride).toBeUndefined();
  });
});
