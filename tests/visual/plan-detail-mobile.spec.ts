/**
 * Plan detail visual smoke test.
 *
 * The previous pixel baseline depended on a mutable production plan and old
 * `.plan-mobile-*` selectors. This fixture keeps the preview check deterministic,
 * asserts the document geometry directly, and uploads screenshots for review.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect } from '../e2e/fixtures/analytics-guard';
import { suppressCookieBanner } from './helpers';

const PLAN_ID = 'visual-plan-detail-fixture';
const NEUTRAL_TILE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f2efe8"/></svg>';

const PLAN_FIXTURE = {
  id: PLAN_ID,
  isPublic: true,
  status: 'ready',
  input: {
    language: 'en',
    area: 'Seoul',
    regions: ['seoul'],
    startDate: '2026-09-12',
    adults: 2,
  },
  itinerary: {
    tour_title: 'Two days in Seoul',
    days: [{
      day: 1,
      date: '2026-09-12',
      city: 'Seoul',
      theme: 'City and river',
      stops: [
        {
          start_time: '09:00',
          stay_min: 90,
          category: 'attraction',
          display_name: 'Gyeongbokgung Palace',
          address: '161 Sajik-ro, Jongno-gu, Seoul',
          lat: 37.5796,
          lng: 126.977,
          tip: 'Check the route details before departure.',
        },
        {
          start_time: '11:10',
          stay_min: 70,
          category: 'culture',
          display_name: 'Bukchon Hanok Village',
          address: '37 Gyedong-gil, Jongno-gu, Seoul',
          lat: 37.5826,
          lng: 126.983,
          transit_from_prev: {
            method: 'subway',
            est_min: 20,
            fare: 1500,
            transfers: 0,
            walk_min: 6,
          },
        },
      ],
    }],
  },
};

async function installDeterministicRoutes(page: Page, planStatus = 200) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cocotrip_lang', 'en');
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  });
  await suppressCookieBanner(page);
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: '',
  }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**://*.basemaps.cartocdn.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: NEUTRAL_TILE,
  }));
  await page.route('**/api/get-plan?**', (route: Route) => route.fulfill({
    status: planStatus,
    contentType: 'application/json',
    body: planStatus === 200
      ? JSON.stringify({ ok: true, plan: PLAN_FIXTURE })
      : JSON.stringify({ ok: false }),
  }));
  await page.route('**/api/reviews', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reviews: [] }),
  }));
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
}

test.describe('Plan detail editorial document visual smoke', () => {
  test('document masthead, tabs, map, and stops stay usable', async ({ page }, testInfo) => {
    await installDeterministicRoutes(page);
    await page.goto(`/my-plans/${PLAN_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('plan-document-ready')).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByTestId('plan-document-masthead')).toContainText('Two days in Seoul');
    await expect(page.getByTestId('plan-document-status-ready')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const shareButton = page.getByTestId('plan-share-mini');
    await expect(shareButton).toBeVisible();
    const shareBox = await shareButton.boundingBox();
    expect(shareBox?.height).toBeGreaterThanOrEqual(44);

    const tabHeights = await page.getByTestId('section-tabs-scroll').getByRole('tab').evaluateAll(
      (tabs) => tabs.map((tab) => tab.getBoundingClientRect().height),
    );
    expect(tabHeights.length).toBeGreaterThan(1);
    expect(tabHeights.every((height) => height >= 44)).toBe(true);

    await testInfo.attach('plan-detail-document-top', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });

    await expect(page.locator('[data-scroll-affordance]')).toHaveScreenshot(
      'section-tabs-scroll-affordance.png',
    );

    await page.getByTestId('section-tabs-scroll').getByRole('tab', { name: 'Day 1' }).click();
    const routeMap = page.getByTestId('day-route-map');
    await expect(routeMap).toContainText('Bukchon Hanok Village');
    await routeMap.scrollIntoViewIfNeeded();

    const headerBox = await page.locator('header.ec-no-print').boundingBox();
    const stickyTabsBox = await page.getByTestId('section-tabs-scroll').locator('..').boundingBox();
    expect(Math.abs((stickyTabsBox?.y || 0) - ((headerBox?.y || 0) + (headerBox?.height || 0)))).toBeLessThanOrEqual(1);

    const mapControlHeights = await routeMap.locator('[data-route-map-control], .leaflet-control-zoom a').evaluateAll(
      (controls) => controls.map((control) => control.getBoundingClientRect().height),
    );
    expect(mapControlHeights.length).toBeGreaterThan(0);
    expect(mapControlHeights.every((height) => height >= 44)).toBe(true);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const firstStop = page.getByRole('button', { name: /Gyeongbokgung Palace/ }).first();
    await firstStop.click();
    await expect(firstStop).toHaveAttribute('aria-expanded', 'true');

    await testInfo.attach('plan-detail-day-route', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });

    const tabs = page.getByTestId('section-tabs-scroll').getByRole('tab');
    const tabCount = await tabs.count();
    await tabs.nth(tabCount - 2).click();
    await expect(page.getByTestId('plan-pre-trip-slide')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await testInfo.attach('plan-detail-pre-trip', {
      body: await page.screenshot({ animations: 'disabled', fullPage: true }),
      contentType: 'image/png',
    });

    await tabs.nth(tabCount - 1).click();
    await expect(page.getByTestId('plan-outro-slide')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await testInfo.attach('plan-detail-wrap-up', {
      body: await page.screenshot({ animations: 'disabled', fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('permission state is a complete terminal surface', async ({ page }, testInfo) => {
    await installDeterministicRoutes(page, 403);
    await page.goto(`/my-plans/${PLAN_ID}-permission`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('plan-detail-permission')).toBeVisible();
    await expect(page.getByTestId('plan-detail-permission')).toContainText('Access Denied');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await testInfo.attach('plan-detail-permission-state', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
  });
});
