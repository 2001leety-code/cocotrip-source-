import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';
import notFoundHandler from '../../api/not-found.js';

type Language = 'ko' | 'en' | 'ja' | 'zh';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';
const COPY = {
  en: 'Page not found',
  ko: '페이지를 찾을 수 없습니다',
  ja: 'ページが見つかりません',
  zh: '页面未找到',
} as const;

async function installLanguage(page: Page, language: Language) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('cocotrip_lang', value);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  }, language);
}

async function isolateExternalAssets(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: '',
  }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
}

async function assertEditorialGeometry(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const controls = page.locator('.not-found-editorial a:visible, .not-found-editorial button:visible');
  const geometry = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter,
    };
  }));
  expect(geometry.length).toBeGreaterThanOrEqual(3);
  expect(geometry.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
  expect(geometry.every(({ backgroundImage }) => !backgroundImage.includes('gradient'))).toBe(true);
  expect(geometry.every(({ backdropFilter }) => backdropFilter === 'none')).toBe(true);

  const surfaces = page.locator('body, .not-found-editorial, .not-found-editorial *');
  const effects = await surfaces.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { backgroundImage: style.backgroundImage, backdropFilter: style.backdropFilter };
  }));
  expect(effects.every(({ backgroundImage }) => !backgroundImage.includes('gradient'))).toBe(true);
  expect(effects.every(({ backdropFilter }) => backdropFilter === 'none')).toBe(true);
}

async function assertVisibleFocus(page: Page) {
  const controls = page.locator('.not-found-editorial a:visible, .not-found-editorial button:visible');
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    await control.focus();
    await expect.poll(() => control.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle === 'solid'
        && Number.parseFloat(style.outlineWidth) >= 2
        && style.outlineColor !== 'rgba(0, 0, 0, 0)';
    })).toBe(true);
  }
}

function usesRemoteServer() {
  const hostname = new URL(BASE_URL).hostname;
  return hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]';
}

function invokeNotFoundHandler(language: Language) {
  let status = 0;
  let body = '';
  let headers: Record<string, string> = {};

  notFoundHandler(
    { method: 'GET', query: { lang: language }, headers: {} },
    {
      writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
        status = nextStatus;
        headers = nextHeaders;
      },
      end(nextBody = '') {
        body = nextBody;
      },
    },
  );

  return { status, headers, body };
}

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} server and app 404 stay aligned`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
      await isolateExternalAssets(page);

      let writes = 0;
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const ownDomainErrors: string[] = [];
      const expectedServerPathnames = new Set<string>();
      let expectedServerConsoleErrors = 0;
      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes += 1;
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const locationUrl = message.location().url;
        const locationPathname = locationUrl ? new URL(locationUrl).pathname : '';
        const isExpectedMain404 = expectedServerPathnames.size > 0
          && (!locationPathname || expectedServerPathnames.has(locationPathname))
          && /Failed to load resource.*404/i.test(message.text());
        if (isExpectedMain404) expectedServerConsoleErrors += 1;
        else consoleErrors.push(message.text());
      });
      page.on('response', (response) => {
        const url = new URL(response.url());
        const appOrigin = new URL(BASE_URL).origin;
        const isExpectedNotFound = /^\/(?:not-found-server-fixture|not-a-real-page-editorial-)/.test(url.pathname);
        if (url.origin === appOrigin && response.status() >= 400 && !isExpectedNotFound) {
          ownDomainErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      if (!usesRemoteServer()) {
        await page.route('**/not-found-server-fixture*', (route) => {
          const response = invokeNotFoundHandler(language);
          return route.fulfill(response);
        });
      }

      const serverPath = usesRemoteServer()
        ? `/not-a-real-page-editorial-${viewport.label}-${language}?lang=${language}`
        : `/not-found-server-fixture?lang=${language}`;
      expectedServerPathnames.add(new URL(serverPath, BASE_URL).pathname);
      const serverResponse = await page.goto(serverPath, { waitUntil: 'domcontentloaded' });
      expect(serverResponse?.status()).toBe(404);
      expect(serverResponse?.headers()['x-robots-tag']).toBe('noindex, nofollow');
      expect(serverResponse?.headers()['content-language']).toBe(language);
      expect(serverResponse?.headers().vary).toContain('Accept-Language');
      await expect(page.getByTestId('not-found-server')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: COPY[language] })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('[data-recovery-link]')).toHaveCount(3);
      await assertEditorialGeometry(page);
      await assertVisibleFocus(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        history.pushState({}, '', '/not-a-real-page-editorial-app');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page.getByTestId('not-found-editorial')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: COPY[language] })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('[data-recovery-link]')).toHaveCount(3);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      await assertEditorialGeometry(page);
      await assertVisibleFocus(page);

      expect(writes).toBe(0);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(ownDomainErrors).toEqual([]);
      expect(expectedServerConsoleErrors).toBeLessThanOrEqual(1);
    });
  }
}
