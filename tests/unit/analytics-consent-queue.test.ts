// @vitest-environment jsdom
//
// 동의 전 이벤트 대기열 회귀 잠금 (2026-08-03).
//
// 잠근 사고: 쿠키 배너는 1.5초 뒤에 뜨는데, 첫 화면에서 자동으로 나가는 계측
//   (pageview·wizard_started·promo_view·ad_impression·plan_generated …)은 그보다 먼저
//   발화한다. 그때 전송 함수가 조용히 버렸고, 호출부 대부분은 "한 번만 보낸다" 도장을
//   전송보다 먼저 찍어 두므로 나중에 수락해도 그 세션에서 영영 안 나갔다.
//   호출부를 하나씩 고치는 방식은 두 번 실패했다(제휴 2026-08-02, 차터). 그래서
//   **보내는 지점 한 곳**에서 대기열로 막았다 — 이 테스트가 그 계약을 잠근다.
//
// 🔴 도착지(gtag)는 mock 하되 **동의 게이트는 실제 모듈**을 쓴다. 동의를 흉내 내면
//   "수락하는 순간 흘려보내기" 가 실제로 도는지 증명하지 못한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<[string, unknown]> = [];

beforeEach(() => {
  // GA 측정 ID 가 없으면 전송 함수가 애초에 아무것도 안 한다(대기열도 안 쓴다) — 실제 운영과
  // 같은 조건을 만들기 위해 스텁한다.
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TESTONLY');
  // PostHog 키도 마찬가지 — 키가 없으면 track() 이 대기열조차 안 쓰고 빠져나간다.
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_testonly');
  vi.resetModules();
  sent.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  // gtag 가 있어야 canSendToGA 가 통과한다.
  (window as unknown as Record<string, unknown>).gtag = (
    _cmd: string, name: string, params: unknown,
  ) => { sent.push([name, params]); };
});

/** 모듈을 새로 불러온다 — 모듈 로드시 등록되는 consent 구독을 매번 새로 만들기 위해. */
async function freshModules() {
  const consent = await import('../../src/lib/consent');
  const analytics = await import('../../src/lib/analytics');
  const queue = await import('../../src/lib/analyticsQueue');
  return { ...consent, ...analytics, ...queue };
}

describe('동의 전 GA4 이벤트는 버려지지 않고 대기한다', () => {
  it('동의 전에는 전송하지 않지만 대기열에 남는다', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    sent.length = 0;

    const ok = m.trackEvent('promo_view', { placement: 'top_banner' });

    expect(ok, '전송하지 않았으므로 false').toBe(false);
    expect(sent).toEqual([]);
    expect(m.pendingCount('ga4'), '버리지 말고 담아 둬야 한다').toBe(1);
  });

  it('수락하는 순간 대기하던 이벤트가 실제로 나간다', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    m.trackEvent('promo_view', { placement: 'top_banner' });
    m.trackEvent('wizard_started', { language: 'ko' });
    sent.length = 0;

    m.setConsent('accepted');

    expect(sent.map((e) => e[0])).toEqual(['promo_view', 'wizard_started']);
    expect(m.pendingCount('ga4')).toBe(0);
  });

  it('순서를 지킨다 (먼저 본 화면이 먼저 나간다)', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    for (const n of ['a', 'b', 'c']) m.trackEvent(n);
    sent.length = 0;
    m.setConsent('accepted');
    expect(sent.map((e) => e[0])).toEqual(['a', 'b', 'c']);
  });

  it('거절하면 대기분을 버리고 아무것도 보내지 않는다', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    m.trackEvent('promo_view');
    sent.length = 0;

    m.setConsent('dismissed');

    expect(sent).toEqual([]);
    expect(m.pendingCount('ga4')).toBe(0);
  });

  it('철회하면 그 뒤 이벤트는 다시 대기열로 간다', async () => {
    const m = await freshModules();
    m.setConsent('accepted');
    m.trackEvent('x');
    expect(sent).toHaveLength(1);

    m.setConsent('revoked');
    sent.length = 0;
    m.trackEvent('y');

    expect(sent).toEqual([]);
    expect(m.pendingCount('ga4')).toBe(1);
  });

  it('대기열이 무한히 자라지 않는다 (오래된 것부터 버린다)', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    for (let i = 0; i < 200; i++) m.trackEvent(`e${i}`);
    expect(m.pendingCount('ga4')).toBeLessThanOrEqual(60);

    sent.length = 0;
    m.setConsent('accepted');
    // 가장 최근 것이 살아남아야 한다.
    expect(sent.map((e) => e[0])).toContain('e199');
    expect(sent.map((e) => e[0])).not.toContain('e0');
  });

  it('동의 상태면 평소대로 즉시 나간다', async () => {
    const m = await freshModules();
    m.setConsent('accepted');
    sent.length = 0;

    const ok = m.trackEvent('plan_generated', { planId: 'p1' });

    expect(ok).toBe(true);
    expect(sent.map((e) => e[0])).toEqual(['plan_generated']);
    expect(m.pendingCount('ga4')).toBe(0);
  });
});

/**
 * #1219 (2026-08-07): trackFunnel 이 PostHog 호출을 동의로 미리 막아서, posthog.track()
 * 내부의 대기열(queuePending)에 아예 도달하지 못했다. 같은 이벤트가 GA4 대기열에는 담기고
 * PostHog 에는 영영 안 남는 반쪽 유실 — 배너가 1.5초 뒤에 뜨고 promo_view 는 마운트 즉시
 * 발화하므로 상시 발생. 영향 7종: promo_view·promo_click·promo_dismiss·
 * welcome_coupon_issued·welcome_coupon_modal_view·planner_complete·free_plan_redeemed.
 */
describe('동의 전 퍼널 이벤트는 PostHog 대기열에도 담긴다 (#1219)', () => {
  it('promo_view: 동의 전 발화 → GA4·PostHog 양쪽 대기열에 담긴다', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    sent.length = 0;

    m.trackPromoView('top_banner');

    expect(m.pendingCount('ga4'), 'GA4 쪽은 원래 담겼다').toBe(1);
    // 🔴 수정 전: trackFunnel 의 if (hasAnalyticsConsent()) 가 posthog.track() 호출
    //   자체를 막아 여기가 0 이었다 — GA4 에만 남는 반쪽 유실.
    expect(m.pendingCount('posthog'), 'PostHog 대기열에 도달해야 한다').toBe(1);
  });

  it('charter(noQueue) 퍼널은 양쪽 다 담지 않는다 — 호출부 자체 재시도와 이중 전송 방지', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    sent.length = 0;

    const ok = m.trackCharterQuoteStart();

    expect(ok, '전송 시도 없음 → false (호출부가 재시도)').toBe(false);
    expect(m.pendingCount('ga4'), 'noQueue: GA4 대기열 제외').toBe(0);
    expect(m.pendingCount('posthog'), 'noQueue: PostHog 대기열도 제외 — 담으면 수락 순간 대기열과 호출부가 각각 보낸다').toBe(0);
  });

  it('거절하면 PostHog 대기분도 함께 버려진다', async () => {
    const m = await freshModules();
    m.setConsent('revoked');
    m.trackPromoView('top_banner');
    expect(m.pendingCount('posthog')).toBe(1);

    m.setConsent('dismissed');

    expect(m.pendingCount('posthog')).toBe(0);
  });
});
