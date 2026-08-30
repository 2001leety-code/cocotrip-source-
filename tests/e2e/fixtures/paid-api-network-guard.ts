import type { BrowserContext, Request } from '@playwright/test';

/** 자동 테스트에서 절대 호출하면 안 되는 Google Places/Maps 유료 호스트. */
export const GOOGLE_PLACES_PAID_HOSTS: readonly string[] = [
  'maps.googleapis.com',
  'places.googleapis.com',
];

const PLACE_PHOTO_PATH = '/api/place-photo';
const IMAGE_PROXY_PATH = '/api/image-proxy';
const MAX_NESTED_PROXY_DEPTH = 3;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url, 'https://playwright.invalid');
  } catch {
    return null;
  }
}

function normalizedPathname(url: URL): string | null {
  let pathname = url.pathname;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch {
    return null;
  }
  return (pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/').toLowerCase();
}

function decodeNestedTarget(value: string): string {
  let decoded = value;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return value;
  }
  return decoded;
}

/** 호스트·legacy 경로·image-proxy 안쪽 URL까지 재귀 검사한다. */
function isGooglePlacesPaidUrlAtDepth(url: string, depth: number): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const isPaidHost = GOOGLE_PLACES_PAID_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
  if (isPaidHost) return true;

  const pathname = normalizedPathname(parsed);
  if (!pathname) return true;
  if (pathname === PLACE_PHOTO_PATH) return true;
  if (pathname !== IMAGE_PROXY_PATH) return false;
  if (depth > 0 || depth >= MAX_NESTED_PROXY_DEPTH) return true;

  const nestedTarget = parsed.searchParams.get('url');
  if (!nestedTarget) return false;
  return isGooglePlacesPaidUrlAtDepth(decodeNestedTarget(nestedTarget), depth + 1);
}

export function isGooglePlacesPaidUrl(url: string): boolean {
  return isGooglePlacesPaidUrlAtDepth(url, 0);
}

/** photo_reference, API key 등 query 값이 테스트 로그에 남지 않게 URL을 줄인다. */
export function redactPaidApiUrl(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) return '[invalid-url]';
  return `${parsed.origin}${parsed.pathname}`;
}

export type PaidApiTraffic = {
  attempted: Request[];
  blocked: Request[];
};

/**
 * 브라우저 문맥의 모든 요청을 감시한다.
 *
 * `request` 이벤트도 함께 기록하므로 개별 spec이 나중에 `page.route()`로 응답을
 * 가로채더라도 유료 API를 요청하려 했다는 사실은 숨길 수 없다.
 */
export async function installPaidApiGuard(context: BrowserContext): Promise<PaidApiTraffic> {
  const attempted: Request[] = [];
  const attemptedRequests = new Set<Request>();
  const blocked: Request[] = [];
  const blockedRequests = new Set<Request>();

  const recordAttempt = (request: Request) => {
    if (!isGooglePlacesPaidUrl(request.url()) || attemptedRequests.has(request)) return;
    attemptedRequests.add(request);
    attempted.push(request);
  };

  context.on('request', recordAttempt);

  // catch-all + fallback은 same-origin /api/place-photo까지 한 곳에서 막기 위한 것이다.
  // Playwright service worker는 route를 우회할 수 있어 두 config에서 별도로 차단한다.
  await context.route('**/*', (route) => {
    const request = route.request();
    if (!isGooglePlacesPaidUrl(request.url())) return route.fallback();

    recordAttempt(request);
    if (!blockedRequests.has(request)) {
      blockedRequests.add(request);
      blocked.push(request);
    }
    return route.abort();
  });

  return { attempted, blocked };
}

/** 차단 여부와 무관하게 유료 API를 시도한 코드가 있으면 테스트를 실패시킨다. */
export function assertNoPaidApiAttempts(traffic: PaidApiTraffic): void {
  if (traffic.attempted.length === 0) return;

  const urls = [...new Set(traffic.attempted.map((request) => redactPaidApiUrl(request.url())))]
    .slice(0, 5)
    .join('\n  ');
  throw new Error(
    `Google Places/Maps 유료 API 요청 시도 ${traffic.attempted.length}건을 차단했다. `
      + `정적 fixture를 사용해야 한다:\n  ${urls}`,
  );
}
