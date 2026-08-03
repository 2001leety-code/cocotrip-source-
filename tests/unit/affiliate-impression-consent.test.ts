// @vitest-environment jsdom
//
// 제휴 노출이 동의 전에 유실되던 문제 회귀 잠금 (2026-08-02).
//
// 잠근 버그: `trackAffiliateImpression` 이 "이미 봤다" 도장(sessionStorage)을 **전송보다
//   먼저** 찍었다. 쿠키 동의 배너를 누르기 전에 카드가 보이면 도장만 남고 전송은
//   `trackEvent`/`posthogTrack` 안에서 조용히 버려졌다. 게다가
//   `observeAffiliateImpression` 은 첫 노출에서 `io.disconnect()` 하므로 다시 불릴 일도
//   없어, 나중에 동의해도 그 카드는 그 세션 내내 영영 안 나갔다.
//   → 관리자 제휴 성과판의 노출이 구조적으로 0 (PostHog 에 이벤트 정의조차 없었다).
//
// 🔴 consent 모듈은 **진짜를 쓴다**. 동의 상태를 mock 으로 흉내 내면 "동의 순간 흘려보내기"
//   가 실제로 도는지 증명하지 못한다. 대신 도착지(GA4·PostHog)만 mock 해서 무엇이
//   나갔는지 센다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const gaEvents: Array<[string, unknown]> = [];
const phEvents: Array<[string, unknown]> = [];

// ⚠️ 도착지 mock 은 **실제와 같이 동의를 확인해야 한다.** 무조건 기록하는 스텁을 쓰면
//   원래 증상("도장은 찍혔는데 전송은 버려짐")이 재현되지 않아, 옛 코드로 되돌려도
//   테스트가 통과해 버린다. 실제 trackEvent 는 `canSendToGA()`, posthog track 은
//   `ensureInit()` 에서 동의가 없으면 아무것도 하지 않는다.
vi.mock('../../src/lib/analytics', async () => {
  const { hasAnalyticsConsent: consent } = await import('../../src/lib/consent');
  return {
    trackEvent: (name: string, props: unknown) => {
      if (!consent()) return false;      // 실제 canSendToGA() 와 같은 자리
      gaEvents.push([name, props]);
      return true;
    },
  };
});
vi.mock('../../src/lib/posthog', async () => {
  const { hasAnalyticsConsent: consent } = await import('../../src/lib/consent');
  return {
    track: async (name: string, props: unknown) => {
      if (!consent()) return;            // 실제 ensureInit() 와 같은 자리
      phEvents.push([name, props]);
    },
  };
});

const { setConsent, hasAnalyticsConsent } = await import('../../src/lib/consent');
const { trackAffiliateImpression, trackAffiliateClick, __testing } =
  await import('../../src/lib/affiliateTracking');

const CARD = { product: 'hotel' as const, placement: 'home_hero_cards', language: 'ko', city: 'seoul' };
const SEEN_KEY = 'aff_seen:hotel:home_hero_cards:-:seoul';

beforeEach(() => {
  gaEvents.length = 0;
  phEvents.length = 0;
  __testing.clearPendingImpressions();
  window.sessionStorage.clear();
  window.localStorage.clear();
  setConsent('revoked'); // 매 테스트를 "동의 없음" 에서 시작
  gaEvents.length = 0;
  phEvents.length = 0;
});

describe('동의 전 노출은 유실되지 않는다', () => {
  it('동의 전에는 보내지 않고, "이미 봤다" 도장도 찍지 않는다', () => {
    expect(hasAnalyticsConsent()).toBe(false);
    trackAffiliateImpression(CARD);

    expect(gaEvents).toEqual([]);
    expect(phEvents).toEqual([]);
    // 🔴 도장이 찍히면 동의 후에도 영영 안 나간다 — 이게 원래 버그였다.
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBeNull();
    expect(__testing.pendingCount()).toBe(1);
  });

  it('나중에 동의하면 대기하던 노출이 실제로 나간다', () => {
    trackAffiliateImpression(CARD);
    expect(gaEvents).toEqual([]);

    setConsent('accepted');

    expect(gaEvents).toEqual([['affiliate_impression', { product: 'hotel', placement: 'home_hero_cards', language: 'ko', city: 'seoul' }]]);
    expect(phEvents).toEqual(gaEvents);
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBe('1');
    expect(__testing.pendingCount()).toBe(0);
  });

  it('같은 카드를 여러 번 지나가도 동의 후 한 번만 나간다', () => {
    trackAffiliateImpression(CARD);
    trackAffiliateImpression(CARD);
    trackAffiliateImpression(CARD);
    expect(__testing.pendingCount()).toBe(1);

    setConsent('accepted');
    expect(gaEvents).toHaveLength(1);
  });

  it('서로 다른 카드는 각각 나간다', () => {
    trackAffiliateImpression(CARD);
    trackAffiliateImpression({ ...CARD, product: 'esim', placement: 'home_trip_essentials' });
    setConsent('accepted');

    expect(gaEvents.map((e) => (e[1] as { product: string }).product).sort()).toEqual(['esim', 'hotel']);
  });

  it('거절하면 대기분을 버리고 아무것도 보내지 않는다', () => {
    trackAffiliateImpression(CARD);
    setConsent('dismissed');

    expect(gaEvents).toEqual([]);
    expect(phEvents).toEqual([]);
    expect(__testing.pendingCount()).toBe(0);
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBeNull();
  });

  it('동의를 철회하면 그 뒤 노출은 다시 대기열로 간다', () => {
    setConsent('accepted');
    trackAffiliateImpression(CARD);
    expect(gaEvents).toHaveLength(1);

    setConsent('revoked');
    gaEvents.length = 0;
    trackAffiliateImpression({ ...CARD, product: 'flight' });
    expect(gaEvents).toEqual([]);
    expect(__testing.pendingCount()).toBe(1);
  });
});

describe('동의 후 노출은 평소대로 동작한다', () => {
  it('동의 상태면 즉시 보내고 도장을 찍는다', () => {
    setConsent('accepted');
    trackAffiliateImpression(CARD);

    expect(gaEvents).toHaveLength(1);
    expect(window.sessionStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('도장이 이미 있으면 다시 보내지 않는다 (세션 중복 방지 유지)', () => {
    setConsent('accepted');
    trackAffiliateImpression(CARD);
    gaEvents.length = 0;
    trackAffiliateImpression(CARD);

    expect(gaEvents).toEqual([]);
  });

  it('보내는 속성은 다섯 개뿐이다 — URL·이메일·uid 없음', () => {
    setConsent('accepted');
    trackAffiliateImpression({ ...CARD, linkKey: 'slot1' });
    const props = gaEvents[0][1] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['city', 'language', 'link_key', 'placement', 'product']);
  });
});

describe('클릭은 대기열을 쓰지 않는다', () => {
  it('동의 후 클릭은 그대로 나간다', () => {
    setConsent('accepted');
    trackAffiliateClick(CARD);
    expect(gaEvents).toEqual([['affiliate_click', { product: 'hotel', placement: 'home_hero_cards', language: 'ko', city: 'seoul' }]]);
  });
});
