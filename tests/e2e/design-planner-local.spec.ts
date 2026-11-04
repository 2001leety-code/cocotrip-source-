import { writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Local presentation checks for the planner's shared inputs and city tiles.
 * Every run enforces the layout criteria and saves measurements/screenshots.
 * Page errors or attempted writes fail; no generation, authentication or payment.
 */
const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
const STAGE = 'after';
type Lang = 'ko' | 'en' | 'ja' | 'zh';
test.use({ serviceWorkers: 'block', baseURL: BASE.origin, reducedMotion: 'reduce' });

async function setupPage(page: Page, lang: Lang, width: number) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(([origin, language]) => {
    if (location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', language);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    localStorage.setItem('COCO_AI_INTRO_SEEN_v1', '1');
  }, [BASE.origin, lang]);

  const writes: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    // These are frontend-imported source modules, not live backend calls.
    if (/^\/api\/_shared\/[^?]+\.js$/.test(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  // This is a lazy Vite development bundle, not a page-speed assertion.
  // Keep first-load readiness separate from the layout checks below.
  await expect(page.locator('.wizard-res-ticket')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#ai-intro-title')).toHaveCount(0);
  return { writes, pageErrors };
}

async function attachEvidence(page: Page, testInfo: TestInfo, name: string, data: unknown) {
  const stem = `${STAGE}-${name}`;
  const measurements = testInfo.outputPath(`${stem}.json`);
  writeFileSync(measurements, JSON.stringify({ stage: STAGE, data }, null, 2), 'utf8');
  await testInfo.attach(`${stem}-measurements`, {
    path: measurements,
    contentType: 'application/json',
  });
  const screenshot = testInfo.outputPath(`${stem}.png`);
  await page.screenshot({ path: screenshot });
  await testInfo.attach(stem, { path: screenshot, contentType: 'image/png' });
}

async function expectNoOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(size.content).toBeLessThanOrEqual(size.viewport + 1);
}

test('390 ko: flight inputs have readable labels and actionable missing-field summary', async ({ page }, testInfo) => {
  const guards = await setupPage(page, 'ko', 390);
  const ticket = page.locator('.wizard-res-ticket');
  await ticket.getByRole('button', { name: '항공권·호텔 예약', exact: true }).click();
  const labels = ticket.locator('label');
  await expect(labels).toHaveCount(3);
  const labelMetrics = await labels.evaluateAll((items) => items.map((item) => ({
    text: item.textContent?.trim(),
    size: parseFloat(getComputedStyle(item).fontSize),
    linked: (item as HTMLLabelElement).control !== null,
  })));

  // Leave required fields empty; this is client validation, not a request.
  await ticket.locator('.wizard-res-cta').click();
  const summary = ticket.locator(':scope > [role="alert"]');
  await expect(summary).toBeVisible();
  await expect(summary.getByRole('button')).toHaveCount(2);
  await summary.scrollIntoViewIfNeeded();
  const summaryMetrics = await summary.evaluate((el) => {
    const title = el.querySelector('p')!.getBoundingClientRect();
    const list = el.querySelector('ul')!.getBoundingClientRect();
    return {
      titleBottom: title.bottom,
      listTop: list.top,
      targets: Array.from(el.querySelectorAll('button')).map((button) => ({
        text: button.textContent?.trim(),
        height: button.getBoundingClientRect().height,
      })),
    };
  });
  await attachEvidence(page, testInfo, 'reservation-errors-390-ko', { labels: labelMetrics, summary: summaryMetrics });

  for (const label of labelMetrics) {
    expect(label.size, label.text).toBeGreaterThanOrEqual(14);
    expect(label.linked, label.text).toBe(true);
  }
  await expect(ticket.getByLabel('도착 공항', { exact: true })).toHaveCount(1);
  await expect(ticket.getByLabel('도착 시각', { exact: true })).toHaveCount(1);
  await expect(ticket.getByLabel(/호텔 주소/)).toHaveCount(1);
  expect(summaryMetrics.listTop).toBeGreaterThanOrEqual(summaryMetrics.titleBottom);
  for (const target of summaryMetrics.targets) expect(target.height, target.text).toBeGreaterThanOrEqual(44);

  // The summary remains a working shortcut to the original target wrapper.
  await summary.getByRole('button', { name: '도착 시각을 입력해주세요', exact: true }).click();
  await expect.poll(() => ticket.locator('input[type="time"]').evaluate((el) =>
    document.activeElement === el || !!document.activeElement?.contains(el),
  )).toBe(true);
  const time = await ticket.locator('input[type="time"]').boundingBox();
  expect(time).not.toBeNull();
  expect(time!.y).toBeGreaterThanOrEqual(0);
  expect(time!.y + time!.height).toBeLessThanOrEqual(844);
  await expectNoOverflow(page);
  expect(guards.writes).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
});

const CITY_NAME: Record<Lang, string> = { ko: '강릉', en: 'Gangneung', ja: '江陵', zh: '江陵' };
const CITY_CASES: Array<{ lang: Lang; width: number }> = [
  { lang: 'ko', width: 390 }, { lang: 'en', width: 390 },
  { lang: 'ja', width: 390 }, { lang: 'zh', width: 390 },
  { lang: 'en', width: 360 },
];

for (const { lang, width } of CITY_CASES) {
  test(`${width} ${lang}: selected city name is clear of the check mark`, async ({ page }, testInfo) => {
    const guards = await setupPage(page, lang, width);
    await page.locator('.wizard-res-row').first().click();
    await page.locator('.wizard-res-cta').click();
    const destination = page.locator('.wizard-stage--dest');
    await expect(destination).toBeVisible();
    const city = destination.locator('.wizard-city-grid button').filter({
      has: page.locator('.wizard-city-name').filter({ hasText: CITY_NAME[lang] }),
    });
    await expect(city).toHaveCount(1);
    await city.click();
    await expect(city).toHaveAttribute('aria-pressed', 'true');
    await expect(city.locator('.wizard-city-main')).toBeVisible();
    await city.scrollIntoViewIfNeeded();
    // The thumbnail is a local asset; capture the actual photo state rather
    // than a transient blank image while Vite is still serving lazy images.
    await expect.poll(() => city.locator('img').evaluate((el) => {
      const image = el as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    }), { timeout: 15000 }).toBe(true);

    const metrics = await city.evaluate((el) => {
      const rect = (item: Element) => {
        const b = item.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
      };
      const name = el.querySelector('.wizard-city-name')!;
      const mark = el.querySelector(':scope > span > svg')!;
      const photo = el.querySelector('img')!;
      const a = rect(name);
      const b = rect(mark);
      const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
      return { name: name.textContent, nameRect: a, checkRect: b, overlap, tile: rect(el), photoWidth: photo.naturalWidth };
    });
    await attachEvidence(page, testInfo, `city-${width}-${lang}`, metrics);
    expect(metrics.overlap, 'The selection mark must not cover the city name').toBe(0);
    expect(metrics.tile.height).toBeGreaterThanOrEqual(44);
    await expectNoOverflow(page);
    expect(guards.writes).toEqual([]);
    expect(guards.pageErrors).toEqual([]);
  });
}

test('1280 en: current step has a visible descriptive label', async ({ page }, testInfo) => {
  const guards = await setupPage(page, 'en', 1280);
  const current = page.locator('.ec-steptick[aria-current="step"]');
  await expect(current).toHaveCount(1);
  const label = current.locator('span:not(.ec-figure)');
  await expect(label).toHaveCount(1);
  const metrics = await label.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { text: el.textContent, width: rect.width, height: rect.height, clip: style.clip, display: style.display };
  });
  await attachEvidence(page, testInfo, 'current-step-1280-en', metrics);
  expect(metrics.width).toBeGreaterThan(1);
  expect(metrics.height).toBeGreaterThanOrEqual(14);
  expect(metrics.clip).toBe('auto');
  expect(metrics.display).not.toBe('none');
  await expectNoOverflow(page);
  expect(guards.writes).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
});
