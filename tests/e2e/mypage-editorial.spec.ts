import { test, expect } from './fixtures/analytics-guard';
import type { Page } from '@playwright/test';

const LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXPECTED_ORIGIN = new URL(process.env.BASE_URL || 'https://cocotripkr.com').origin;

function watchPage(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const writeRequests: string[] = [];
  const badResponses: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === EXPECTED_ORIGIN && !SAFE_METHODS.has(request.method())) {
      writeRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === EXPECTED_ORIGIN && response.status() >= 400) {
      badResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  return { pageErrors, consoleErrors, writeRequests, badResponses };
}

test.describe('/mypage editorial shell', () => {
  for (const viewport of VIEWPORTS) {
    for (const language of LANGUAGES) {
      test(`${viewport.width}px × ${language} normal`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
        await page.setViewportSize(viewport);
        const signals = watchPage(page);
        await page.addInitScript((nextLanguage) => {
          localStorage.setItem('cocotrip_lang', nextLanguage);
        }, language);

        await page.goto('/dev/mypage-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });

        const shell = page.getByTestId('mypage-editorial-shell');
        const main = page.locator('main.mypage-editorial-main');
        await expect(shell).toBeVisible();
        await expect(shell).toHaveClass(/\bec-root\b/);
        await expect(main).toBeVisible();
        await expect(page.getByRole('tablist')).toBeVisible();
        await expect(page.locator('.mypage-editorial-profile')).toBeVisible();

        const paint = await shell.evaluate((element: HTMLElement) => {
          const style = getComputedStyle(element);
          return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
        });
        expect(paint.backgroundImage).toBe('none');
        expect(paint.backgroundColor).not.toBe('rgb(8, 11, 20)');

        const controls = main.locator('a, button, input, select, textarea');
        const controlCount = await controls.count();
        for (let index = 0; index < controlCount; index += 1) {
          const control = controls.nth(index);
          if (!await control.isVisible()) continue;
          const box = await control.boundingBox();
          expect(box, `control ${index} should have geometry`).not.toBeNull();
          expect(box!.width, `control ${index} width`).toBeGreaterThanOrEqual(44);
          expect(box!.height, `control ${index} height`).toBeGreaterThanOrEqual(44);
        }

        const activeTab = page.getByRole('tab', { selected: true });
        await activeTab.focus();
        const focus = await activeTab.evaluate((element: HTMLElement) => {
          const style = getComputedStyle(element);
          return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
        });
        expect(focus.outlineStyle).not.toBe('none');
        expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);

        for (const tabId of ['bookings', 'courses', 'coupons', 'wishlist', 'reviews', 'history']) {
          await page.locator(`#mypage-tab-${tabId}`).click();
          await expect(page.locator(`#mypage-panel-${tabId}`)).toBeVisible();
        }

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        expect(signals.pageErrors).toEqual([]);
        expect(signals.consoleErrors).toEqual([]);
        expect(signals.writeRequests).toEqual([]);
        expect(signals.badResponses).toEqual([]);
      });
    }
  }

  for (const language of LANGUAGES) {
    test(`390px × ${language} loading, empty and review error`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((nextLanguage) => {
        localStorage.setItem('cocotrip_lang', nextLanguage);
      }, language);

      await page.goto('/dev/mypage-editorial?__fixture=loading', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('mypage-loading')).toHaveAttribute('aria-busy', 'true');

      await page.goto('/dev/mypage-editorial?__fixture=empty&tab=wishlist', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#mypage-panel-wishlist')).toBeVisible();
      await expect(page.locator('#mypage-panel-wishlist [role="status"], #mypage-panel-wishlist h2')).toBeVisible();

      await page.goto('/dev/mypage-editorial?__fixture=review-error&tab=reviews', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#mypage-panel-reviews [aria-live="assertive"]')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
