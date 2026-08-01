/**
 * 자동 테스트가 **운영 분석 서버로 나가지 못하게** 막는 공용 안전장치 (2026-08-02).
 *
 * 왜 만드나 — 실측으로 확인한 사고:
 *   GA4 에서 `/charter` 세션을 날짜·시각으로 쪼개 보니 **8주 연속 월요일마다 정확히 9세션**이
 *   찍혀 있었다. 9 = 3개 언어 × 3개 기기, 즉 `weekly-i18n-audit` 이 운영 사이트를 도는 값이다.
 *   그 수치를 실제 고객으로 읽고 "견적 시작 14명" 같은 결론을 냈다가 뒤집혔다.
 *   측정이 오염되면 판단이 통째로 틀어진다 — 그래서 스펙마다 조심하는 대신 **한 곳에서 막는다.**
 *
 * 설계 원칙:
 *   1. **스펙이 협조하지 않아도 막힌다.** 차단은 `context` 픽스처에서 걸리므로, 스펙 작성자가
 *      실수로 쿠키 "Accept" 를 눌러 앱이 GA4·PostHog 를 켜더라도 요청 자체가 밖으로 못 나간다.
 *   2. **조용히 넘어가지 않는다.** 혹시라도 빠져나간 요청이 있으면 테스트를 실패시킨다.
 *      (막았다고 믿는 것과 막힌 것은 다르다.)
 *   3. **앱 코드는 건드리지 않는다.** `navigator.webdriver` 로 분석을 끄는 식의 제품 변경은
 *      실제 사용자 계측까지 위태롭게 한다. 차단은 테스트 인프라에만 둔다.
 *   4. **URL 문자열로 운영 여부를 추측하지 않는다.** preview·dev·prod 어디를 향하든 항상 막는다.
 *      분석 전송이 필요한 테스트는 존재하지 않는다 — 동작 검증은 가로챈 요청을 보고 한다.
 *
 * 사용법: 스펙에서 `@playwright/test` 대신 이 파일에서 `test`/`expect` 를 가져온다.
 *   import { test, expect } from './fixtures/analytics-guard';
 * 이 규칙은 `scripts/lint-mistake-patterns.mjs` 가 강제한다(CI 의 mistake-lint).
 */
import { test as base, expect, type BrowserContext, type Request } from '@playwright/test';

/**
 * 고객 행동을 수집하는 외부 호스트. 부분 문자열로 비교한다
 * (`region1.google-analytics.com`·`us.i.posthog.com` 같은 변종까지 함께 걸리도록).
 */
export const ANALYTICS_HOSTS: readonly string[] = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'googleadservices.com',
  'doubleclick.net',
  'posthog.com',
];

export function isAnalyticsUrl(url: string): boolean {
  return ANALYTICS_HOSTS.some((h) => url.includes(h));
}

/** 이번 테스트에서 가로챈/빠져나간 분석 요청. 분석 동작을 검증하는 테스트가 읽는다. */
export type AnalyticsTraffic = {
  /** 우리가 막은 요청들(= 앱이 보내려 했던 것). 계측 동작 검증은 이걸로 한다. */
  blocked: Request[];
  /** 밖으로 실제로 나간 요청. 항상 비어 있어야 한다. */
  escaped: Request[];
  /** 특정 이벤트 이름이 전송 시도됐는지 — GA4 는 쿼리스트링 `en=<event>` 에 담긴다. */
  attempted(eventName: string): boolean;
};

async function installGuard(context: BrowserContext): Promise<AnalyticsTraffic> {
  const blocked: Request[] = [];
  const escaped: Request[] = [];

  // 호스트별로 좁게 건다. `**/*` 로 전부 가로채면 dev 서버의 모듈 요청 수백 건까지
  // 프록시를 타서 페이지가 아예 뜨지 않는다(실측).
  for (const host of ANALYTICS_HOSTS) {
    await context.route(`**${host}/**`, (route) => {
      blocked.push(route.request());
      return route.abort();
    });
  }

  // 라우트에 안 걸린 분석 요청이 완료됐다면 그것이 곧 유출이다.
  context.on('requestfinished', (req) => {
    if (isAnalyticsUrl(req.url())) escaped.push(req);
  });

  return {
    blocked,
    escaped,
    attempted(eventName: string) {
      return blocked.some((r) => {
        const url = r.url();
        if (url.includes(`en=${eventName}`)) return true;      // GA4 수집 쿼리
        const body = r.postData() || '';
        return body.includes(`"${eventName}"`) || body.includes(`en=${eventName}`);
      });
    },
  };
}

/** context ↔ 이번 테스트의 분석 트래픽. `analytics` 픽스처가 같은 것을 집어오게 한다. */
const trafficByContext = new WeakMap<BrowserContext, AnalyticsTraffic>();

export const test = base.extend<{ analytics: AnalyticsTraffic }>({
  // context 를 감싸 차단을 **자동으로** 건다 — 스펙이 아무것도 안 해도 적용된다.
  // 같은 컨텍스트의 새 탭·팝업까지 함께 덮인다.
  // 인자 이름을 use 로 두면 eslint 의 react-hooks 규칙이 React 훅 호출로 오인한다.
  context: async ({ context }, provide) => {
    const traffic = await installGuard(context);
    trafficByContext.set(context, traffic);
    await provide(context);
    trafficByContext.delete(context);
    if (traffic.escaped.length > 0) {
      const urls = traffic.escaped.map((r) => r.url()).slice(0, 5).join('\n  ');
      throw new Error(
        `분석 요청이 외부로 나갔다 (${traffic.escaped.length}건). 운영 지표가 오염된다:\n  ${urls}`,
      );
    }
  },

  analytics: async ({ context }, provide) => {
    const traffic = trafficByContext.get(context);
    if (!traffic) throw new Error('analytics 픽스처는 context 픽스처보다 먼저 쓸 수 없다');
    await provide(traffic);
  },
});

export { expect };
