import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
const TABS = ['overview', 'bookings', 'courses', 'coupons', 'wishlist', 'reviews', 'history'];
test.use({ baseURL: BASE.origin, serviceWorkers: 'block', reducedMotion: 'reduce', actionTimeout: 15000 });
test.setTimeout(240000);

async function boundary(page: Page, width: number, language: string) {
  expect(BASE.origin).toBe('http://127.0.0.1:5178');
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript((lang) => {
    localStorage.setItem('cocotrip_lang', lang);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, language);
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname === '/api/reviews' && request.method() === 'POST') {
      let action: unknown;
      try { action = request.postDataJSON()?.action; } catch { /* denied below */ }
      if (action === 'list' || action === 'aggregate') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: action === 'list' ? { reviews: [], count: 0, nextCursor: null } : { aggregates: {} } }) });
    }
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (/^\/api\/_shared\/[^?]+\.js$/.test(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  return { writes, errors };
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
  const metrics = await page.evaluate(() => {
    const selectors = ['.mypage-editorial-profile', '.mypage-editorial-tier', '.mypage-editorial-tabs', '[role="tabpanel"]', '.mypage-editorial-stat-label', '.mypage-editorial-stat-sub', '.mypage-editorial-redeem-note', '.mypage-editorial-wallet-tabs', '.mypage-editorial-coupon', '.mypage-editorial-review', '[aria-live="assertive"]', '[data-testid="mypage-loading"]'];
    return {
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      elements: selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => el.getClientRects().length).map((el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return { selector, text: el.innerText.slice(0, 180), font: style.fontSize, color: style.color, background: style.backgroundColor, x: box.x, y: box.y, width: box.width, height: box.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      })),
      smallControls: Array.from(document.querySelectorAll<HTMLElement>('main button,main a,main input')).filter((el) => el.getClientRects().length).map((el) => {
        const r = el.getBoundingClientRect();
        return { label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 50), width: r.width, height: r.height };
      }).filter((box) => box.width < 44 || box.height < 44),
    };
  });
  const metricsPath = info.outputPath(`${name}.json`);
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  expect(metrics.documentOverflow).toBeLessThanOrEqual(1);
}

