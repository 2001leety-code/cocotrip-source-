import type { Page, Request, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

const LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;
type Language = (typeof LANGUAGES)[number];

const VIEWPORTS = [
  { label: 'mobile', width: 390, height: 844 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'desktop', width: 1440, height: 900 },
] as const;

const STATES = ['ready', 'loading', 'error', 'not-found', 'permission', 'partial', 'empty'] as const;
type TourState = (typeof STATES)[number];

const PUBLIC_TOUR_SLUGS = [
  'seoul-city-full-day',
  'seoul-night-tour',
  'danyang-day-tour',
  'incheon-ganghwa-tour',
  'dmz-paju-tour',
  'nami-island-chuncheon',
  'gyeongju-day-tour',
  'busan-day-tour',
  'korea-multicity-3d2n',
] as const;

const STATE_TITLE: Record<Exclude<TourState, 'ready' | 'partial' | 'empty'>, Record<Language, string>> = {
  loading: {
    ko: '투어 정보를 불러오는 중입니다',
    en: 'Loading tour details',
    ja: 'ツアー情報を読み込んでいます',
    zh: '正在加载旅游信息',
  },
  error: {
    ko: '투어 정보를 불러오지 못했습니다',
    en: 'We could not load this tour',
    ja: 'ツアー情報を読み込めませんでした',
    zh: '无法加载该旅游信息',
  },
  'not-found': {
    ko: '투어를 찾을 수 없습니다',
    en: 'Tour not found',
    ja: 'ツアーが見つかりません',
    zh: '找不到该旅游产品',
  },
  permission: {
    ko: '이 투어를 볼 수 없습니다',
    en: 'This tour is not available to view',
    ja: 'このツアーは表示できません',
    zh: '目前无法查看该旅游产品',
  },
};

const STATE_TEST_ID: Record<TourState, string> = {
  ready: 'tour-detail-ready',
  loading: 'tour-detail-loading',
  error: 'tour-detail-error',
  'not-found': 'tour-detail-not-found',
  permission: 'tour-detail-permission',
  partial: 'tour-detail-ready',
  empty: 'tour-detail-ready',
};

// Page routes run newest-first: the catch-all below is registered first so the
// explicit mocks after it win for their own URLs; everything else non-local is
// aborted and recorded as blocked evidence, local requests fall through to the
// context guards (analytics / paid-api) and the preview server unchanged.
async function installDeterministicRoutes(page: Page, audit: ReadOnlyAudit) {
  await page.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    if (!['http:', 'https:'].includes(requestUrl.protocol) || requestUrl.origin === audit.appOrigin) return route.fallback();
    // Marked so its requestfailed can count as an intentional guard block.
    audit.abortedRequests.add(route.request());
    return route.abort('blockedbyclient');
  });
  await page.route('https://fonts.googleapis.com/**', (route) => {
    audit.mockedRequests.add(route.request());
    return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  });
  await page.route('**/api/reviews', (route) => {
    audit.mockedRequests.add(route.request());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: [] }) });
  });
  // Local promo banner config read (the preview answers 503 for /api/*): GET only,
  // the same empty config the D5 capture harness serves. Other methods fall through.
  await page.route('**/api/promo-config', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    audit.mockedRequests.add(route.request());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**://*.basemaps.cartocdn.com/**', (route) => {
    audit.mockedRequests.add(route.request());
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9e5dc"/></svg>',
    });
  });
}

