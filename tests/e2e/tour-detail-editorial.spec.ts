import type { Page, Request } from '@playwright/test';
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

async function installDeterministicRoutes(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: '',
  }));
  await page.route('**/api/reviews', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reviews: [] }),
  }));
  await page.route('**://*.basemaps.cartocdn.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9e5dc"/></svg>',
  }));
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

function startReadOnlyAudit(page: Page) {
  const appOrigin = new URL(process.env.BASE_URL || 'https://cocotripkr.com').origin;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ownDomainFailures: string[] = [];
  const writeRequests: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      if (location.url.startsWith('https://fonts.gstatic.com/')) return;
      consoleErrors.push(`${message.text()} @ ${location.url || 'unknown'}`);
    }
  });
  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.origin === appOrigin && response.status() >= 400) {
      ownDomainFailures.push(`${response.status()} ${responseUrl.pathname}`);
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

  return { pageErrors, consoleErrors, ownDomainFailures, writeRequests };
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

function expectReadOnlyAuditClean(audit: ReturnType<typeof startReadOnlyAudit>) {
  expect(audit.pageErrors).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
  expect(audit.ownDomainFailures).toEqual([]);
  expect(audit.writeRequests).toEqual([]);
}

test.describe('/tours/:slug editorial detail states', () => {
  test('renders seven deterministic states across twelve viewport-language combinations', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set explicitly');
    test.skip(!isLocalBaseUrl(), 'deterministic fixtures are local-only');
    test.setTimeout(300_000);

    await installDeterministicRoutes(page);
    const audit = startReadOnlyAudit(page);
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

    expectReadOnlyAuditClean(audit);
  });

  test('renders every static public tour across twelve viewport-language combinations', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set explicitly');
    test.skip(!isLocalBaseUrl(), 'deterministic fixtures are local-only');
    test.setTimeout(480_000);

    await installDeterministicRoutes(page);
    const audit = startReadOnlyAudit(page);
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

    expectReadOnlyAuditClean(audit);
  });
});
