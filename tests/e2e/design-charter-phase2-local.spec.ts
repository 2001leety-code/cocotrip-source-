import { writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
type Lang = 'ko' | 'en' | 'ja' | 'zh';
const NEXT: Record<Lang, string> = { ko: '다음', en: 'Next', ja: '次へ', zh: '下一步' };
const DESTINATION: Record<Lang, string> = {
  ko: '서울 도심 (명동·홍대·종로·용산)',
  en: 'Seoul City Center (Myeongdong, Hongdae, Jongno)',
  ja: 'ソウル都心（明洞・弘大・鍾路・龍山）',
  zh: '首尔市中心（明洞·弘大·钟路·龙山）',
};
test.use({ baseURL: BASE.origin, serviceWorkers: 'block', reducedMotion: 'reduce' });

async function setup(page: Page, width: number, language: Lang) {
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
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname === '/api/reviews' && req.method() === 'POST') {
      const action = (req.postDataJSON() as { action?: string }).action;
      if (action === 'list' || action === 'aggregate') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: action === 'list' ? { reviews: [], count: 0, nextCursor: null } : { aggregates: {} } }) });
      }
    }
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (/^\/api\/_shared\/[^?]+\.js$/.test(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  await page.goto('/charter', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-origin-code="ICN"]')).toBeVisible({ timeout: 30000 });
  return { writes, errors };
}

function next(page: Page, language: Lang = 'en') {
  return page.getByRole('button', { name: NEXT[language], exact: true }).filter({ visible: true }).first();
}

async function capture(page: Page, info: TestInfo, name: string) {
  const panel = page.locator('.charter-funnel-step-panel');
  const metrics = await panel.evaluate((el) => ({
    pageWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
    text: (el as HTMLElement).innerText,
    controls: Array.from(el.querySelectorAll('button, input, textarea, select')).map((node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent?.trim() || node.getAttribute('aria-label') || node.getAttribute('placeholder'), width: rect.width, height: rect.height, font: getComputedStyle(node).fontSize };
    }),
  }));
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewport + 1);
  writeFileSync(info.outputPath(`${name}.json`), JSON.stringify(metrics, null, 2), 'utf8');
  // A tall element screenshot composites fixed headers in its middle. Preserve
  // the actual viewport instead, with the panel heading below the fixed header.
  await panel.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 84));
  await page.screenshot({ path: info.outputPath(`${name}-viewport.png`) });
}

async function expectReadable(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeVisible();
  const metrics = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => ({
    font: parseFloat(getComputedStyle(node).fontSize),
    height: node.clientHeight,
    contentHeight: node.scrollHeight,
    width: node.clientWidth,
    contentWidth: node.scrollWidth,
  })));
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.font).toBeGreaterThanOrEqual(14);
    expect(metric.contentWidth).toBeLessThanOrEqual(metric.width + 1);
    expect(metric.contentHeight).toBeLessThanOrEqual(metric.height + 1);
  }
  return metrics;
}

async function openInputs(page: Page, info: TestInfo, language: Lang) {
  await capture(page, info, 'step1-origin');
  await page.locator('[data-origin-code="ICN"]').click();
  await next(page, language).click();
  const service = await expectReadable(page, '[data-testid="charter-service-card"] .charter-funnel-option-sub');
  await capture(page, info, 'step2-service');
  await page.locator('[data-service="airport_transfer"]').click();
  await next(page, language).click();
  const destination = await expectReadable(page, '[data-testid="charter-destination-card"] > p:first-child');
  await capture(page, info, 'step3-destination');
  await page.getByTestId('charter-destination-card').first().click();
  await next(page, language).click();
  await capture(page, info, 'step4-vehicle');
  await next(page, language).click();
  await expect(next(page, language)).toBeDisabled();
  const booking = page.locator('.cocotrip-mobile-booking-form');
  const labels = await booking.locator('label').evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent?.trim(),
    font: parseFloat(getComputedStyle(node).fontSize),
    lineHeight: parseFloat(getComputedStyle(node).lineHeight),
  })));
  const summaryTitle = booking.getByText(DESTINATION[language], { exact: true });
  await expect(summaryTitle).toBeVisible();
  await expect(booking).not.toContainText('seoul-central');
  await capture(page, info, 'step5-empty');
  await summaryTitle.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 110));
  await page.screenshot({ path: info.outputPath('step5-booking-summary-viewport.png') });
  writeFileSync(info.outputPath('readability.json'), JSON.stringify({ language, service, destination, labels, bookingTitle: await summaryTitle.textContent() }, null, 2), 'utf8');
  if ((page.viewportSize()?.width || 0) < 768) {
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.font, label.text).toBeGreaterThanOrEqual(14);
      expect(label.lineHeight, label.text).toBeGreaterThanOrEqual(label.font * 1.45 - 0.1);
    }
  }
}