function isLocalBaseUrl() {
  try {
    const hostname = new URL(process.env.BASE_URL || '').hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isReadOnlyReviewRequest(request: Request) {
  const requestUrl = new URL(request.url());
  if (requestUrl.pathname !== '/api/reviews' || request.method() !== 'POST') return false;
  try {
    const body = request.postDataJSON() as { action?: string };
    return body.action === 'list' || body.action === 'aggregate';
  } catch {
    return false;
  }
}

// ── Console audit with event-backed classification ──────────────────────────
// A console error is "expected" only when an actual browser event backs it:
// a securitypolicyviolation (blockedURI + directive) or a requestfailed for the
// SAME non-local URL. The one URL-less exception is the Firestore SDK offline
// notice, accepted only after an already-matched blocked request to the
// local-repair-mock Firestore channel. Everything else stays fatal.
// `nav` = main-frame navigation counter, so a URL-less notice can only lean on a
// block observed in the same document.
type ConsoleEntry = { seq: number; nav: number; text: string; locationUrl: string };
type BlockedEvidence = { seq: number; nav: number; url: string; reason: string; source: 'csp-violation' | 'requestfailed' };

// Non-local request failures are held and resolved at the final audit. One is
// guard evidence only when (a) this spec's own catch-all aborted it, or (b) Chromium
// reports a CSP failure ("csp" / net::ERR_BLOCKED_BY_CSP) AND an enforce
// securitypolicyviolation for the SAME URL in the SAME navigation was recorded.
// DNS/TLS/refused/timeout/unknown — and a "csp" text without that event — stay fatal.
type RequestFailureRecord = { seq: number; nav: number; url: string; errorText: string; abortedByThisSpec: boolean };

function resolveRequestFailure(failure: RequestFailureRecord, cspViolations: BlockedEvidence[]): BlockedEvidence | null {
  if (failure.abortedByThisSpec && failure.errorText === 'net::ERR_BLOCKED_BY_CLIENT') {
    return { seq: failure.seq, nav: failure.nav, url: failure.url, reason: 'own abort net::ERR_BLOCKED_BY_CLIENT', source: 'requestfailed' };
  }
  if (failure.errorText === 'csp' || failure.errorText === 'net::ERR_BLOCKED_BY_CSP') {
    const violation = cspViolations.find((item) => (
      item.source === 'csp-violation'
      && item.nav === failure.nav
      && stripFragment(item.url) === stripFragment(failure.url)
    ));
    if (violation) {
      return { seq: failure.seq, nav: failure.nav, url: failure.url, reason: `${failure.errorText} + enforce violation ${violation.reason}`, source: 'requestfailed' };
    }
  }
  return null;
}
type Classified = { entry: ConsoleEntry; expected: boolean; url: string; reason: string };

const FIRESTORE_ORIGIN = 'https://firestore.googleapis.com';
const MOCK_FIRESTORE_PROJECT = 'projects%2Flocal-repair-mock';
const CSP_URL_PATTERNS = [
  /^Loading the [a-z ]+ '([^']+)' violates the following Content Security Policy directive/,
  /^Connecting to '([^']+)' violates the following Content Security Policy directive/,
  /^Fetch API cannot load (\S+?)\. Refused to connect because it violates the document's Content Security Policy/,
  /^Refused to (?:load the [a-z ]+|connect to) '([^']+)' because it violates the following Content Security Policy directive/,
];

const stripFragment = (value: string) => value.split('#')[0];

function isNonLocalHttpUrl(value: string, appOrigin: string) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== appOrigin;
  } catch {
    return false;
  }
}

function consoleUrl(entry: ConsoleEntry) {
  for (const pattern of CSP_URL_PATTERNS) {
    const match = entry.text.match(pattern);
    if (match) return match[1];
  }
  if (entry.text.startsWith('Failed to load resource: net::')) return entry.locationUrl;
  return '';
}

function isFirestoreOfflineNotice(text: string) {
  return text.includes('@firebase/firestore:') && text.includes('Could not reach Cloud Firestore backend');
}

function classifyConsoleErrors(entries: ConsoleEntry[], evidence: BlockedEvidence[], appOrigin: string): Classified[] {
  const out: Classified[] = [];
  const firestoreBlockedByNav = new Map<number, string>();
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    const url = consoleUrl(entry);
    if (url && isNonLocalHttpUrl(url, appOrigin)) {
      const match = evidence.find((item) => item.nav === entry.nav && stripFragment(item.url) === stripFragment(url));
      if (match) {
        out.push({ entry, expected: true, url, reason: `${match.source}: ${match.reason}` });
        if (url.startsWith(`${FIRESTORE_ORIGIN}/`) && url.includes(MOCK_FIRESTORE_PROJECT)) firestoreBlockedByNav.set(entry.nav, url);
        continue;
      }
    } else if (!url && isFirestoreOfflineNotice(entry.text) && firestoreBlockedByNav.has(entry.nav)) {
      out.push({ entry, expected: true, url: '', reason: `url-less Firestore offline notice after blocked ${firestoreBlockedByNav.get(entry.nav)} (same navigation ${entry.nav})` });
      continue;
    }
    out.push({ entry, expected: false, url, reason: 'no matching blocked event' });
  }
  return out;
}

