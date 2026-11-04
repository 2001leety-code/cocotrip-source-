import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Local Korean planner journey, phone + desktop, with synthetic success/503.
 * Reuses the input flow and parser-valid preview from planner-preview-night-local.
 * Only the free preview and public review reads receive synthetic POST replies;
 * every other write and all external requests are blocked. No purchase/login.
 */
const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
const QUICK = '/api/ai-planner-quick';
test.use({ serviceWorkers: 'block', baseURL: BASE.origin, reducedMotion: 'reduce' });
test.setTimeout(120000);

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

async function setupPage(page: Page, width: number, outcome: 'success' | 'error') {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript((origin) => {
    if (location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', 'ko');
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, BASE.origin);

  const quickBodies: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname === QUICK && request.method() === 'POST') {
      quickBodies.push(request.postDataJSON());
      return route.fulfill({
        status: outcome === 'success' ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(outcome === 'success'
          ? { ok: true, data: QUICK_DATA }
          : { ok: false, code: 'GEMINI_ERROR', error: 'Synthetic preview service unavailable' }),
      });
    }
    if (url.pathname === '/api/reviews' && request.method() === 'POST') {
      let action: unknown;
      try { action = request.postDataJSON()?.action; } catch { /* blocked below */ }
      if (action === 'list' || action === 'aggregate') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, data: action === 'list'
            ? { reviews: [], nextCursor: null, count: 0 } : { aggregates: {} } }),
        });
      }
    }
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    // Frontend-imported modules in the local dev server, not API execution.
    if (/^\/api\/_shared\/[^?]+\.js$/.test(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  return { quickBodies, writes, pageErrors };
}

const stage = (page: Page, name: string) => page.locator(`.wizard-stage--${name}`);
const next = (page: Page) => page.locator('.wizard-stage .ec-btn.ec-btn-primary').last();

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function inspectStep(page: Page, info: TestInfo, width: number, number: number, name: string) {
  const current = page.locator('.ec-steptick[aria-current="step"]');
  await expect(current).toHaveCount(1);
  await expect(page.getByRole('progressbar', { includeHidden: true })).toHaveAttribute('aria-valuenow', String(number));
  // Scroll the question into a reading position; no styles/content are changed.
  await page.locator('.planner-question').evaluate((el) => {
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 90), behavior: 'instant' });
  });
  if (width >= 1024) {
    const metrics = await current.evaluate((button) => {
      const label = button.querySelector('span:not(.ec-figure)')!;
      const rail = button.closest('ol')!.getBoundingClientRect();
      const box = label.getBoundingClientRect();
      const style = getComputedStyle(label);
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        text: label.textContent,
        width: box.width,
        height: box.height,
        clip: style.clip,
        display: style.display,
        rail: { left: rail.left, right: rail.right, top: rail.top, bottom: rail.bottom },
        lines: Array.from(range.getClientRects()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
      };
    });
    await info.attach(`${number}-${name}-label`, {
      body: Buffer.from(JSON.stringify(metrics, null, 2)), contentType: 'application/json',
    });
    expect(metrics.text).toBeTruthy();
    expect(metrics.width).toBeGreaterThan(1);
    expect(metrics.height).toBeGreaterThanOrEqual(14);
    expect(metrics.clip).toBe('auto');
    expect(metrics.display).not.toBe('none');
    expect(metrics.lines.length).toBeGreaterThan(0);
    for (const line of metrics.lines) {
      expect(line.left).toBeGreaterThanOrEqual(metrics.rail.left - 1);
      expect(line.right).toBeLessThanOrEqual(metrics.rail.right + 1);
      expect(line.top).toBeGreaterThanOrEqual(metrics.rail.top - 1);
      expect(line.bottom).toBeLessThanOrEqual(metrics.rail.bottom + 1);
    }
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await screenshot(page, info, `${width}-ko-step-${number}-${name}`);
}

async function expectHeadingBelowHeader(page: Page, selector: string) {
  await expect.poll(async () => {
    const header = await page.locator('header.ec-no-print').first().boundingBox();
    const heading = await page.locator(selector).getByRole('heading', { level: 2 }).first().boundingBox();
    if (!header || !heading) return false;
    return heading.y >= header.y + header.height - 1 && heading.y + heading.height <= 844;
  }, { timeout: 10000 }).toBe(true);
}

