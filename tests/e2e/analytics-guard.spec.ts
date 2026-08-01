/**
 * 분석 차단 안전장치 자체를 검사한다 (2026-08-02).
 *
 * 이 스펙이 없으면 "막고 있다고 믿는 상태" 만 남는다. 실제로 확인하는 것:
 *   1. 페이지에서 GA4·PostHog 수집 주소로 요청을 쏘면 **밖으로 나가지 못한다**.
 *   2. 그 요청을 차단기가 **실제로 잡았다** — 앱이 아무것도 안 보내서 조용한 것과,
 *      보내려는 것을 잡아서 조용한 것을 구분한다. 이 구분이 없으면 가짜 안전장치를 못 잡는다.
 *   3. 스펙이 실수로 쿠키 "Accept" 를 눌러 분석이 켜져도 결과는 같다.
 *
 * 왜 합성 요청을 쓰나: dev·preview 에는 GA 측정 ID 가 없어(`VITE_GA_MEASUREMENT_ID` 미설정)
 * 앱이 아무것도 보내지 않는다. 앱의 전송에 기대면 환경에 따라 통과/실패가 갈리는 가짜 검사가 된다.
 * 수집 주소로 직접 쏘면 어느 환경에서도 차단기 자체를 정확히 검사할 수 있다.
 */
import { test, expect, ANALYTICS_HOSTS, isAnalyticsUrl } from './fixtures/analytics-guard';

// 실제 수집 엔드포인트 형태 그대로 (호스트 매칭이 목적).
const GA4_COLLECT = 'https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=guard_probe';
const PH_CAPTURE = 'https://us.i.posthog.com/e/?ip=0';

test.describe('분석 차단 안전장치', () => {
  test('수집 주소로 쏜 요청이 잡히고, 하나도 밖으로 못 나간다', async ({ page, analytics }) => {
    await page.goto('/charter');

    // 일부러 "수락" 을 누른다 — 스펙 작성자가 실수하는 상황을 그대로 재현한다.
    const accept = page.getByRole('button', { name: /^Accept$/ }).first();
    if (await accept.isVisible({ timeout: 20000 }).catch(() => false)) {
      await accept.click();
      await expect(accept).toBeHidden({ timeout: 10000 });
    }

    // 페이지 안에서 수집 주소로 직접 쏜다. 차단되면 fetch 가 거부된다.
    const results = await page.evaluate(async (urls) => {
      const out: string[] = [];
      for (const u of urls) {
        try {
          await fetch(u, { mode: 'no-cors', cache: 'no-store' });
          out.push('sent');            // 나갔다 = 차단 실패
        } catch {
          out.push('blocked');
        }
      }
      return out;
    }, [GA4_COLLECT, PH_CAPTURE]);

    expect(results, '수집 요청이 브라우저에서 차단되지 않았다').toEqual(['blocked', 'blocked']);

    // 차단기가 그 요청들을 실제로 봤는지 (조용한 이유가 "아무 일도 없어서" 가 아님을 확인).
    await expect
      .poll(() => analytics.blocked.length, {
        timeout: 10000,
        message: '차단기가 수집 요청을 하나도 못 잡았다 — 차단 경로가 요청을 보고 있지 않다',
      })
      .toBeGreaterThanOrEqual(2);

    // 핵심 단언: 밖으로 나간 것이 0.
    expect(
      analytics.escaped.map((r) => r.url()),
      '분석 요청이 외부로 나갔다 — 운영 지표가 오염된다',
    ).toEqual([]);

    // 엉뚱한 요청을 세고 있지는 않은지.
    for (const req of analytics.blocked) {
      expect(isAnalyticsUrl(req.url()), `수집 호스트가 아닌 요청을 셌다: ${req.url()}`).toBe(true);
    }
  });

  test('호스트 목록에 GA4·PostHog 가 들어 있다', async () => {
    // 목록이 조용히 비워지면 차단이 통째로 무력화된다. 그 상태를 여기서 실패로 만든다.
    expect(ANALYTICS_HOSTS).toContain('google-analytics.com');
    expect(ANALYTICS_HOSTS).toContain('googletagmanager.com');
    expect(ANALYTICS_HOSTS).toContain('posthog.com');
    expect(isAnalyticsUrl(GA4_COLLECT)).toBe(true);
    expect(isAnalyticsUrl(PH_CAPTURE)).toBe(true);
    expect(isAnalyticsUrl('https://cocotripkr.com/charter')).toBe(false);
  });
});
