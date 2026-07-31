// @vitest-environment jsdom
/**
 * 분석 전송에 민감 URL·자유 입력이 실리지 않는다 (2026-07-30, P1-2).
 *
 * 🔴 고친 문제
 *   - `trackPageView(location.pathname + location.search)` — 쿼리스트링을 GA4 로 그대로 보냈다.
 *     우리 URL 쿼리에는 공유 토큰(`token`), 플래너 사전입력(`prefillHotel`·`prefillDiet`·
 *     `allergies`), 자유 입력(`revisionNote`·`freeText`)이 들어간다.
 *   - PostHog 자동 pageview/pageleave 는 `$current_url` 에 쿼리·해시를 통째로 실었다.
 *   - PII 방어가 **차단 목록**이라 나중에 생긴 필드는 그대로 통과했다 → 허용 목록으로 교체.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stripUnsafeProps,
  sanitizeCaptureProperties,
  safePagePath,
  stripUrlToPath,
  isAllowedAnalyticsKey,
  ALLOWED_PROP_KEYS,
} from '../../src/lib/analyticsProps';

const FORBIDDEN_KEYS = [
  'token', 'revisionNote', 'prefillHotel', 'prefillDiet', 'allergies', 'freeText',
  'email', 'guest_email', 'phone', 'hotel_address', 'name', 'full_name', 'uid', 'userId',
  'notes', 'memo', 'password', 'apiKey', 'idToken',
];

describe('허용 목록 — 금지 키는 목록에 없다', () => {
  for (const k of FORBIDDEN_KEYS) {
    it(`${k} 는 허용 목록에 없다`, () => {
      expect(ALLOWED_PROP_KEYS).not.toContain(k);
      expect(isAllowedAnalyticsKey(k)).toBe(false);
    });
  }

  it('실제로 쓰는 퍼널 속성은 허용된다 (측정이 조용히 죽지 않게)', () => {
    for (const k of ['page_path', 'placement', 'product', 'value', 'currency', 'language', 'utm_source']) {
      expect(isAllowedAnalyticsKey(k), `${k} 가 막히면 기존 퍼널이 빈다`).toBe(true);
    }
  });
});

describe('stripUnsafeProps — 기본 거부', () => {
  it('민감 키는 전부 제거된다', () => {
    const out = stripUnsafeProps({
      page_path: '/planner',
      token: 'share-token-abc',
      allergies: 'peanut, shellfish',
      revisionNote: '호텔을 강남으로 바꿔주세요',
      freeText: '아이가 둘이라 카시트 필요',
      prefillHotel: 'Lotte Hotel Seoul',
      prefillDiet: 'halal',
      email: 'a@b.c',
    });
    expect(out).toEqual({ page_path: '/planner' });
  });

  it('URL 값은 쿼리·해시를 잘라 경로만 남긴다', () => {
    const out = stripUnsafeProps({
      target_url: 'https://partner.example.com/book?token=abc&uid=u1#frag',
      page_path: '/s/abc?token=xyz',
    });
    expect(out!.target_url).toBe('https://partner.example.com/book');
    expect(out!.page_path).toBe('/s/abc');
  });

  it('자격증명이 박힌 URL 은 통째로 버린다', () => {
    const out = stripUnsafeProps({ target_url: 'https://user:pw@example.com/x' });
    expect(out!.target_url).toBeUndefined();
  });

  it('객체·배열은 내용 보장이 안 되므로 보내지 않는다', () => {
    const out = stripUnsafeProps({ value: 10, items_name: { nested: 'x' } as unknown as string });
    expect(out).toEqual({ value: 10 });
  });

  it('문자열은 120자로 자른다', () => {
    const out = stripUnsafeProps({ link_text: 'x'.repeat(500) });
    expect((out!.link_text as string).length).toBe(120);
  });
});

describe('safePagePath / stripUrlToPath', () => {
  it('쿼리·해시 제거', () => {
    expect(safePagePath('/planner?token=abc#top')).toBe('/planner');
    expect(stripUrlToPath('/community/post/x?y=1')).toBe('/community/post/x');
  });

  it('빈 값이면 /', () => {
    expect(safePagePath('')).toBe('/');
    expect(safePagePath(null)).toBe('/');
  });
});

describe('sanitizeCaptureProperties — PostHog before_send 용', () => {
  it('SDK 내부 속성($lib·$session_id 등)은 살린다 — 지우면 세션·중복제거가 깨진다', () => {
    const out = sanitizeCaptureProperties({
      $lib: 'web', $lib_version: '1.404.0', $session_id: 'sess-1', $insert_id: 'ins-1',
      page_path: '/tours',
    });
    expect(out.$lib).toBe('web');
    expect(out.$session_id).toBe('sess-1');
    expect(out.$insert_id).toBe('ins-1');
    expect(out.page_path).toBe('/tours');
  });

  it('$current_url·$referrer 계열은 버린다 (쿼리·해시가 통째로 들어온다)', () => {
    const out = sanitizeCaptureProperties({
      $current_url: 'https://cocotripkr.com/s/abc?token=secret',
      $referrer: 'https://google.com/search?q=private+driver+seoul',
      $referring_domain: 'google.com',
      $pathname: '/s/abc',
    });
    expect(out.$current_url).toBeUndefined();
    expect(out.$referrer).toBeUndefined();
    expect(out.$referring_domain).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('token=secret');
  });

  it('우리 속성은 허용 목록으로 다시 거른다', () => {
    const out = sanitizeCaptureProperties({ $lib: 'web', allergies: 'peanut', value: 89 });
    expect(out.allergies).toBeUndefined();
    expect(out.value).toBe(89);
  });
});

describe('GA4 전송 실동작 — 쿼리스트링 0건', () => {
  const GA_ID = 'G-TESTID';

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', GA_ID);
    // 앞 케이스가 붙인 gtag.js 태그가 남아 있으면 "동의 전엔 안 붙는다" 를 잘못 판정한다.
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).gtag;
  });

  async function loadGA() {
    vi.resetModules();
    const consent = await import('../../src/lib/consent');
    const analytics = await import('../../src/lib/analytics');
    return { consent, analytics };
  }

  it('trackPageView 는 경로만 보낸다 (page_title 도 보내지 않는다)', async () => {
    const { consent, analytics } = await loadGA();
    consent.setConsent('accepted');
    analytics.initGA();
    const spy = vi.fn();
    window.gtag = spy;

    analytics.trackPageView('/planner?token=share-secret&allergies=peanut#top');

    expect(spy).toHaveBeenCalledWith('event', 'page_view', expect.objectContaining({ page_path: '/planner' }));
    const payload = JSON.stringify(spy.mock.calls);
    expect(payload).not.toContain('share-secret');
    expect(payload).not.toContain('peanut');
    expect(payload).not.toContain('page_title');
  });

  it('trackEvent 속성에서 자유 입력·토큰이 제거된다', async () => {
    const { consent, analytics } = await loadGA();
    consent.setConsent('accepted');
    analytics.initGA();
    const spy = vi.fn();
    window.gtag = spy;

    analytics.trackEvent('promo_click', {
      placement: 'top_banner',
      target_url: 'https://cocotripkr.com/planner?revisionNote=please+change+hotel',
    } as Record<string, string>);

    const payload = JSON.stringify(spy.mock.calls);
    expect(payload).toContain('top_banner');
    expect(payload).not.toContain('revisionNote');
    expect(payload).not.toContain('change+hotel');
  });

  // 🔴 2026-08-01 Preview 실측에서 잡은 구멍. `page_path` 만 깨끗해도 gtag.js 는 `dl`(document
  //   location)·`dr`(referrer)을 **자기가** window.location.href / document.referrer 에서 채운다.
  //   이미 동의한 재방문자가 `/s/xxx?token=…` 로 바로 들어오면 그 토큰이 GA4 로 나갔다.
  //   → page_location·page_referrer 를 명시해 덮어쓴다.
  it('🔴 page_location(=dl) 에도 쿼리·해시가 없다 — gtag 자동 채움 덮어쓰기', async () => {
    const { consent, analytics } = await loadGA();
    consent.setConsent('accepted');
    window.history.replaceState({}, '', '/planner?token=share-secret&allergies=peanut#frag');
    analytics.initGA();
    const spy = vi.fn();
    window.gtag = spy;

    analytics.trackPageView();
    analytics.trackEvent('promo_click', { placement: 'top' } as Record<string, string>);

    const payload = JSON.stringify(spy.mock.calls);
    expect(payload).not.toContain('share-secret');
    expect(payload).not.toContain('peanut');
    expect(payload).not.toContain('#frag');
    for (const call of spy.mock.calls) {
      const params = call[2] as Record<string, unknown>;
      expect(params.page_location, 'page_location 미지정이면 gtag 가 원본 URL 을 쓴다').toBeTypeOf('string');
      expect(String(params.page_location)).not.toContain('?');
      expect(String(params.page_location)).not.toContain('#');
    }
    window.history.replaceState({}, '', '/');
  });

  it('page_referrer(=dr) 도 경로만 남는다', async () => {
    const { consent, analytics } = await loadGA();
    consent.setConsent('accepted');
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => 'https://cocotripkr.com/s/abc?token=leaked-token',
    });
    analytics.initGA();
    const spy = vi.fn();
    window.gtag = spy;
    analytics.trackPageView('/tours');
    const payload = JSON.stringify(spy.mock.calls);
    expect(payload).not.toContain('leaked-token');
    expect(payload).toContain('https://cocotripkr.com/s/abc');
  });

  it('동의 전에는 gtag 스크립트도 안 붙고 전송 0건', async () => {
    const { analytics } = await loadGA();
    analytics.initGA();
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(window.gtag).toBeUndefined();
  });
});

describe('App.tsx / posthog.ts 배선 잠금', () => {
  it('App 은 location.search 를 붙이지 않는다', async () => {
    const { readFileSync } = await import('fs');
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toMatch(/trackPageView\(location\.pathname \+ location\.search\)/);
    expect(app).toMatch(/trackPageView\(location\.pathname\)/);
    expect(app).toMatch(/posthogPageView\(location\.pathname\)/);
  });

  it('PostHog 는 자동 pageview·pageleave 를 끄고 before_send 로 최종 차단한다', async () => {
    const { readFileSync } = await import('fs');
    const ph = readFileSync('src/lib/posthog.ts', 'utf8');
    expect(ph).toMatch(/capture_pageview:\s*false/);
    expect(ph).toMatch(/capture_pageleave:\s*false/);
    expect(ph).toMatch(/before_send:/);
    expect(ph).toMatch(/if \(!hasAnalyticsConsent\(\)\) return null;/);
    expect(ph).toMatch(/property_denylist/);
  });
});

// 🔴 2026-08-01: 축소된 window 스텁(location 없음)에서 safePagePath 가 throw 해
//   trackPaidConversion 의 try/catch 에 삼켜지며 **결제 전환 이벤트가 통째로 사라졌다.**
//   분석 헬퍼는 어떤 환경에서도 throw 하지 않아야 한다 — 결제 경로에서 불리기 때문이다.
describe('URL 헬퍼는 축소된 환경에서도 throw 하지 않는다', () => {
  it('window.location 이 없어도 안전한 기본값', async () => {
    const props = await import('../../src/lib/analyticsProps');
    const realWindow = globalThis.window;
    try {
      // @ts-expect-error 의도적으로 location 없는 window 를 흉내낸다
      globalThis.window = { addEventListener() {}, removeEventListener() {} };
      expect(() => props.safePagePath()).not.toThrow();
      expect(props.safePagePath()).toBe('/');
      expect(() => props.safePageLocation()).not.toThrow();
      expect(props.safePageLocation()).toBe('/');
    } finally {
      globalThis.window = realWindow;
    }
  });

  it('명시 경로를 주면 window 없이도 동작', async () => {
    const props = await import('../../src/lib/analyticsProps');
    expect(props.safePagePath('/tours?x=1#y')).toBe('/tours');
  });
});