// The classifier must demonstrably reject real errors, not only accept blocks.
function expectClassifierSelfCheck() {
  const app = 'http://127.0.0.1:5178';
  const tile = 'https://basemaps.cartocdn.com/rastertiles/voyager/11/1746/792.png';
  const channel = `${FIRESTORE_ORIGIN}/google.firestore.v1.Firestore/Listen/channel?database=${MOCK_FIRESTORE_PROJECT}%2Fdatabases%2F(default)&RID=1`;
  const cspImage = (url: string) => `Loading the image '${url}' violates the following Content Security Policy directive: "img-src 'self' data: blob:". The action has been blocked.`;
  const offline = '[t]  @firebase/firestore: Firestore (12.13.0): Could not reach Cloud Firestore backend. Connection failed 1 times.';
  const run = (entries: Array<[string, string, number?]>, evidence: BlockedEvidence[]) => classifyConsoleErrors(
    entries.map(([text, locationUrl, nav], seq) => ({ seq, nav: nav || 0, text, locationUrl })), evidence, app,
  ).map((item) => item.expected);
  const violation = (url: string, seq = 0): BlockedEvidence => ({ seq, nav: 0, url, reason: 'img-src', source: 'csp-violation' });

  // Request failures: only own aborts, or "csp" backed by a same-URL same-nav enforce violation.
  const failure = (errorText: string, abortedByThisSpec = false, nav = 1, url = tile): RequestFailureRecord => ({ seq: 0, nav, url, errorText, abortedByThisSpec });
  const tileViolationNav1: BlockedEvidence[] = [{ seq: 0, nav: 1, url: tile, reason: 'img-src', source: 'csp-violation' }];
  const admitted = (f: RequestFailureRecord, v: BlockedEvidence[]) => resolveRequestFailure(f, v) !== null;
  expect(admitted(failure('net::ERR_CONNECTION_REFUSED', true), tileViolationNav1), 'self-check: refused is never a guard block').toBe(false);
  expect(admitted(failure('net::ERR_TIMED_OUT', true), tileViolationNav1), 'self-check: timeout is never a guard block').toBe(false);
  expect(admitted(failure('net::ERR_NAME_NOT_RESOLVED'), tileViolationNav1), 'self-check: DNS is never a guard block').toBe(false);
  expect(admitted(failure(''), tileViolationNav1), 'self-check: unknown failure').toBe(false);
  expect(admitted(failure('net::ERR_BLOCKED_BY_CLIENT'), tileViolationNav1), 'self-check: unmarked client block').toBe(false);
  expect(admitted(failure('net::ERR_BLOCKED_BY_CLIENT', true), []), 'self-check: own abort').toBe(true);
  expect(admitted(failure('csp'), tileViolationNav1), 'self-check: csp + same-URL same-nav violation').toBe(true);
  expect(admitted(failure('net::ERR_BLOCKED_BY_CSP'), tileViolationNav1), 'self-check: ERR_BLOCKED_BY_CSP + violation').toBe(true);
  expect(admitted(failure('csp'), []), 'self-check: csp without violation event').toBe(false);
  expect(admitted(failure('csp', false, 2), tileViolationNav1), 'self-check: csp with violation from another navigation').toBe(false);
  expect(admitted(failure('csp', false, 1, `${tile}?other`), tileViolationNav1), 'self-check: csp with violation for another URL').toBe(false);
  expect(admitted(failure('csp'), [{ seq: 0, nav: 1, url: tile, reason: 'own abort', source: 'requestfailed' }]), 'self-check: csp backed only by another requestfailed').toBe(false);
  // A refused external request leaves no admitted evidence, so its console line stays fatal.
  expect(run([['Failed to load resource: net::ERR_CONNECTION_REFUSED', tile]], []), 'self-check: refused console line').toEqual([false]);

  expect(run([[cspImage(tile), app]], [violation(tile)]), 'self-check: matched CSP block').toEqual([true]);
  expect(run([[cspImage(tile), app]], []), 'self-check: CSP text without event').toEqual([false]);
  expect(run([[cspImage(tile), app]], [violation(`${tile}?other`)]), 'self-check: different URL').toEqual([false]);
  expect(run([[cspImage(`${app}/local.png`), app]], [violation(`${app}/local.png`)]), 'self-check: local URL never expected').toEqual([false]);
  expect(run([['Failed to load resource: the server responded with a status of 503 (Service Unavailable)', `${app}/api/promo-config`]], []), 'self-check: local 503').toEqual([false]);
  expect(run([['TypeError: Cannot read properties of undefined', `${app}/src/main.tsx`]], [violation(tile)]), 'self-check: JS error').toEqual([false]);
  expect(run([[offline, app]], []), 'self-check: offline notice without blocked channel').toEqual([false]);
  expect(run([[offline, app]], [violation(tile)]), 'self-check: offline notice with unrelated block').toEqual([false]);
  const channelBlocked = `Connecting to '${channel}' violates the following Content Security Policy directive: "connect-src 'self'". The action has been blocked.`;
  const channelEvidence: BlockedEvidence[] = [{ seq: 0, nav: 1, url: channel, reason: 'connect-src', source: 'csp-violation' }];
  expect(run([[channelBlocked, app, 1], [offline, app, 1]], channelEvidence), 'self-check: offline notice after matched channel block, same navigation').toEqual([true, true]);
  expect(run([[channelBlocked, app, 1], [offline, app, 2]], channelEvidence), 'self-check: offline notice on a later navigation').toEqual([true, false]);
  expect(run([[channelBlocked, app, 2], [offline, app, 2]], channelEvidence), 'self-check: nav-1 block cannot back nav-2 console lines').toEqual([false, false]);
}

