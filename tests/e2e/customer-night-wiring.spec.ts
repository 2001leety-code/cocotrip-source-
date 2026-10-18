import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Customer night rollout — wiring regressions on real UI (local preview only).
 *
 * Every non-local request is aborted; only the local `/api/*` boundary is
 * fulfilled (empty JSON), so nothing reaches a real API, DB or auth provider.
 * Nothing is submitted: the charter case stops at the step gate.
 */

test.use({ serviceWorkers: 'block' });

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');

async function setupPage(page: Page) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');

  await page.addInitScript((origin) => {
    if (window.location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', 'en');
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, BASE.origin);

  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin) {
      external.push(url.origin);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { pageErrors, external };
}

test('planner: /planner?prefillRegions=seoul lands Seoul as the selected main base', async ({ page }) => {
  const { pageErrors } = await setupPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/planner?prefillRegions=seoul', { waitUntil: 'domcontentloaded' });

  // AI intro modal opens on first visit; close it the way a visitor would.
  const intro = page.getByRole('dialog', { name: /./ }).filter({ has: page.locator('#ai-intro-title') });
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(intro).toBeHidden();

  await page.getByRole('button', { name: /Nothing booked yet/i }).first().click();
  await page.getByRole('button', { name: /^Continue$/ }).first().click();

  const seoul = page.getByRole('button', { name: /^Seoul/ }).first();
  await expect(seoul).toHaveAttribute('aria-pressed', 'true');
  await expect(seoul).toContainText('Main base');
  await expect(seoul).toHaveClass(/\bis-selected\b/);
  await expect(page.locator('.ec-night').getByRole('button', { name: /^Seoul/ }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('tours: a region filter changes the card set and every card links to a tour detail', async ({ page }) => {
  const { pageErrors } = await setupPage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/tours', { waitUntil: 'domcontentloaded' });

  const grid = page.getByTestId('tours-grid');
  await expect(grid.locator('h3').first()).toBeVisible();
  const cardHrefs = () =>
    grid.locator('a[href^="/tours/"]').evaluateAll((els) => [...new Set(els.map((a) => a.getAttribute('href')))]);
  const before = await cardHrefs();
  expect(before.length).toBeGreaterThan(1);

  // First rail entry is "all"; pick the first real region.
  const region = page.getByTestId('tours-region-rail').locator('button').nth(1);
  await region.click();
  await expect(region).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(cardHrefs).not.toEqual(before);
  const after = await cardHrefs();
  expect(after.length).toBeGreaterThan(0);
  for (const href of after) expect(href).toMatch(/^\/tours\/[^/?#]+/);

  // Card link opens the detail route for that tour.
  await grid.locator(`a[href="${after[0]}"]`).first().click();
  await page.waitForURL((url) => url.pathname === after[0]);
  expect(pageErrors).toEqual([]);
});

test('charter: Next stays blocked until the required origin is chosen (nothing is sent)', async ({ page }) => {
  const { pageErrors } = await setupPage(page);
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET') posts.push(`${req.method()} ${req.url()}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/charter', { waitUntil: 'domcontentloaded' });

  const next = page.getByRole('button', { name: /^Next/ }).last();
  await expect(next).toBeVisible();
  await expect(next).toBeDisabled();

  const origin = page.locator('main button[data-origin-code]').first();
  await expect(origin).toHaveAttribute('aria-pressed', 'false');
  await origin.click();
  await expect(origin).toHaveAttribute('aria-pressed', 'true');
  await expect(next).toBeEnabled();
  expect(posts).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('auth guard: signed-out /mypage shows the login shell, not account content', async ({ page }) => {
  const { pageErrors } = await setupPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mypage', { waitUntil: 'domcontentloaded' });

  const shell = page.getByTestId('auth-required-shell');
  await expect(shell).toHaveAttribute('data-state', 'signed-out', { timeout: 15000 });
  const actions = page.locator('.auth-required-action:visible');
  expect(await actions.count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('div.ec-night')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});
