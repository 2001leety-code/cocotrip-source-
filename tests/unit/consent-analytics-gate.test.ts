// @vitest-environment jsdom
/**
 * 분석 동의 게이트 — **실제 동작** 테스트 (2026-07-30).
 *
 * 왜 새로 쓰는가: 기존 잠금(affiliate-inventory-and-tracking.test.ts)은 소스 문자열에
 * `hasAnalyticsConsent()` 가 있는지만 봤다. 그런데 그 검사가 `if (client) return client`
 * **아래**에 있어도 문자열 검사는 통과한다. 실제로 운영에서 그 배치 때문에
 * "수락 → 철회 후에도 전송 계속" 이 남아 있었다. 그래서 SDK 를 모킹해 호출을 센다.
 *
 * 모듈 상태(client·didInit)를 쓰는 코드라 테스트마다 `vi.resetModules()` 로 새 인스턴스를
 * 받는다. consent 와 posthog 를 같은 epoch 에서 import 해야 같은 consent 인스턴스를 공유한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const KEY = 'phc_test_key';

type PhMock = {
  init: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  opt_in_capturing: ReturnType<typeof vi.fn>;
  opt_out_capturing: ReturnType<typeof vi.fn>;
};

let ph: PhMock;

vi.mock('posthog-js', () => {
  // 팩토리는 모듈 등록 시점마다 재실행되지 않으므로, 항상 최신 `ph` 를 가리키도록 게터로 위임.
  const proxy = {
    init: (...a: unknown[]) => ph.init(...a),
    capture: (...a: unknown[]) => ph.capture(...a),
    identify: (...a: unknown[]) => ph.identify(...a),
    reset: (...a: unknown[]) => ph.reset(...a),
    opt_in_capturing: (...a: unknown[]) => ph.opt_in_capturing(...a),
    opt_out_capturing: (...a: unknown[]) => ph.opt_out_capturing(...a),
  };
  return { default: proxy };
});

function freshPh(): PhMock {
  return {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  };
}

/** 모듈 새 인스턴스 한 쌍 — 반드시 같은 resetModules epoch 에서 받아야 상태를 공유한다. */
async function loadModules() {
  vi.resetModules();
  const consent = await import('@/lib/consent');
  const posthog = await import('@/lib/posthog');
  return { consent, posthog };
}

/**
 * `vi.resetModules()` 는 새 모듈 인스턴스를 주지만, **이전 인스턴스가 window 에 걸어 둔
 * 동의 구독 리스너는 그대로 남는다**(모듈만 새것, DOM 은 파일 단위로 공유). 그러면 다음
 * 테스트의 `setConsent` 한 번에 옛 인스턴스들까지 반응해 호출 횟수가 부풀려진다.
 * → 테스트마다 등록된 리스너를 기록해 두고 끝나면 전부 떼어 낸다.
 */
const addedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
let realAddEventListener: typeof window.addEventListener;

beforeEach(() => {
  ph = freshPh();
  vi.stubEnv('VITE_POSTHOG_KEY', KEY);
  window.localStorage.clear();

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

describe('PostHog 동의 게이트 — SDK 실동작', () => {
  it('unset(최초 방문): track 해도 init·capture 0건', async () => {
    const { posthog } = await loadModules();
    await posthog.track('plan_generated');
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it('dismissed(닫기): init·capture 0건 — 닫기는 거부', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('dismissed');
    await posthog.track('plan_generated');
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it('accepted: init 1회 + capture 전송', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('plan_generated', { days: 3 });
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.init.mock.calls[0][0]).toBe(KEY);
    expect(ph.capture).toHaveBeenCalledWith('plan_generated', { days: 3 });
  });

  it('accepted 이후 revoke: opt_out + reset 으로 이미 켜진 SDK 를 끈다', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('plan_generated');
    consent.setConsent('revoked');
    expect(ph.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(ph.reset).toHaveBeenCalledTimes(1);
  });

  it('revoke 후 track·identify: 전송 0건 (저장된 client 를 재사용하지 않는다)', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('plan_generated');
    expect(ph.capture).toHaveBeenCalledTimes(1);

    consent.setConsent('revoked');
    ph.capture.mockClear();
    ph.identify.mockClear();

    await posthog.track('payment_completed');
    await posthog.identify('uid-1');

    expect(ph.capture).not.toHaveBeenCalled();
    expect(ph.identify).not.toHaveBeenCalled();
  });

  it('dismissed 로 바뀐 경우도 revoke 와 동일하게 전송 중단', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('plan_generated');
    consent.setConsent('dismissed');
    ph.capture.mockClear();
    await posthog.track('plan_downloaded');
    expect(ph.capture).not.toHaveBeenCalled();
    expect(ph.opt_out_capturing).toHaveBeenCalled();
  });

  it('revoke 후 재수락: init 을 두 번 부르지 않고 opt_in 으로 되돌린다', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('plan_generated');
    consent.setConsent('revoked');
    ph.opt_in_capturing.mockClear();

    consent.setConsent('accepted');
    await posthog.track('plan_downloaded');

    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledWith('plan_downloaded', undefined);
  });

  it('localStorage 가 막혀도(setItem throw) 이번 세션 동의가 적용된다', async () => {
    const { consent, posthog } = await loadModules();
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockReturnValue(null);

    consent.setConsent('accepted');
    expect(consent.hasAnalyticsConsent()).toBe(true);
    await posthog.track('plan_generated');
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledTimes(1);

    setItem.mockRestore();
    getItem.mockRestore();
  });

  it('동시 track 다발: init 1회만 (중복 초기화 없음)', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await Promise.all([
      posthog.track('plan_generated'),
      posthog.track('plan_downloaded'),
      posthog.track('transit_clicked'),
      posthog.identify('uid-1'),
    ]);
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledTimes(3);
    expect(ph.identify).toHaveBeenCalledTimes(1);
  });

  it('reset(): SDK 미로드 상태에서 SDK 를 켜지 않는다', async () => {
    const { posthog } = await loadModules();
    await posthog.reset();
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.reset).not.toHaveBeenCalled();
  });

  it('reset(): 로드된 SDK 는 신원만 지운다', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('plan_generated');
    await posthog.reset();
    expect(ph.reset).toHaveBeenCalledTimes(1);
  });

  it('bootPostHog(): 동의 없으면 SDK 를 켜지 않는다', async () => {
    const { posthog } = await loadModules();
    posthog.bootPostHog();
    await Promise.resolve();
    await Promise.resolve();
    expect(ph.init).not.toHaveBeenCalled();
  });

  it('KEY 미설정: 수락해도 SDK 를 켜지 않는다', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('plan_generated');
    expect(ph.init).not.toHaveBeenCalled();
  });

  it('PII 필드는 capture 속성에서 제거된다', async () => {
    const { consent, posthog } = await loadModules();
    consent.setConsent('accepted');
    await posthog.track('payment_started', { email: 'a@b.c', product: 'charter' });
    expect(ph.capture).toHaveBeenCalledWith('payment_started', { product: 'charter' });
  });
});

