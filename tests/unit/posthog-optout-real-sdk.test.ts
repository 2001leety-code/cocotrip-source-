// @vitest-environment jsdom
/**
 * 동의 철회 — **진짜 posthog-js 로** 확인하는 통합 하네스 (2026-07-30, P0-3).
 *
 * 🔴 왜 새로 쓰는가: 기존 `consent-analytics-gate.test.ts` 는 SDK 를 통째로 `vi.fn()` 으로
 *   대체했다. 그러면 "우리가 어떤 메서드를 어떤 순서로 불렀나" 만 확인된다. 실제로 그 순서가
 *   **SDK 안에서 무슨 일을 하는지**는 재현되지 않는다.
 *
 *   설치된 posthog-js 1.404.0 소스를 읽어 보면 `posthog.reset()` 은 첫 줄에서
 *   `this.consent.reset()` 을 부르고, 그 구현은 opt-in/out 저장 항목을 **지운다**:
 *       reset(t){ ... if(this.consent.reset(), ...) }          // 인스턴스 reset
 *       reset(){ this.Ye.P(this.Xe, ...) }                     // consent 매니저 reset = 저장값 삭제
 *   즉 `opt_out_capturing()` → `reset()` 순서는 **방금 건 opt-out 을 스스로 지운다.**
 *   모킹 테스트는 두 호출이 다 있었다는 이유로 통과했고, 실제 상태는 opted-out 이 아니었다.
 *
 * 그래서 이 파일은 실제 SDK 를 띄우고 **SDK 자신의 상태**(`has_opted_out_capturing()`)와
 * **실제 네트워크 호출 수**를 본다. 상태가 근거고, 호출 순서는 근거가 아니다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import posthog from 'posthog-js';

const KEY = 'phc_integration_test_key';

/** SDK 가 만드는 모든 아웃바운드 요청을 센다. jsdom 은 실제로 보내지 않는다. */
let requests: string[] = [];
let realFetch: typeof globalThis.fetch;
let realSendBeacon: Navigator['sendBeacon'] | undefined;

function installNetworkSpies() {
  requests = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : String((input as Request).url));
    requests.push(url);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;

  realSendBeacon = navigator.sendBeacon;
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: (url: string) => { requests.push(String(url)); return true; },
  });

  // XHR 경로(구형 전송)도 같이 센다.
  const OriginalXHR = window.XMLHttpRequest;
  class SpyXHR extends OriginalXHR {
    open(method: string, url: string | URL, ...rest: unknown[]) {
      requests.push(String(url));
      // @ts-expect-error 가변 인자 전달
      return super.open(method, url, ...rest);
    }
    send() { /* 실제 전송은 하지 않는다 */ }
  }
  window.XMLHttpRequest = SpyXHR as unknown as typeof XMLHttpRequest;
}

function restoreNetworkSpies() {
  globalThis.fetch = realFetch;
  if (realSendBeacon) {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, writable: true, value: realSendBeacon });
  }
}

/**
 * 앱 소스에서 실제 `respect_dnt` 값을 읽어 온다.
 *
 * 이 값을 픽스처에 손으로 다시 적으면 앱만 바뀌었을 때 테스트가 조용히 옛 값을 검증한다.
 * (이 파일 자체가 "앱과 같은 설정이어야 검증이 의미 있다" 고 적어 놓고도 그걸 강제하는
 *  장치는 없었다.) 그래서 베껴 적지 않고 소스에서 뽑아 쓴다.
 */
const APP_RESPECT_DNT: boolean = (() => {
  const src = readFileSync(join(process.cwd(), 'src/lib/posthog.ts'), 'utf8');
  const m = /^\s*respect_dnt:\s*(true|false)\s*,/m.exec(src);
  if (!m) throw new Error('src/lib/posthog.ts 에서 respect_dnt 설정을 찾지 못했다');
  return m[1] === 'true';
})();

/** posthog-js 를 우리 앱과 **같은 설정으로** 띄운다. 설정이 다르면 검증이 의미가 없다. */
function initLikeApp() {
  posthog.init(KEY, {
    api_host: 'https://us.i.posthog.com',
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    respect_dnt: APP_RESPECT_DNT,
    property_denylist: ['$current_url', '$referrer', '$referring_domain', '$initial_current_url', '$initial_referrer', '$initial_referring_domain'],
  });
  posthog.opt_in_capturing({ captureEventName: false });
}