type ReadOnlyAudit = Awaited<ReturnType<typeof startReadOnlyAudit>>;

async function startReadOnlyAudit(page: Page) {
  const appOrigin = new URL(process.env.BASE_URL || 'https://cocotripkr.com').origin;
  const pageErrors: string[] = [];
  const consoleEntries: ConsoleEntry[] = [];
  const blockedEvidence: BlockedEvidence[] = [];
  const ownDomainFailures: string[] = [];
  const writeRequests: string[] = [];
  const externalResponses: string[] = [];
  // Every non-local request failure, resolved (admitted or fatal) at the final audit.
  const requestFailures: RequestFailureRecord[] = [];
  const mockedRequests = new WeakSet<Request>();
  const abortedRequests = new WeakSet<Request>();
  let seq = 0;
  let nav = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) nav += 1; });

  // Actual CSP violation events from the document (blockedURI + directive).
  await page.exposeBinding('__tourDetailCspViolation', (_source, violation: { blockedURI?: string; directive?: string; disposition?: string }) => {
    if (violation && violation.blockedURI && violation.disposition === 'enforce') {
      blockedEvidence.push({ seq: seq++, nav, url: violation.blockedURI, reason: violation.directive || 'csp', source: 'csp-violation' });
    }
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { __tourDetailCspViolation?: (v: unknown) => void }).__tourDetailCspViolation;
      if (report) report({ blockedURI: event.blockedURI, directive: event.effectiveDirective, disposition: event.disposition });
    });
  });

  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      if (location.url.startsWith('https://fonts.gstatic.com/')) return;
      consoleEntries.push({ seq: seq++, nav, text: message.text(), locationUrl: location.url || '' });
    }
  });
  page.on('requestfailed', (request) => {
    if (!isNonLocalHttpUrl(request.url(), appOrigin)) return;
    const errorText = (request.failure() && request.failure()?.errorText) || '';
    requestFailures.push({ seq: seq++, nav, url: request.url(), errorText, abortedByThisSpec: abortedRequests.has(request) });
  });
  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.origin === appOrigin && response.status() >= 400) {
      ownDomainFailures.push(`${response.status()} ${responseUrl.pathname}`);
    }
    if (isNonLocalHttpUrl(response.url(), appOrigin) && !mockedRequests.has(response.request()) && response.status() < 400) {
      externalResponses.push(`${response.status()} ${responseUrl.origin}${responseUrl.pathname}`);
    }
  });
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (isReadOnlyReviewRequest(request)) return;
    if (
      requestUrl.origin === appOrigin
      && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())
    ) {
      writeRequests.push(`${request.method()} ${requestUrl.pathname}`);
    }
  });

  return { appOrigin, pageErrors, consoleEntries, blockedEvidence, ownDomainFailures, writeRequests, externalResponses, requestFailures, mockedRequests, abortedRequests };
}

function parseCssColor(value: string) {
  const channels = value.match(/[\d.]+/g)?.map(Number) || [];
  return {
    red: channels[0] || 0,
    green: channels[1] || 0,
    blue: channels[2] || 0,
    alpha: channels.length > 3 ? channels[3] : 1,
  };
}

function relativeLuminance(red: number, green: number, blue: number) {
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * toLinear(red)) + (0.7152 * toLinear(green)) + (0.0722 * toLinear(blue));
}

