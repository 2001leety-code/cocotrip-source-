// @vitest-environment jsdom
//
// GA4 동의 대기열 × **실제 앱 부팅 순서** 잠금 (2026-08-08).
//
// 🔴 잠근 사고: 대기열을 **GA 가 켜지기 전에** 비웠다.
//   `src/main.tsx` 는 이 순서로 뜬다.
//     ① `import { initGA } from './lib/analytics'` — analytics **모듈 본문**이 동의 구독을
//        건다. 그 구독 안에 대기열 flush(`drainPending('ga4')`)가 있다.
//     ② 그 **뒤에** main.tsx 가 "수락하면 `initGA()`" 구독을 건다.
//   첫 방문자가 배너에서 수락하면 등록 순서대로 ①이 먼저 돈다. 그런데 그 시점엔 아직
//   `window.gtag` 가 없다(②가 아직 안 돌았으므로). `drainPending` 은 큐를 **꺼내면서 비우고**,
//   꺼낸 이벤트는 `canSendToGA()` 가 false 라 한 건도 못 나간다 — 되돌릴 큐도 이미 없다.
//   → 첫 방문자의 랜딩 `page_view` 와 그 전에 쌓인 일반 GA 이벤트가 통째로 유실.
//
// 🔴 왜 기존 잠금이 못 잡았나: `tests/unit/analytics-consent-queue.test.ts` 는 `beforeEach`
//   에서 `window.gtag` 를 **미리 꽂아 둔다**("gtag 가 있어야 canSendToGA 가 통과한다").
//   그 한 줄이 부팅 순서를 가려, 대기열 계약은 잠갔지만 이 결함은 통과시켰다.
//   여기서는 gtag 를 넣지 않는다 — `initGA()` 가 만들게 하고, 도착 확인은 gtag.js 가 실제로
//   읽는 `window.dataLayer` 로 한다(모킹한 도착지가 아니라 진짜 배선).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const GA_ID = 'G-TESTONLY';