for (const width of [390, 1280]) {
  test(`${width} en: charter inputs and local quote preserve booking gates`, async ({ page }, info) => {
    test.setTimeout(90000);
    const guard = await setup(page, width, 'en');
    await openInputs(page, info, 'en');
    await page.locator('input[type="date"]').first().fill('2099-06-15');
    await page.locator('input[type="time"]').first().fill('10:00');
    await page.getByPlaceholder('HONG', { exact: true }).fill('TEST');
    await page.getByPlaceholder('GILDONG', { exact: true }).fill('SYNTHETIC');
    await page.getByLabel('Mobile number', { exact: false }).fill('5550100000');
    await page.getByPlaceholder('you@email.com', { exact: true }).fill('design@example.test');
    await page.getByPlaceholder(/^e\.g\. L7 Myeongdong/i).fill('Synthetic meeting point');
    await page.getByPlaceholder(/KE5760|OZ521/i).fill('ZZ0000');
    await page.getByRole('button', { name: 'T1', exact: true }).click();
    await expect(next(page)).toBeDisabled();
    await page.getByRole('checkbox').first().check();
    await expect(next(page)).toBeEnabled();
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Final Quote', exact: true })).toBeVisible();
    await expect(page.getByText('₩124,800', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.charter-funnel-receipt-total')).toContainText('$92');
    await capture(page, info, 'step6-quote');
    // Payment, login and inquiry submission are deliberately outside this flow.
    expect(guard.writes).toEqual([]);
    expect(guard.errors).toEqual([]);
  });
}

for (const language of ['ko', 'ja', 'zh'] as const) {
  test(`390 ${language}: readable choices and localized booking summary`, async ({ page }, info) => {
    const guard = await setup(page, 390, language);
    await openInputs(page, info, language);
    expect(guard.writes).toEqual([]);
    expect(guard.errors).toEqual([]);
  });
}

test('390 en: resume names are readable and booking consent resets', async ({ page }, info) => {
  test.setTimeout(90000);
  const guard = await setup(page, 390, 'en');
  await openInputs(page, info, 'en');
  await page.locator('input[type="date"]').first().fill('2099-06-15');
  await page.getByRole('checkbox').first().check();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('cocotrip:wizard:charter') || '{}');
    return saved.step === 5 && saved.values?.state?.startDate === '2099-06-15';
  })).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const resume = page.getByRole('dialog', { name: 'Continue where you left off?', exact: true });
  await expect(resume).toBeVisible({ timeout: 30000 });
  await expect(resume).toContainText('Incheon');
  await expect(resume).toContainText('Airport Transfer');
  await expect(resume).toContainText(DESTINATION.en);
  await expect(resume).not.toContainText('seoul-central');
  await expect(resume).not.toContainText('airport_transfer');
  await page.screenshot({ path: info.outputPath('resume-viewport.png') });
  await resume.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('input[type="date"]').first()).toHaveValue('2099-06-15');
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await expect(next(page)).toBeDisabled();
  expect(guard.writes).toEqual([]);
  expect(guard.errors).toEqual([]);
});
