import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type MapState = 'signed-out' | 'normal' | 'loading' | 'empty' | 'error' | 'not-found' | 'permission' | 'partial';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const STATES: MapState[] = ['signed-out', 'normal', 'loading', 'empty', 'error', 'not-found', 'permission', 'partial'];
const TITLES: Record<Language, string> = {
  ko: '경로 지도',
  en: 'Route Map',
  ja: 'ルートマップ',
  zh: '路线地图',
};

async function installLanguage(page: Page, language: Language) {
  await page.addInitScript((value) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('cocotrip_lang', value);
    window.localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  }, language);
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: '',
  }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(/https:\/\/[a-d]\.basemaps\.cartocdn\.com\/.*/, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
}

async function assertGeometry(page: Page) {
  const metrics = await page.getByTestId('map-editorial-shell').evaluate((root) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const elements = [...root.querySelectorAll('*')].filter(visible);
    const controls = elements
      .filter((element) => element.matches('button, a, input, textarea, select'))
      .filter((element) => !element.closest('.leaflet-control-attribution'));
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      gradients: elements.filter((element) => getComputedStyle(element).backgroundImage.includes('gradient')).length,
      glass: elements.filter((element) => {
        const style = getComputedStyle(element);
        const webkitStyle = style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
        return (style.backdropFilter || 'none') !== 'none'
          || (webkitStyle.webkitBackdropFilter || 'none') !== 'none';
      }).length,
      controls: controls.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(style.fontSize),
          tag: element.tagName,
        };
      }),
      editorialButtons: elements
        .filter((element) => element.matches('.ec-btn'))
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            fontSize: Number.parseFloat(style.fontSize),
            fontWeight: Number.parseInt(style.fontWeight, 10),
          };
        }),
    };
  });

  expect(metrics.overflow).toBeLessThanOrEqual(1);
  expect(metrics.gradients).toBe(0);
  expect(metrics.glass).toBe(0);
  expect(metrics.controls.length).toBeGreaterThan(0);
  expect(metrics.controls.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  expect(metrics.controls
    .filter(({ tag }) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag))
    .every(({ fontSize }) => fontSize >= 16)).toBe(true);
  expect(metrics.editorialButtons
    .every(({ fontWeight }) => fontWeight >= 600)).toBe(true);
}

async function assertVisibleFocus(page: Page) {
  const target = page.getByTestId('map-editorial-shell').locator('button, a').first();
  await target.focus();
  await expect.poll(() => target.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible')
      && style.outlineStyle !== 'none'
      && Number.parseFloat(style.outlineWidth) >= 2
      && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);
}

test('real signed-out map entry stays read-only without the development fixture', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installLanguage(page, 'en');
  const writes: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('map-editorial-shell')).toHaveAttribute('data-state', 'signed-out');
  await expect(page).toHaveTitle('Route Map | CocoTrip');
  await expect(page.getByRole('heading', { level: 2, name: 'Sign in to see your routes' })).toBeVisible();
  await assertGeometry(page);

  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} map states stay editorial and read-only`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
      const writes: string[] = [];
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const ownDomainErrors: string[] = [];

      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.origin === new URL(page.url() || 'http://localhost').origin && response.status() >= 400) {
          ownDomainErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      for (const state of STATES) {
        await page.goto(`/map?__fixture=${state}`, { waitUntil: 'domcontentloaded' });
        const shell = page.getByTestId('map-editorial-shell');
        await expect(shell).toHaveAttribute('data-state', state);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(page).toHaveTitle(`${TITLES[language]} | CocoTrip`);
        await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', TITLES[language]);
        await expect(page.getByRole('heading', { level: 1, name: TITLES[language] })).toBeVisible();

        if (state === 'normal') {
          await expect(page.getByTestId('day-route-map')).toBeVisible();
          await expect(page.getByRole('tablist')).toBeVisible();
        }
        if (state === 'loading') await expect(page.getByRole('status')).toHaveAttribute('aria-busy', 'true');
        if (state === 'error') await expect(page.getByRole('button', { name: /다시|again|再試行|重试/i })).toBeVisible();
        if (state === 'partial') await expect(page.getByTestId('map-partial-state')).toBeVisible();

        await assertVisibleFocus(page);
        await assertGeometry(page);
      }

      expect(writes).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(ownDomainErrors).toEqual([]);
    });
  }
}