for (const width of [390, 1280]) {
  for (const outcome of ['success', 'error'] as const) {
    test(`${width} ko: five steps to synthetic preview ${outcome}`, async ({ page }, info) => {
      const guards = await setupPage(page, width, outcome);
      await page.goto('/planner', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.wizard-res-ticket')).toBeVisible({ timeout: 20000 });
      const intro = page.getByRole('dialog').filter({ has: page.locator('#ai-intro-title') });
      if (width >= 768) {
        await expect(intro).toBeVisible();
        await intro.getByRole('button', { name: 'Close', exact: true }).click();
      }
      await expect(intro).toHaveCount(0);

      await page.locator('.wizard-res-row').first().click();
      await inspectStep(page, info, width, 1, 'reservation');
      await page.locator('.wizard-res-cta').click();

      await expect(stage(page, 'dest')).toBeVisible();
      if (width < 768) await stage(page, 'dest').locator('.wizard-quick-start__summary').click();
      await stage(page, 'dest').locator('.ec-option-sm').first().click();
      await expect(stage(page, 'dest').locator('.ec-option[aria-pressed="true"]')).not.toHaveCount(0);
      await inspectStep(page, info, width, 2, 'destination');
      await next(page).click();

      await expect(stage(page, 'food')).toBeVisible();
      const foodStyle = stage(page, 'food').locator('.grid > .ec-option').first();
      await foodStyle.click();
      await expect(foodStyle).toHaveAttribute('aria-pressed', 'true');
      await inspectStep(page, info, width, 3, 'food');
      await next(page).click();

      await expect(stage(page, 'details')).toBeVisible();
      const airport = stage(page, 'details').locator('[aria-haspopup="listbox"]').first();
      const placeholder = ((await airport.textContent()) || '').trim();
      await airport.click();
      await page.locator('[role="option"]:visible').first().click();
      await expect(airport).not.toHaveText(placeholder);
      await inspectStep(page, info, width, 4, 'details');
      await next(page).click();

      await expect(stage(page, 'review')).toBeVisible();
      const free = stage(page, 'review').locator('.wizard-review-cta .ec-btn-primary');
      await expect(free).toBeEnabled();
      const reviewBefore = await stage(page, 'review').locator('.wizard-dossier').innerText();
      await inspectStep(page, info, width, 5, 'review');
      await free.click();

      if (outcome === 'success') {
        const card = page.getByTestId('quick-preview-card');
        await expect(card).toBeVisible();
        await expect(card.locator('.ec-timeline-row')).toHaveCount(3);
        await expect(card).toContainText('남산서울타워');
        await expectHeadingBelowHeader(page, '[data-testid="quick-preview-card"]');
        const hrefs = await card.locator('a.ec-maplink').evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
        expect(hrefs).toHaveLength(3);
        for (const href of hrefs) expect(href.startsWith('https://www.google.com/maps/search/?api=1')).toBe(true);
        const readable = await card.locator('.plan-night-conditions, .plan-night-preview-tip').evaluateAll((els) => els
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => parseFloat(getComputedStyle(e).fontSize)));
        expect(readable.length).toBeGreaterThanOrEqual(5);
        for (const size of readable) expect(size).toBeGreaterThanOrEqual(14);
        await screenshot(page, info, `${width}-ko-preview-success`);
      } else {
        const error = page.locator('[role="status"][aria-live="assertive"]');
        await expect(error).toBeVisible();
        await expect(error.getByRole('heading', { level: 2 })).not.toHaveText('');
        await expect(page.getByTestId('quick-preview-card')).toHaveCount(0);
        await expectHeadingBelowHeader(page, '[role="status"][aria-live="assertive"]');
        await screenshot(page, info, `${width}-ko-preview-error`);
        await error.getByRole('button').click();
        await expect(error).toHaveCount(0);
        await expect(stage(page, 'review')).toBeVisible();
        expect(await stage(page, 'review').locator('.wizard-dossier').innerText()).toBe(reviewBefore);
        await expect(free).toBeEnabled();
        await screenshot(page, info, `${width}-ko-error-return-to-review`);
      }

      expect(guards.quickBodies).toHaveLength(1);
      expect(guards.quickBodies[0]).toMatchObject({ language: 'ko', cityKey: 'seoul', durationDays: 3 });
      expect((guards.quickBodies[0].regions as string[]).length).toBeGreaterThan(0);
      expect(String(guards.quickBodies[0].arrival_airport)).toMatch(/^(ICN|GMP)/);
      expect(guards.writes).toEqual([]);
      expect(guards.pageErrors).toEqual([]);
    });
  }
}