describe('consent 상태 계약', () => {
  it('accepted 만 분석 허용', async () => {
    const { consent } = await loadModules();
    expect(consent.hasAnalyticsConsent()).toBe(false);       // unset
    consent.setConsent('dismissed');
    expect(consent.hasAnalyticsConsent()).toBe(false);
    consent.setConsent('revoked');
    expect(consent.hasAnalyticsConsent()).toBe(false);
    consent.setConsent('accepted');
    expect(consent.hasAnalyticsConsent()).toBe(true);
  });

  it('구독자는 이벤트 detail 로 상태를 받는다 (저장소 재읽기에 의존하지 않음)', async () => {
    const { consent } = await loadModules();
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(window.localStorage, 'getItem').mockReturnValue(null);
    const seen: string[] = [];
    const stop = consent.onConsentChange((s) => seen.push(s));
    consent.setConsent('accepted');
    consent.setConsent('revoked');
    stop();
    consent.setConsent('accepted');   // 해제 후에는 안 들어와야 한다
    expect(seen).toEqual(['accepted', 'revoked']);
    vi.restoreAllMocks();
  });

  it('다른 탭 변경(storage 이벤트)은 저장소 값을 진실로 삼는다', async () => {
    const { consent } = await loadModules();
    consent.setConsent('accepted');
    const seen: string[] = [];
    const stop = consent.onConsentChange((s) => seen.push(s));
    window.localStorage.setItem('cocotrip_cookie_consent', 'revoked');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cocotrip_cookie_consent' }));
    stop();
    expect(seen).toEqual(['revoked']);
    expect(consent.readConsent()).toBe('revoked');
  });

  it('알 수 없는 저장값은 unset 으로 본다 (fail-closed)', async () => {
    window.localStorage.setItem('cocotrip_cookie_consent', 'yes-please');
    const { consent } = await loadModules();
    expect(consent.readConsent()).toBe('unset');
    expect(consent.hasAnalyticsConsent()).toBe(false);
  });
});

describe('GA4 동의 게이트 — 실동작', () => {
  const GA_ID = 'G-TESTID';

  beforeEach(() => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', GA_ID);
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).gtag;
    delete (window as unknown as Record<string, unknown>).dataLayer;
    delete (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`];
  });

  async function loadGA() {
    vi.resetModules();
    const consent = await import('@/lib/consent');
    const analytics = await import('@/lib/analytics');
    return { consent, analytics };
  }

  it('동의 없으면 initGA 가 gtag.js 를 넣지 않는다', async () => {
    const { analytics } = await loadGA();
    analytics.initGA();
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  it('accepted 면 gtag.js 를 넣고 이벤트를 보낸다', async () => {
    const { consent, analytics } = await loadGA();
    consent.setConsent('accepted');
    analytics.initGA();
    expect(document.querySelector('script[src*="googletagmanager"]')).not.toBeNull();
    const spy = vi.fn();
    window.gtag = spy;
    analytics.trackEvent('affiliate_click', { product: 'hotel' });
    expect(spy).toHaveBeenCalled();
  });

  it('철회하면 gtag 가 이미 있어도 전송 0건 + GA4 킬 스위치가 켜진다', async () => {
    const { consent, analytics } = await loadGA();
    consent.setConsent('accepted');
    analytics.initGA();
    const spy = vi.fn();
    window.gtag = spy;

    consent.setConsent('revoked');
    analytics.trackEvent('affiliate_click', { product: 'hotel' });
    analytics.trackPageView('/');
    analytics.trackPaidConversion({ transactionId: 'x', productType: 'charter', value: 1, currency: 'USD' });

    expect(spy).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(true);
  });

  it('재수락하면 킬 스위치가 내려간다', async () => {
    const { consent, analytics } = await loadGA();
    consent.setConsent('accepted');
    analytics.initGA();
    consent.setConsent('revoked');
    consent.setConsent('accepted');
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`]).toBe(false);
  });
});