/** jsdom 의 navigator.doNotTrack 를 켰다 껐다 한다. 원복 안 하면 다음 케이스가 오염된다. */
function setDoNotTrack(value: string | null) {
  Object.defineProperty(window.navigator, 'doNotTrack', {
    configurable: true, writable: true, value,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  installNetworkSpies();
});

afterEach(() => {
  try { posthog.reset(); } catch { /* 정리 실패는 무시 */ }
  setDoNotTrack(null);   // DNT 를 켠 케이스가 다음 케이스를 오염시키지 않게
  restoreNetworkSpies();
  vi.restoreAllMocks();
});

/**
 * 🔴 2026-08-04 — `respect_dnt` 잠금.
 *
 * SDK 의 respect_dnt 는 브라우저 DNT 신호가 있으면 **배너에서 수락을 누른 방문자까지**
 * opt-out 으로 되돌린다. 우리 동의 게이트(consent.ts)는 DNT 를 읽는 코드가 0줄이라
 * 이 SDK 층을 보정하지 못했고, 그래서 "수락했는데 PostHog 에만 0건" 이 됐다.
 *
 * 여기서 잠그는 것: DNT 를 켠 상태에서도 배너 수락이 이기고 이벤트가 실제로 나간다.
 * 값이 조용히 true 로 되돌아가면 이 테스트가 먼저 깨진다.
 */
describe('respect_dnt — 동의의 권위는 배너다', () => {
  it('앱이 respect_dnt 를 끈 상태다 (이 파일의 전제)', () => {
    expect(
      APP_RESPECT_DNT,
      'src/lib/posthog.ts 가 respect_dnt 를 다시 켰다 — 배너 수락자의 이벤트가 또 사라진다',
    ).toBe(false);
  });

  it('DNT 를 켜도 배너 수락이 이긴다', () => {
    setDoNotTrack('1');
    initLikeApp();
    expect(
      posthog.has_opted_out_capturing(),
      'DNT 가 켜져 있어도 배너 수락 후에는 opted-out 이 아니어야 한다',
    ).toBe(false);
  });

  // 🔴 위 테스트가 헛돌지 않는다는 증거. jsdom 에서 DNT 신호가 SDK 에 안 잡히면
  //   위 단언은 아무것도 검증하지 않고 통과한다. 같은 인스턴스에서 플래그만 되돌려
  //   **실제로 opted-out 으로 뒤집히는 것**을 확인한다.
  it('같은 상황에서 respect_dnt 를 켜면 opted-out 으로 뒤집힌다 (테스트 유효성 증명)', () => {
    setDoNotTrack('1');
    initLikeApp();
    expect(posthog.has_opted_out_capturing()).toBe(false);

    posthog.set_config({ respect_dnt: true });
    expect(
      posthog.has_opted_out_capturing(),
      'respect_dnt=true 면 수락을 눌렀어도 SDK 가 opted-out 으로 본다 — 이것이 손님 이벤트가 사라지던 이유',
    ).toBe(true);

    posthog.set_config({ respect_dnt: false });
    expect(posthog.has_opted_out_capturing()).toBe(false);
  });

  it('DNT 가 없을 때와 결과가 같다 (DNT 가 더는 분기를 만들지 않는다)', () => {
    setDoNotTrack(null);
    initLikeApp();
    expect(posthog.has_opted_out_capturing()).toBe(false);
  });

  it('DNT 와 무관하게, 철회하면 여전히 막힌다', () => {
    setDoNotTrack('1');
    initLikeApp();
    posthog.set_config({ advanced_disable_flags: true });
    posthog.reset();
    posthog.opt_out_capturing();
    expect(posthog.has_opted_out_capturing()).toBe(true);

    const before = requests.length;
    posthog.capture('should_not_send');
    expect(requests.length, '철회 후에는 전송이 없어야 한다').toBe(before);
  });
});

describe('posthog-js 1.404.0 — 철회 순서의 실제 효과', () => {
  it('🔴 옛 순서(opt_out → reset)는 opt-out 이 지워진다 — 이 테스트가 버그를 재현한다', () => {
    initLikeApp();
    expect(posthog.has_opted_out_capturing()).toBe(false);

    posthog.opt_out_capturing();
    expect(posthog.has_opted_out_capturing()).toBe(true);   // 여기까지는 맞다

    posthog.reset();                                        // ← 여기서 동의 저장값이 삭제된다
    expect(
      posthog.has_opted_out_capturing(),
      'reset() 이 consent 저장값을 지우므로 opt-out 이 풀린다 (이것이 P0-3 의 근본 원인)',
    ).toBe(false);
  });

  it('✅ 새 순서(reset → opt_out)는 최종 상태가 opted-out 으로 남는다', () => {
    initLikeApp();

    // lib/posthog.ts 의 applyConsent 와 동일한 순서
    posthog.set_config({ advanced_disable_flags: true });
    posthog.reset();
    posthog.opt_out_capturing();

    expect(posthog.has_opted_out_capturing()).toBe(true);
    expect(posthog.has_opted_in_capturing()).toBe(false);
  });

  it('철회 후에는 capture 가 네트워크를 만들지 않는다', () => {
    initLikeApp();
    posthog.set_config({ advanced_disable_flags: true });
    posthog.reset();
    posthog.opt_out_capturing();

    requests.length = 0;
    posthog.capture('plan_generated', { days: 3 });
    posthog.capture('$pageview', { page_path: '/planner' });

    expect(requests, `철회 후 전송 시도: ${requests.join(', ')}`).toHaveLength(0);
  });

  it('철회 후 pagehide·visibilitychange·beforeunload 에도 전송 0건', () => {
    initLikeApp();
    posthog.set_config({ advanced_disable_flags: true });
    posthog.reset();
    posthog.opt_out_capturing();

    requests.length = 0;
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('unload'));

    expect(requests, `종료 시점 전송 시도: ${requests.join(', ')}`).toHaveLength(0);
  });

  it('자동 pageview/pageleave 를 끄면 history 이동에도 이벤트가 생기지 않는다', () => {
    initLikeApp();
    requests.length = 0;
    window.history.pushState({}, '', '/planner?token=secret-share-token');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new Event('pagehide'));

    const leaked = requests.filter((u) => u.includes('secret-share-token'));
    expect(leaked, `쿼리스트링이 실린 요청: ${leaked.join(', ')}`).toHaveLength(0);
  });
});
