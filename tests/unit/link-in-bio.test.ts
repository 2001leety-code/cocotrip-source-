import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildLinkHubDestination, isLinkHubPath } from '@/lib/linkInBio';

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

describe('isLinkHubPath', () => {
  it('허브 경로만 참이다', () => {
    expect(isLinkHubPath('/links')).toBe(true);
    expect(isLinkHubPath('/planner')).toBe(false);
    expect(isLinkHubPath('/linkspace')).toBe(false);
  });
});

/**
 * 처음 배포된 허브는 페이지 안에 헤더·푸터를 안 그렸을 뿐, App 이 그 위에 하단탭과
 * 프로모배너를 얹었다. 숨길 자리가 App.tsx 안에서 두 군데로 갈라져 있어서 생긴 일이고,
 * 특히 프로모배너 CTA 는 UTM 없이 /planner 로 보내 허브의 목적을 정면으로 깼다.
 * 한쪽만 고치는 재발을 막으려고 **두 마운트 지점 모두**를 원본으로 잠근다.
 */
describe('허브에서는 전역 chrome 을 렌더하지 않는다', () => {
  const APP = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/App.tsx'),
    'utf8',
  );

  it('하단탭·쿠폰모달 게이트(GlobalWidgets)가 허브를 포함한다', () => {
    expect(APP).toMatch(/const isBareLanding = isSharedPlan \|\| isCommunity \|\| isLinkHub/);
    expect(APP).toMatch(/\{!isBareLanding && <MobileBottomNav \/>\}/);
    expect(APP).toMatch(/\{!isBareLanding && <OnboardingCouponModal \/>\}/);
  });

  it('프로모배너 게이트(NonMoodChrome)도 허브를 포함한다', () => {
    const nonMood = APP.slice(APP.indexOf('function NonMoodChrome'));
    expect(nonMood.slice(0, nonMood.indexOf('return null'))).toContain('isLinkHubPath');
  });

  it('쿠키배너는 GDPR 이라 허브에서도 유지한다', () => {
    expect(APP).toMatch(/<CookieBanner \/>/);
    expect(APP).not.toMatch(/isBareLanding && <CookieBanner/);
  });
});
