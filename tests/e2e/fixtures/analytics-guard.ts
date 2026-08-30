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
import { test as base, expect, type BrowserContext } from '@playwright/test';
import {
  assertNoAnalyticsEscaped,
  installAnalyticsGuard,
  type AnalyticsTraffic,
} from './analytics-network-guard';
import {
  assertNoPaidApiAttempts,
  installPaidApiGuard,
} from './paid-api-network-guard';

export { ANALYTICS_HOSTS, isAnalyticsUrl } from './analytics-network-guard';
export type { AnalyticsTraffic } from './analytics-network-guard';

/** context ↔ 이번 테스트의 분석 트래픽. `analytics` 픽스처가 같은 것을 집어오게 한다. */
const trafficByContext = new WeakMap<BrowserContext, AnalyticsTraffic>();

export const test = base.extend<{ analytics: AnalyticsTraffic }>({
  // context 를 감싸 차단을 **자동으로** 건다 — 스펙이 아무것도 안 해도 적용된다.
  // 같은 컨텍스트의 새 탭·팝업까지 함께 덮인다.
  // 인자 이름을 use 로 두면 eslint 의 react-hooks 규칙이 React 훅 호출로 오인한다.
  context: async ({ context }, provide) => {
    const analytics = await installAnalyticsGuard(context);
    const paidApi = await installPaidApiGuard(context);
    trafficByContext.set(context, analytics);
    await provide(context);
    trafficByContext.delete(context);
    // 유료 API 시도는 route로 막혔더라도 실패다. 정적 fixture 누락을 즉시 드러낸다.
    assertNoPaidApiAttempts(paidApi);
    assertNoAnalyticsEscaped(analytics);
  },

  analytics: async ({ context }, provide) => {
    const traffic = trafficByContext.get(context);
    if (!traffic) throw new Error('analytics 픽스처는 context 픽스처보다 먼저 쓸 수 없다');
    await provide(traffic);
  },
});

export { expect };
