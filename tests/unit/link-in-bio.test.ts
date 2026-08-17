import { describe, expect, it } from 'vitest';

import { buildLinkHubDestination } from '@/lib/linkInBio';

describe('buildLinkHubDestination', () => {
  it('들어온 UTM 을 그대로 물고 넘긴다', () => {
    const href = buildLinkHubDestination(
      '/planner',
      '?utm_source=instagram&utm_medium=bio&utm_campaign=danyang-split-route',
      'planner',
    );
    const url = new URL(href, 'https://cocotripkr.com');

    expect(url.pathname).toBe('/planner');
    expect(url.searchParams.get('utm_source')).toBe('instagram');
    expect(url.searchParams.get('utm_medium')).toBe('bio');
    expect(url.searchParams.get('utm_campaign')).toBe('danyang-split-route');
  });

  it('누른 버튼이 utm_content 로 남는다 — 허브의 존재 이유', () => {
    const href = buildLinkHubDestination('/tours', '?utm_source=tiktok', 'tours');
    expect(new URL(href, 'https://cocotripkr.com').searchParams.get('utm_content')).toBe('tours');
  });

  it('들어온 utm_content 가 있어도 버튼 값이 이긴다', () => {
    const href = buildLinkHubDestination('/charter', '?utm_content=from-caption', 'charter');
    expect(new URL(href, 'https://cocotripkr.com').searchParams.get('utm_content')).toBe('charter');
  });

  it('추적값 없이 들어와도 집계에서 사라지지 않는다', () => {
    const url = new URL(buildLinkHubDestination('/planner', '', 'planner'), 'https://cocotripkr.com');
    expect(url.searchParams.get('utm_source')).toBe('link_in_bio');
    expect(url.searchParams.get('utm_medium')).toBe('bio');
  });

  it('추적 외 파라미터는 넘기지 않는다', () => {
    const url = new URL(
      buildLinkHubDestination('/planner', '?utm_source=instagram&next=/admin&token=abc', 'planner'),
      'https://cocotripkr.com',
    );
    expect(url.searchParams.get('next')).toBeNull();
    expect(url.searchParams.get('token')).toBeNull();
  });

  it('빈 값은 무시하고 기본값으로 채운다', () => {
    const url = new URL(
      buildLinkHubDestination('/planner', '?utm_source=&utm_medium=%20', 'planner'),
      'https://cocotripkr.com',
    );
    expect(url.searchParams.get('utm_source')).toBe('link_in_bio');
    expect(url.searchParams.get('utm_medium')).toBe('bio');
  });
});