async function fixture(page: Page, state: string) {
  await page.goto(`/dev/mypage-editorial?__fixture=${state}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('mypage-editorial-shell')).toBeVisible({ timeout: 30000 });
  // DEV routes intentionally omit customerNight. Apply only the existing App.tsx
  // display:contents wrapper's visual class in this test, without changing auth,
  // fixtures, hooks or production routing. This is simulated signed-in UI.
  const scopeCount = await page.getByTestId('mypage-editorial-shell').evaluate((shell) => {
    let ancestor = shell.parentElement;
    while (ancestor && ancestor.style.display !== 'contents') ancestor = ancestor.parentElement;
    if (!ancestor) return 0;
    ancestor.classList.add('ec-night');
    return 1;
  });
  expect(scopeCount).toBe(1);
  await expect(page.getByTestId('mypage-editorial-shell')).toHaveCSS('background-color', 'rgb(10, 11, 20)');
}

async function tab(page: Page, id: string) {
  await page.locator(`#mypage-tab-${id}`).click();
  await expect(page.locator(`#mypage-panel-${id}`)).toBeVisible();
  await expect(page.locator(`#mypage-tab-${id}`)).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
}

async function tierContrast(page: Page) {
  const paint = await page.locator('.mypage-editorial-tier').evaluate((el) => {
    const style = getComputedStyle(el);
    return { foreground: style.color, background: style.backgroundColor };
  });
  const luminance = (color: string) => {
    const rgb = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(paint.foreground), luminance(paint.background)].sort((a, b) => b - a);
  return { ...paint, contrast: (values[0] + 0.05) / (values[1] + 0.05) };
}

for (const { width, language } of [
  { width: 390, language: 'ko' }, { width: 1280, language: 'ko' },
  { width: 390, language: 'en' }, { width: 390, language: 'ja' }, { width: 390, language: 'zh' },
]) {
  test(`${width} ${language}: signed-out and simulated account states`, async ({ page }, info) => {
    const audit = await boundary(page, width, language);
    await page.goto('/mypage', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('auth-required-shell')).toHaveAttribute('data-state', 'signed-out', { timeout: 30000 });
    await capture(page, info, `${width}-auth-actual-signed-out`);
    for (const state of ['signed-out', 'loading', 'error']) {
      await page.goto(`/mypage?__authFixture=${state}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('auth-required-shell')).toHaveAttribute('data-state', state, { timeout: 30000 });
      await capture(page, info, `${width}-auth-fixture-${state}`);
    }
    await fixture(page, 'normal');
    await expect(page.locator('.mypage-editorial-name')).toHaveText('Coco Traveler');
    await expect(page.locator('.mypage-editorial-email')).toHaveText('traveler@example.com');
    await expect(page.locator('.mypage-editorial-coins')).toContainText('2,450');
    const gold = await tierContrast(page);
    expect.soft(gold.contrast, 'Gold tier text contrast').toBeGreaterThanOrEqual(4.5);
    for (const id of TABS) {
      await tab(page, id);
      await capture(page, info, `${width}-normal-${id}`);
      if (id === 'overview') {
        const next = await page.locator('.mypage-editorial-nexttrip').boundingBox();
        const tabs = await page.locator('.mypage-editorial-tabs').boundingBox();
        expect.soft(next!.y - (tabs!.y + tabs!.height), 'Tab content has separation').toBeGreaterThanOrEqual(16);
      }
      if (id === 'coupons') {
        const redeem = page.locator('.mypage-editorial-redeem-option');
        await expect(redeem).toHaveCount(3);
        for (const option of await redeem.all()) await expect(option).toBeDisabled();
        await expect(page.locator('.mypage-editorial-redeem-value')).toHaveText(['$5', '$10', '$25']);
        await expect(page.locator('.mypage-editorial-coupon-code')).toHaveText('COCO-FIXTURE');
        const walletTop = await page.locator('.mypage-editorial-wallet-tabs').evaluate((el) => el.getBoundingClientRect().top + scrollY);
        await page.evaluate((top) => scrollTo({ top: Math.max(0, top - 110), behavior: 'instant' }), walletTop);
        await capture(page, info, `${width}-normal-coupon-wallet`);
        await expect.soft(page.locator('.mypage-editorial-wallet-tab').first()).toHaveAttribute('aria-pressed', 'true');
        for (let index = 1; index < 3; index += 1) {
          await page.locator('.mypage-editorial-wallet-tab').nth(index).click();
          await expect.soft(page.locator('.mypage-editorial-wallet-tab').nth(index)).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('.mypage-editorial-empty-note')).toBeVisible();
          await capture(page, info, `${width}-wallet-empty-${index}`);
        }
      }
      if (id === 'reviews') {
        await expect(page.locator('.mypage-editorial-review-delete')).toBeDisabled();
        const target = await page.locator('.mypage-editorial-review-delete').boundingBox();
        expect.soft(target!.width, 'Review delete target width').toBeGreaterThanOrEqual(44);
      }
    }
    await fixture(page, 'loading');
    await expect(page.getByTestId('mypage-loading')).toHaveAttribute('aria-busy', 'true');
    await capture(page, info, `${width}-account-loading`);
    await fixture(page, 'empty');
    await expect(page.locator('.mypage-editorial-coins strong')).toHaveText('0');
    const bronze = await tierContrast(page);
    expect.soft(bronze.contrast, 'Bronze tier text contrast').toBeGreaterThanOrEqual(4.5);
    for (const id of TABS) {
      await tab(page, id);
      await capture(page, info, `${width}-empty-${id}`);
    }
    await fixture(page, 'review-error&tab=reviews');
    await tab(page, 'reviews');
    await expect(page.locator('#mypage-panel-reviews [aria-live="assertive"]')).toBeVisible();
    await capture(page, info, `${width}-review-error`);
    expect(audit.writes).toEqual([]);
    expect(audit.errors).toEqual([]);
    await writeFile(info.outputPath(`${width}-tier-contrast.json`), JSON.stringify({ gold, bronze }, null, 2));
  });
}
