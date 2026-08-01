import type { BrowserContext, Request } from '@playwright/test';

/** 운영 분석 데이터를 받는 호스트만 정확한 도메인 경계로 판별한다. */
export const ANALYTICS_HOSTS: readonly string[] = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'googleadservices.com',
  'doubleclick.net',
  'posthog.com',
];

/** URL의 호스트가 분석 서비스 자체이거나 그 하위 도메인인지 확인한다. */
export function isAnalyticsUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ANALYTICS_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** 한 브라우저 문맥에서 차단되거나 빠져나간 분석 요청 기록이다. */
export type AnalyticsTraffic = {
  blocked: Request[];
  escaped: Request[];
  attempted(eventName: string): boolean;
};

/** 브라우저 문맥이 첫 페이지를 열기 전에 운영 분석 요청을 중앙 차단한다. */
export async function installAnalyticsGuard(context: BrowserContext): Promise<AnalyticsTraffic> {
  const blocked: Request[] = [];
  const blockedRequests = new Set<Request>();
  const escaped: Request[] = [];
  const escapedRequests = new Set<Request>();

  const recordEscaped = (request: Request) => {
    if (
      isAnalyticsUrl(request.url()) &&
      !blockedRequests.has(request) &&
      !escapedRequests.has(request)
    ) {
      escapedRequests.add(request);
      escaped.push(request);
    }
  };

  context.on('requestfinished', recordEscaped);
  context.on('requestfailed', recordEscaped);

  for (const host of ANALYTICS_HOSTS) {
    await context.route(`**${host}/**`, (route) => {
      const request = route.request();
      if (!isAnalyticsUrl(request.url())) return route.fallback();
      blockedRequests.add(request);
      blocked.push(request);
      return route.abort();
    });
  }

  return {
    blocked,
    escaped,
    attempted(eventName: string) {
      return blocked.some((request) => {
        const url = request.url();
        if (url.includes(`en=${eventName}`)) return true;
        const body = request.postData() || '';
        return body.includes(`"${eventName}"`) || body.includes(`en=${eventName}`);
      });
    },
  };
}

/** 차단망 밖으로 나간 분석 요청이 있으면 해당 테스트를 즉시 실패시킨다. */
export function assertNoAnalyticsEscaped(traffic: AnalyticsTraffic): void {
  if (traffic.escaped.length === 0) return;
  const urls = traffic.escaped.map((request) => request.url()).slice(0, 5).join('\n  ');
  throw new Error(
    `분석 요청이 인터넷으로 빠져나갔다(${traffic.escaped.length}건). 운영 지표가 오염됐다:\n  ${urls}`,
  );
}
