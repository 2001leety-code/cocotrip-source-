// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/posthog', () => ({
  track: vi.fn(() => Promise.resolve()),
}));

describe('blog outbound click tracking', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST');
    // 2026-07-30: GA4 전송은 쿠키 동의(accepted) 가 전제 조건 — 없으면 no-op 이 정상이다.
    localStorage.setItem('cocotrip_cookie_consent', 'accepted');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('tracks a Blogger link once even when initialization runs twice', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    const { initBlogTracking } = await import('../../src/lib/analytics');
    initBlogTracking();
    initBlogTracking();

    const link = document.createElement('a');
    link.href = 'https://cocotripkr.blogspot.com/2026/07/example.html';
    link.textContent = 'Read the Korea travel guide';
    link.addEventListener('click', (event) => event.preventDefault());
    document.body.appendChild(link);

    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith('event', 'blog_click', expect.objectContaining({
      page_path: '/',
      target_url: link.href,
      link_text: 'Read the Korea travel guide',
    }));
  });
});
