import { isAbsolute, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Planner steps 1-5 → free quick preview ("Night dossier" card), 390 ko, real page.
 * Local synthetic preview demo: no real generation. Same isolation as
 * planner-expansion-local.spec.ts — non-local requests aborted, service workers
 * blocked, local `/api/*` answers `{}`. The one exception is the free
 * `/api/ai-planner-quick` POST, answered with a synthetic body that satisfies
 * parseQuickPreviewResponse (src/pages/PlannerPage/lib/quickPreviewContract.ts).
 * Any other non-GET fails the test; purchase/login are never touched.
 *
 * EXPANSION_VIDEO=1 records 390x844 and writes quick-preview-390-ko.png into
 * EXPANSION_SCREENSHOT_DIR (absolute).
 */

const VIDEO = process.env.EXPANSION_VIDEO === '1';
test.use({ serviceWorkers: 'block' });
test.use({ video: VIDEO ? { mode: 'on', size: { width: 390, height: 844 } } : 'off' });

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
const SHOT_DIR = process.env.EXPANSION_SCREENSHOT_DIR || '';
const QUICK = '/api/ai-planner-quick';

// Synthetic, parser-valid `data` (ko headers, 3 ascending unique stops, one detail per row).
const QUICK_DATA = {
  themes: ['야경', '미식'],
  marketingNarrative: '서울의 첫날 밤을 산책과 야경, 늦은 식사로 채우는 미리보기입니다.',
  day1MarkdownTable: [
    '| 시간 | 명소 | 교통 | 팁 |',
    '|---|---|---|---|',
    '| 17:00 | 북촌 한옥마을 | 출발 지점 | 해 질 녘 골목이 가장 조용합니다 |',
    '| 19:00 | 남산서울타워 | 버스 20분 | 케이블카 대기줄은 저녁에 짧아집니다 |',
    '| 21:00 | 광장시장 | 지하철 15분 | 빈대떡은 반 장씩 나눠 주문하세요 |',
  ].join('\n'),
  reflectedConditions: ['서울', '3일', '음식', '사진'],
  deferredCategories: ['Shopping'],
  spotDetails: [
    { type: 'spot', spot: '북촌 한옥마을', candidateId: 'syn-spot-1', name: '북촌 한옥마을', address: '서울 종로구 계동길 37' },
    { type: 'attraction', spot: '남산서울타워', candidateId: 'syn-attr-2', key: 'namsan_tower', lat: 37.5512, lng: 126.9882 },
    { type: 'food', spot: '광장시장', candidateId: 'syn-food-3', placeId: 'ChIJsyntheticGwangjang01' },
  ],
};

async function setupPage(page: Page) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');

  await page.addInitScript(([origin, l]) => {
    if (window.location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', l);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, [BASE.origin, 'ko']);

  const quickBodies: Record<string, unknown>[] = [];
  const writes: string[] = [];
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname === QUICK && req.method() === 'POST') {
      quickBodies.push(req.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: QUICK_DATA }) });
    }
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${req.url()}`);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { pageErrors, writes, quickBodies };
}

const stage = (page: Page, name: string) => page.locator(`.wizard-stage--${name}`);
const next = (page: Page) => page.locator('.wizard-stage .ec-btn.ec-btn-primary').last();

/** Video only: bring the stage into view the way a visitor scrolls, then hold briefly. */
async function beat(page: Page, selector: string) {
  if (!VIDEO) return;
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
}

test('quick preview 390 ko: wizard → free preview renders the night card', async ({ page }) => {
  if (VIDEO) expect(isAbsolute(SHOT_DIR), 'EXPANSION_SCREENSHOT_DIR must be an absolute path').toBe(true);
  const { pageErrors, writes, quickBodies } = await setupPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  // Mobile: the intro dialog never opens below 768px.
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog').filter({ has: page.locator('#ai-intro-title') })).toHaveCount(0);

  await page.locator('.wizard-res-row').first().click();
  await beat(page, '.wizard-res-cta');
  await page.locator('.wizard-res-cta').click();

  await expect(stage(page, 'dest')).toBeVisible();
  await stage(page, 'dest').locator('.ec-option-sm').first().click();
  await expect(stage(page, 'dest').locator('.ec-option[aria-pressed="true"]')).not.toHaveCount(0);
  await beat(page, '.wizard-stage--dest .ec-option[aria-pressed="true"]');
  await next(page).click();

  await expect(stage(page, 'food')).toBeVisible();
  const foodStyle = stage(page, 'food').locator('.grid > .ec-option').first();
  await foodStyle.click();
  await expect(foodStyle).toHaveAttribute('aria-pressed', 'true');
  await beat(page, '.wizard-stage--food .ec-option[aria-pressed="true"]');
  await next(page).click();

  await expect(stage(page, 'details')).toBeVisible();
  const airport = stage(page, 'details').locator('[aria-haspopup="listbox"]').first();
  const placeholder = ((await airport.textContent()) || '').trim();
  await airport.click();
  await page.locator('[role="option"]:visible').first().click();
  await expect(airport).not.toHaveText(placeholder);
  await beat(page, '.wizard-stage--details [aria-haspopup="listbox"]');
  await next(page).click();

  await expect(stage(page, 'review')).toBeVisible();
  const free = stage(page, 'review').locator('.wizard-review-cta .ec-btn-primary');
  await expect(free).toBeEnabled();
  await beat(page, '.wizard-stage--review .wizard-review-cta');
  await free.click();

  const card = page.getByTestId('quick-preview-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.ec-timeline-row')).toHaveCount(3);
  await expect(card).toContainText('남산서울타워');
  // Let the app's own smooth auto-scroll to #planner-quick-result settle (no manual
  // scroll), then the preview heading must sit below the sticky header.
  await expect.poll(async () => {
    const a = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(200);
    const b = await page.evaluate(() => window.scrollY);
    return a > 0 && a === b;
  }, { timeout: 5000 }).toBe(true);
  const header = (await page.locator('header').first().boundingBox())!;
  const heading = (await card.getByRole('heading', { level: 2 }).first().boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(header.y + header.height);
  if (VIDEO) await page.waitForTimeout(400);

  // Request reflects the selected preset city (Seoul, 3 days) and airport.
  expect(quickBodies).toHaveLength(1);
  expect(quickBodies[0]).toMatchObject({ language: 'ko', cityKey: 'seoul', durationDays: 3 });
  expect((quickBodies[0].regions as string[]).length).toBeGreaterThan(0);
  expect(String(quickBodies[0].arrival_airport)).toMatch(/^(ICN|GMP)/);

  // Map links point at Google Maps; not followed.
  const hrefs = await card.locator('a.ec-maplink').evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
  expect(hrefs).toHaveLength(3);
  for (const href of hrefs) expect(href.startsWith('https://www.google.com/maps/search/?api=1')).toBe(true);

  // Every visible condition line and stop tip reads at >= 14px.
  const sizes = async (sel: string) => page.locator(sel).evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => parseFloat(getComputedStyle(e).fontSize)));
  const conditions = await sizes('.plan-night-conditions');
  const tips = await sizes('.plan-night-preview-tip');
  expect(conditions).toHaveLength(2);
  expect(tips).toHaveLength(3);
  for (const px of [...conditions, ...tips]) expect(px).toBeGreaterThanOrEqual(14);

  if (VIDEO) await page.screenshot({ path: join(SHOT_DIR, 'quick-preview-390-ko.png') });

  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});