// `vi.resetModules()` 는 새 모듈 인스턴스를 주지만 **이전 인스턴스가 window 에 걸어 둔 동의
// 구독은 그대로 남는다**(모듈만 새것, DOM 은 파일 단위 공유). 남으면 옛 인스턴스의 flush 가
// 먼저 돌며 `window.gtag` 를 만들어 **이 파일이 재현하려는 순서 자체를 가린다.**
// → 테스트마다 등록된 리스너를 기록했다가 끝나면 전부 뗀다
//   (tests/unit/consent-analytics-gate.test.ts 와 같은 방식).
const addedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
let realAddEventListener: typeof window.addEventListener;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', GA_ID);
  window.localStorage.clear();
  window.sessionStorage.clear();
  // 🔴 이 파일의 핵심 — gtag 를 미리 넣지 않는다. `initGA()` 가 만들어야 한다.
  delete (window as unknown as Record<string, unknown>).gtag;
  delete (window as unknown as Record<string, unknown>).dataLayer;
  delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`];
  document.head.innerHTML = '';
  window.history.replaceState({}, '', '/');
  Object.defineProperty(document, 'referrer', { configurable: true, get: () => '' });

  addedListeners.length = 0;
  realAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = ((type: string, handler: EventListenerOrEventListenerObject, opts?: unknown) => {
    addedListeners.push([type, handler]);
    return realAddEventListener(type, handler, opts as AddEventListenerOptions);
  }) as typeof window.addEventListener;
});

afterEach(() => {
  for (const [type, handler] of addedListeners) window.removeEventListener(type, handler);
  window.addEventListener = realAddEventListener;
  vi.unstubAllEnvs();
});

/**
 * `src/main.tsx` 의 부팅을 그대로 재현한다. **순서가 이 파일의 전부다** — 바꾸면 결함이
 * 재현되지 않는다.
 *   ① analytics 모듈 import → 모듈 본문이 동의 구독(대기열 flush 포함)을 먼저 건다.
 *   ② main.tsx 63~75 와 동일하게, 그 뒤에 `initGA()` 를 부를 구독을 건다.
 */
async function bootLikeApp() {
  const consent = await import('../../src/lib/consent');
  const analytics = await import('../../src/lib/analytics');   // ← ① 여기서 구독 등록
  const queue = await import('../../src/lib/analyticsQueue');
  if (consent.hasAnalyticsConsent()) {                          // ← ② main.tsx 와 같은 모양
    analytics.initGA();
  } else {
    const stop = consent.onConsentChange((state) => {
      if (state !== 'accepted') return;
      stop();
      analytics.initGA();
    });
  }
  return { ...consent, ...analytics, ...queue };
}

/** gtag.js 가 실제로 읽는 큐 — `initGA` 가 만든 gtag 는 여기에 arguments 를 push 한다. */
function dataLayerCommands(): unknown[][] {
  const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
  return dl.map((a) => Array.from(a as ArrayLike<unknown>));
}
function gaEvents(): Array<{ name: string; props: Record<string, unknown> }> {
  return dataLayerCommands()
    .filter((c) => c[0] === 'event')
    .map((c) => ({ name: String(c[1]), props: (c[2] || {}) as Record<string, unknown> }));
}
function gaConfigs(): unknown[][] {
  return dataLayerCommands().filter((c) => c[0] === 'config');
}
function gtagScriptCount(): number {
  return document.querySelectorAll('script[src*="googletagmanager"]').length;
}

describe('첫 방문자 — GA 가 준비된 뒤에만 대기열을 비운다', () => {
  it('🔴 수락하면 대기하던 page_view·일반 이벤트가 실제로 GA 로 나간다', async () => {
    const m = await bootLikeApp();
    expect(window.gtag, '동의 전엔 GA 가 꺼져 있다').toBeUndefined();

    m.trackPageView('/planner');
    m.trackEvent('promo_view', { placement: 'top_banner' });
    expect(m.pendingCount('ga4'), '동의 전엔 담긴다').toBe(2);

    m.setConsent('accepted');

    // 🔴 수정 전: flush 구독이 main.tsx 의 initGA 보다 먼저 돌아 window.gtag 가 없었다 →
    //   drainPending 이 큐를 비운 뒤 canSendToGA() 가 false 라 2건 모두 조용히 사라졌다.
    expect(gaEvents().map((e) => e.name)).toEqual(['page_view', 'promo_view']);
    expect(m.pendingCount('ga4')).toBe(0);
  });

  it('page_view 는 담을 때 캡처한 page_path·page_location·page_referrer 그대로 나간다', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      get: () => 'https://ads.example.com/land?click=abc',
    });
    const m = await bootLikeApp();
    window.history.replaceState({}, '', '/planner');

    m.trackPageView('/planner');
    window.history.replaceState({}, '', '/tours');   // 수락 시점엔 이미 다른 화면
    m.setConsent('accepted');

    const pv = gaEvents().find((e) => e.name === 'page_view');
    expect(pv, 'page_view 가 나가야 한다').toBeDefined();
    expect(pv!.props.page_path, '담을 때의 경로').toBe('/planner');
    expect(String(pv!.props.page_location), '캡처 시점 location 유지').toContain('/planner');
    expect(String(pv!.props.page_location)).not.toContain('/tours');
    expect(pv!.props.page_referrer, '레퍼러도 담을 때 값').toBe('https://ads.example.com/land');
  });

  it('대기하던 일반 이벤트의 속성이 보존된다', async () => {
    const m = await bootLikeApp();
    m.trackEvent('promo_view', { placement: 'top_banner' });

    m.setConsent('accepted');

    const ev = gaEvents().find((e) => e.name === 'promo_view');
    expect(ev, '일반 이벤트도 나가야 한다').toBeDefined();
    expect(ev!.props.placement).toBe('top_banner');
  });

  it('flush 신호가 둘이어도(동의 구독 + initGA 끝) 스크립트·config·이벤트는 각각 1회', async () => {
    const m = await bootLikeApp();
    m.trackEvent('promo_view', { placement: 'top_banner' });

    m.setConsent('accepted');

    expect(gtagScriptCount(), 'gtag.js 스크립트 1장').toBe(1);
    expect(gaConfigs(), 'config 1회 — _initialized 가 중복 초기화를 막는다').toHaveLength(1);
    // drainPending 이 꺼내면서 비우므로 나중에 오는 신호는 빈 큐를 본다.
    expect(gaEvents().filter((e) => e.name === 'promo_view'), '이중 전송 금지').toHaveLength(1);
  });

  it('🔴 동의는 있는데 GA 가 아직 안 켜진 순간의 이벤트도 버리지 않는다', async () => {
    // 같은 뿌리의 형제 구멍: 동의 구독은 등록 순서대로 도는데, analytics 보다 뒤·main.tsx 보다
    // 앞에 등록된 구독(예: affiliateTracking)이 수락 순간 발화하면 동의는 true 인데 gtag 가
    // 없다. 예전 코드는 그 경우 담지도 않고 `canSendToGA()` false 로 그냥 버렸다.
    window.localStorage.setItem('cocotrip_cookie_consent', 'accepted');
    const consent = await import('../../src/lib/consent');
    const analytics = await import('../../src/lib/analytics');
    const queue = await import('../../src/lib/analyticsQueue');
    expect(consent.hasAnalyticsConsent()).toBe(true);
    expect(window.gtag, '아직 initGA 전').toBeUndefined();

    analytics.trackPageView('/planner');
    analytics.trackEvent('promo_view', { placement: 'top_banner' });
    expect(queue.pendingCount('ga4'), '버리지 말고 담아 둬야 한다').toBe(2);

    analytics.initGA();   // main.tsx 가 이제 GA 를 켠다

    expect(gaEvents().map((e) => e.name)).toEqual(['page_view', 'promo_view']);
    expect(queue.pendingCount('ga4')).toBe(0);
  });
});

describe('나머지 동의 경로 회귀', () => {
  it('이미 동의한 재방문자: 부팅 즉시 GA 가 켜지고 대기열을 거치지 않는다', async () => {
    window.localStorage.setItem('cocotrip_cookie_consent', 'accepted');
    const m = await bootLikeApp();
    expect(window.gtag, '부팅 시 이미 켜져 있어야 한다').toBeTypeOf('function');

    m.trackPageView('/guide');
    m.trackEvent('promo_click', { placement: 'top_banner' });

    expect(gaEvents().map((e) => e.name)).toEqual(['page_view', 'promo_click']);
    expect(m.pendingCount('ga4'), '동의 상태에서는 담지 않는다').toBe(0);
  });

  it('거부(dismissed)하면 GA 를 켜지 않고 대기분도 버린다', async () => {
    const m = await bootLikeApp();
    m.trackPageView('/planner');
    m.trackEvent('promo_view', { placement: 'top_banner' });

    m.setConsent('dismissed');

    expect(window.gtag, '거부 시 GA 를 켜면 안 된다').toBeUndefined();
    expect(gtagScriptCount()).toBe(0);
    expect(dataLayerCommands(), '전송 0건').toEqual([]);
    expect(m.pendingCount('ga4')).toBe(0);
  });

  it('수락 → 철회 → 재수락: 이미 흘려보낸 이벤트를 다시 보내지 않는다', async () => {
    const m = await bootLikeApp();
    m.trackEvent('promo_view', { placement: 'top_banner' });
    m.setConsent('accepted');
    expect(gaEvents().filter((e) => e.name === 'promo_view')).toHaveLength(1);

    m.setConsent('revoked');
    m.setConsent('accepted');

    expect(gaEvents().filter((e) => e.name === 'promo_view'), '재수락이 옛 이벤트를 되살리면 안 된다')
      .toHaveLength(1);
    expect(gaConfigs(), '재수락이 config 를 다시 쏘면 안 된다').toHaveLength(1);
  });
});