function contrastRatio(foregroundValue: string, backgroundValue: string) {
  const foreground = parseCssColor(foregroundValue);
  const background = parseCssColor(backgroundValue);
  const red = (foreground.red * foreground.alpha) + (background.red * (1 - foreground.alpha));
  const green = (foreground.green * foreground.alpha) + (background.green * (1 - foreground.alpha));
  const blue = (foreground.blue * foreground.alpha) + (background.blue * (1 - foreground.alpha));
  const foregroundLuminance = relativeLuminance(red, green, blue);
  const backgroundLuminance = relativeLuminance(background.red, background.green, background.blue);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function expectBookingMetaContrast(page: Page, context: string) {
  if (await page.getByTestId('tour-detail-ready').count() === 0) return;
  const meta = page.getByTestId('tour-detail-booking-meta');
  await expect(meta, `${context}: booking meta backing`).toBeVisible();
  const colors = await meta.evaluate((element) => {
    const root = element as HTMLElement;
    const readColor = (testId: string) => {
      const target = root.querySelector(`[data-testid="${testId}"]`);
      return target ? window.getComputedStyle(target).color : '';
    };
    return {
      background: window.getComputedStyle(root).backgroundColor,
      fees: readColor('tour-detail-trust-fees'),
      paypal: readColor('tour-detail-trust-paypal'),
      cutoff: readColor('tour-detail-cutoff-note'),
    };
  });
  for (const [label, color] of Object.entries(colors).filter(([key]) => key !== 'background')) {
    expect(contrastRatio(color, colors.background), `${context}: ${label} contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

async function expectEditorialGeometry(page: Page, context: string) {
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tour-detail-shell"]');
    const rootStyle = root ? window.getComputedStyle(root) : null;
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      backgroundImage: rootStyle?.backgroundImage || '',
      backgroundColor: rootStyle?.backgroundColor || '',
    };
  });
  expect(metrics.overflow, `${context}: horizontal overflow`).toBeLessThanOrEqual(1);
  expect(metrics.backgroundImage).toBe('none');
  expect(metrics.backgroundColor).not.toBe('rgb(10, 4, 18)');

  const shortControls = await page.locator('[data-testid="tour-detail-nonpayment"] a:visible, [data-testid="tour-detail-nonpayment"] button:visible').evaluateAll(
    (controls) => controls.filter((control) => !control.closest('.leaflet-control-attribution')).map((control) => {
      const box = control.getBoundingClientRect();
      return {
        label: (control.getAttribute('aria-label') || control.textContent || control.tagName).trim().slice(0, 60),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    }).filter((control) => (
      control.width > 0
      && control.height > 0
      && (control.width < 44 || control.height < 44)
    )),
  );
  expect(shortControls, `${context}: controls below 44px`).toEqual([]);
  await expectBookingMetaContrast(page, context);
}

async function expectReadOnlyAuditClean(audit: ReadOnlyAudit, testInfo: TestInfo) {
  // Resolve held request failures against the CSP violations recorded by now.
  const admittedFailures: BlockedEvidence[] = [];
  const unadmittedFailures: string[] = [];
  for (const failure of audit.requestFailures) {
    const resolved = resolveRequestFailure(failure, audit.blockedEvidence);
    if (resolved) admittedFailures.push(resolved);
    else unadmittedFailures.push(`${failure.errorText || 'unknown'} nav${failure.nav} ${new URL(failure.url).origin}${new URL(failure.url).pathname}`);
  }
  const evidence = [...audit.blockedEvidence, ...admittedFailures];
  const classified = classifyConsoleErrors(audit.consoleEntries, evidence, audit.appOrigin);
  const expectedBlocked = classified.filter((item) => item.expected);
  const unexpectedConsole = classified.filter((item) => !item.expected).map((item) => `${item.entry.text} @ ${item.entry.locationUrl || 'unknown'}`);

  const counts: Record<string, { count: number; reason: string }> = {};
  for (const item of expectedBlocked) {
    const key = item.url ? new URL(item.url).origin + new URL(item.url).pathname : 'url-less notice';
    counts[key] = { count: ((counts[key] && counts[key].count) || 0) + 1, reason: item.reason };
  }
  await testInfo.attach('expected-blocked-diagnostics.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      expectedBlockedCount: expectedBlocked.length,
      byOriginPath: counts,
      blockedEventCount: evidence.length,
      blockedEventsBySource: {
        cspViolation: audit.blockedEvidence.length,
        requestfailedAdmitted: admittedFailures.length,
        requestfailedTotal: audit.requestFailures.length,
      },
      unexpectedConsole,
      unadmittedNonLocalFailures: unadmittedFailures,
      note: 'Blocked/CSP-denied requests only; mocked tiles/fonts are synthetic and prove nothing about real provider access.',
    }, null, 2),
  });

  expect(audit.pageErrors).toEqual([]);
  expect(unexpectedConsole).toEqual([]);
  expect(audit.ownDomainFailures).toEqual([]);
  expect(audit.writeRequests).toEqual([]);
  expect(audit.externalResponses, 'non-local responses that were not test mocks').toEqual([]);
  expect(unadmittedFailures, 'non-local failures without own-abort or same-URL same-nav CSP violation evidence').toEqual([]);
  // A muted or empty audit must not pass: the isolated preview always blocks something.
  expect(evidence.length, 'observed blocked events').toBeGreaterThan(0);
  expect(expectedBlocked.length, 'console diagnostics backed by blocked events').toBeGreaterThan(0);
}

test.describe('/tours/:slug editorial detail states', () => {
  test('renders seven deterministic states across twelve viewport-language combinations', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set explicitly');
    test.skip(!isLocalBaseUrl(), 'deterministic fixtures are local-only');
    test.setTimeout(300_000);

    expectClassifierSelfCheck();
    const audit = await startReadOnlyAudit(page);
    await installDeterministicRoutes(page, audit);
    const initialResponse = await page.goto('/tours/seoul-city-full-day?localTourState=loading', { waitUntil: 'networkidle' });
    expect(initialResponse?.status()).toBe(200);
    await page.evaluate(() => {
      window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
      window.localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const language of LANGUAGES) {
        await page.evaluate((nextLanguage) => {
          window.localStorage.setItem('cocotrip_lang', nextLanguage);
        }, language);

        for (const state of STATES) {
          const response = await page.goto(`/tours/seoul-city-full-day?localTourState=${state}`, { waitUntil: 'networkidle' });
          expect(response?.status(), `${viewport.width}/${language}/${state}: document status`).toBe(200);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await expect(page.getByTestId(STATE_TEST_ID[state])).toBeVisible();

          if (state === 'ready' || state === 'partial' || state === 'empty') {
            await expect(page.getByTestId('tour-detail-heading')).not.toBeEmpty();
            const heading = (await page.getByTestId('tour-detail-heading').textContent() || '').trim();
            expect(await page.title(), `${viewport.width}/${language}/${state}: localized title`).toContain(heading);
          } else {
            await expect(page.getByRole('heading', { name: STATE_TITLE[state][language] })).toBeVisible();
            expect(await page.title(), `${viewport.width}/${language}/${state}: localized title`).toContain(STATE_TITLE[state][language]);
          }

          if (state === 'partial') await expect(page.getByTestId('tour-detail-partial')).toBeVisible();
          if (state === 'empty') await expect(page.getByTestId('tour-itinerary-empty')).toBeVisible();

          await expectEditorialGeometry(page, `${viewport.width}/${language}/${state}`);
        }
      }
    }

    await expectReadOnlyAuditClean(audit, testInfo);
  });

  test('renders every static public tour across twelve viewport-language combinations', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set explicitly');
    test.skip(!isLocalBaseUrl(), 'deterministic fixtures are local-only');
    test.setTimeout(480_000);

    expectClassifierSelfCheck();
    const audit = await startReadOnlyAudit(page);
    await installDeterministicRoutes(page, audit);
    const initialResponse = await page.goto(`/tours/${PUBLIC_TOUR_SLUGS[0]}?localTourState=ready`, { waitUntil: 'networkidle' });
    expect(initialResponse?.status()).toBe(200);
    await page.evaluate(() => {
      window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
      window.localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const language of LANGUAGES) {
        await page.evaluate((nextLanguage) => {
          window.localStorage.setItem('cocotrip_lang', nextLanguage);
        }, language);

        for (const slug of PUBLIC_TOUR_SLUGS) {
          const response = await page.goto(`/tours/${slug}?localTourState=ready`, { waitUntil: 'networkidle' });
          const context = `${viewport.width}/${language}/${slug}`;
          expect(response?.status(), `${context}: document status`).toBe(200);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await expect(page.getByTestId('tour-detail-ready')).toBeVisible();
          await expect(page.getByTestId('tour-detail-heading')).not.toBeEmpty();
          await expectEditorialGeometry(page, context);
        }
      }
    }

    await expectReadOnlyAuditClean(audit, testInfo);
  });
});
