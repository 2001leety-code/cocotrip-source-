import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Shared customer navigation at phone, tablet and desktop widths.
 * Local UI only: external traffic and writes are blocked, local API reads use
 * an empty synthetic response (including public review list/aggregate POSTs).
 * No sign-in, booking or payment is attempted.
 *
 * Run against the isolated build on http://127.0.0.1:5178 with Desktop Chrome.
 * The 820px cases cover the gap between the phone menu and desktop navigation.
 */
const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
test.use({ serviceWorkers: 'block', baseURL: BASE.origin });

async function setupPage(page: Page) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');

  await page.addInitScript((origin) => {
    if (location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', 'en');
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, BASE.origin);

  const writes: string[] = [];
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    // These POST actions only read published reviews (api/reviews.js).
    // Tours uses aggregate; ReviewList uses list. Every other action still
    // reaches the write guard below, including malformed request bodies.
    if (url.pathname === '/api/reviews' && request.method() === 'POST') {
      let action: unknown;
      try { action = request.postDataJSON()?.action; } catch { /* blocked below */ }
      if (action === 'list' || action === 'aggregate') {
        const data = action === 'list'
          ? { reviews: [], nextCursor: null, count: 0 }
          : { aggregates: {} };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, data }),
        });
      }
    }
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    // Vite serves these frontend source imports; no backend is executed here.
    if (/^\/api\/_shared\/[^?]+\.js$/.test(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { writes, pageErrors };
}

type CustomerRoute = '/tours' | '/charter';

test('tablet breakpoint edges preserve navigation and keyboard escape', async ({ page }) => {
  const { writes, pageErrors } = await setupPage(page);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/tours', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('tours-grid')).toBeVisible({ timeout: 30000 });
  const header = page.locator('header.ec-no-print').first();
  const trigger = header.getByRole('button', { name: 'Navigation', exact: true });
  const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
  for (const width of [768, 1023, 1024, 1279, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024) {
      await expect(trigger).toBeVisible();
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await page.keyboard.press('Tab');
      await expect.poll(() => menu.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } else {
      await expect(trigger).toBeHidden();
      await expect(header.locator('nav a[href="/charter"]')).toBeVisible();
    }
    await expect(page.locator('html')).not.toHaveAttribute('data-menu-open', 'true');
    await expectNoHorizontalOverflow(page);
  }
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function expectRouteContent(page: Page, route: CustomerRoute) {
  await expect(page).toHaveURL(new URL(route, BASE).href);
  if (route === '/tours') {
    await expect(page.getByTestId('tours-editorial-shell')).toBeVisible();
    await expect(page.getByTestId('tours-grid')).toBeVisible();
  } else {
    await expect(page.locator('main button[data-origin-code]').first()).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

for (const from of ['/tours', '/charter'] as const) {
  const to: CustomerRoute = from === '/tours' ? '/charter' : '/tours';

  for (const width of [390, 820]) {
    test(`${width}px ${from}: menu opens, closes and navigates to ${to}`, async ({ page }, testInfo) => {
      const { writes, pageErrors } = await setupPage(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(from, { waitUntil: 'domcontentloaded' });
      await expectRouteContent(page, from);
      await expectNoHorizontalOverflow(page);

      const header = page.locator('header.ec-no-print').first();
      const menuButton = header.getByRole('button', { name: 'Navigation', exact: true });
      const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
      await expect(menuButton).toBeVisible();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      const triggerBox = await menuButton.boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
      expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
      expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(width + 1);

      await menuButton.click();
      await expect(menu).toBeVisible();
      const destination = menu.locator(`nav a[href="${to}"]`).first();
      await expect(destination).toBeVisible();
      // The first menu action must clear the sticky header, including tablets.
      const firstAction = await menu.locator('a[href="/mypage"]').first().boundingBox();
      const headerBox = await header.boundingBox();
      expect(firstAction).not.toBeNull();
      expect(headerBox).not.toBeNull();
      expect(firstAction!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
      const menuScreenshot = testInfo.outputPath('navigation-open.png');
      await page.screenshot({ path: menuScreenshot });
      await testInfo.attach('navigation-open', { path: menuScreenshot, contentType: 'image/png' });

      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(menuButton).toBeFocused();
      await expect(page.locator('html')).not.toHaveAttribute('data-menu-open', 'true');

      await menuButton.click();
      await expect(menu).toBeVisible();
      // Use the expanded trigger: its accessible name changes to the close label.
      await header.locator('button[aria-expanded="true"]').click();
      await expect(menu).toHaveCount(0);
      await expect(menuButton).toBeFocused();

      if (width === 820) {
        await menuButton.click();
        await expect(menu).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(menu).toHaveCount(0);
        await expect(page.locator('html')).not.toHaveAttribute('data-menu-open', 'true');
        await page.setViewportSize({ width, height: 900 });
        await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      }

      await menuButton.click();
      await expect(menu).toBeVisible();
      await destination.click();
      await expectRouteContent(page, to);
      await expect(menu).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveAttribute('data-menu-open', 'true');
      await expectNoHorizontalOverflow(page);
      if (width === 390) await expect(page.locator('.mobile-bottom-nav')).toBeVisible();
      else await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
      expect(writes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  test(`1280px ${from}: desktop navigation stays visible and opens ${to}`, async ({ page }, testInfo) => {
    const { writes, pageErrors } = await setupPage(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(from, { waitUntil: 'domcontentloaded' });
    await expectRouteContent(page, from);
    await expectNoHorizontalOverflow(page);

    const header = page.locator('header.ec-no-print').first();
    await expect(header.getByRole('button', { name: 'Navigation', exact: true })).toHaveCount(0);
    for (const href of ['/charter', '/tours', '/planner', '/community', '/about']) {
      const link = header.locator(`nav a[href="${href}"]`);
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1281);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
    await testInfo.attach('desktop-navigation', { body: await page.screenshot(), contentType: 'image/png' });
    await header.locator(`nav a[href="${to}"]`).click();
    await expectRouteContent(page, to);
    await expectNoHorizontalOverflow(page);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
