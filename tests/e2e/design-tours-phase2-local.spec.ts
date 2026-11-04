import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures/analytics-guard';

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
test.use({ baseURL: BASE.origin, serviceWorkers: 'block', reducedMotion: 'reduce', actionTimeout: 15000 });
test.setTimeout(120000);

async function setup(page: Page, width: number, language: string) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(([origin, lang]) => {
    if (location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', lang);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, [BASE.origin, language]);
  const writes: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname === '/api/reviews' && request.method() === 'POST') {
      let action: unknown;
      try { action = request.postDataJSON()?.action; } catch { /* denied below */ }
      if (action === 'list' || action === 'aggregate') return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: action === 'list'
          ? { reviews: [], count: 0, nextCursor: null } : { aggregates: {} } }),
      });
    }
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (/^\/api\/_shared\/[^?]+\.js$/.test(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  return { writes, pageErrors };
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function measure(page: Page, info: TestInfo, name: string, selector: string) {
  const data = await page.locator(selector).first().evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const visible = (item: Element) => item.getBoundingClientRect().height > 0 && getComputedStyle(item).visibility !== 'hidden';
    return {
      background: style.backgroundColor, backgroundImage: style.backgroundImage, color: style.color,
      width: box.width, height: box.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      controls: Array.from(el.querySelectorAll('button,input,select,textarea')).filter(visible).map((item) => {
        const r = item.getBoundingClientRect();
        return { label: item.getAttribute('aria-label') || item.textContent?.trim().slice(0, 75), width: r.width, height: r.height, font: getComputedStyle(item).fontSize };
      }),
    };
  });
  const path = info.outputPath(`${name}-metrics.json`);
  await writeFile(path, JSON.stringify(data, null, 2));
  await info.attach(`${name}-metrics`, { path, contentType: 'application/json' });
  expect(data.scrollWidth).toBeLessThanOrEqual(data.clientWidth + 1);
  return data;
}

for (const { width, language } of [
  { width: 390, language: 'ko' }, { width: 1280, language: 'ko' },
  { width: 390, language: 'en' }, { width: 390, language: 'ja' }, { width: 390, language: 'zh' },
]) {
  test(`${width} ${language}: catalogue, detail and booking inputs only`, async ({ page }, info) => {
    const audit = await setup(page, width, language);
    await page.goto('/tours', { waitUntil: 'domcontentloaded' });
    const grid = page.getByTestId('tours-grid');
    await expect(grid).toBeVisible({ timeout: 20000 });
    await capture(page, info, `${width}-catalogue`);
    await measure(page, info, `${width}-catalogue`, '[data-testid="tours-editorial-shell"]');
    if (width < 768) {
      await page.getByTestId('tours-filter-trigger').click();
      await expect(page.getByTestId('tours-filter-dialog')).toBeVisible();
      await capture(page, info, `${width}-catalogue-filters`);
      await page.getByTestId('tours-filter-dialog-close').click();
    }
    await grid.locator('.tour-catalog-card').first().scrollIntoViewIfNeeded();
    await capture(page, info, `${width}-catalogue-card`);

    await page.goto('/tours/seoul-city-full-day?localTourState=ready', { waitUntil: 'domcontentloaded' });
    // The local Vite server can still be resolving this route's lazy module graph.
    await expect(page.getByTestId('tour-detail-ready')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => page.locator('.tour-detail-gallery img').first().evaluate((image) =>
      (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
    { message: 'Local tour hero is decoded before capture', timeout: 20000 }).toBe(true);
    await capture(page, info, `${width}-detail`);
    await measure(page, info, `${width}-detail`, '[data-testid="tour-detail-shell"]');
    await page.locator('.tour-detail-gallery').scrollIntoViewIfNeeded();
    await capture(page, info, `${width}-detail-gallery`);
    const book = page.getByTestId('tour-detail-book-cta');
    await expect(book).toBeVisible();
    const priceBefore = await page.getByTestId('tour-detail-booking-price').innerText();
    await book.click();
    const dialog = page.locator('.cocotrip-mobile-booking-dialog');
    await expect(dialog).toHaveAttribute('data-tour-step', '1');
    const next = dialog.locator('[data-slot="dialog-footer"] > button').first();
    await expect(next).toBeDisabled();
    await capture(page, info, `${width}-booking-options-top`);
    const options = await measure(page, info, `${width}-booking-options`, '.cocotrip-mobile-booking-dialog');
    expect(options.width).toBeLessThanOrEqual(width);
    const counterButtons = await dialog.locator('.customer-booking-body button.w-9').evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    await dialog.locator('.customer-booking-total').scrollIntoViewIfNeeded();
    await dialog.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
    await capture(page, info, `${width}-booking-options-total`);
    const totalBounds = await dialog.locator('.customer-booking-total').boundingBox();
    const footerBounds = await dialog.locator('.cocotrip-mobile-booking-footer').boundingBox();
    await info.attach('total-footer-bounds', { body: Buffer.from(JSON.stringify({ totalBounds, footerBounds })), contentType: 'application/json' });
    expect(totalBounds).not.toBeNull();
    expect(footerBounds).not.toBeNull();
    expect(totalBounds!.y + totalBounds!.height).toBeLessThanOrEqual(footerBounds!.y + 1);
    const dialogBounds = await dialog.boundingBox();
    expect(totalBounds!.y).toBeGreaterThan(dialogBounds!.y);
    expect(footerBounds!.y + footerBounds!.height).toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height);

    await dialog.locator('button[aria-labelledby$="-date-value"]').click();
    const calendar = page.locator('.cocotrip-mobile-booking-popover');
    await expect(calendar).toBeVisible();
    await calendar.locator('.rdp-button_next').click();
    await capture(page, info, `${width}-booking-calendar`);
    await calendar.locator('button[data-day]:not([disabled])').first().click();
    await page.keyboard.press('Escape');
    await expect(next).toBeEnabled();
    // Internal progression only: the handler just renders the contact form.
    await next.click();
    await expect(dialog).toHaveAttribute('data-tour-step', '2');
    await dialog.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
    await capture(page, info, `${width}-booking-contact-top`);
    await measure(page, info, `${width}-booking-contact`, '.cocotrip-mobile-booking-dialog');
    const labelSizes = await dialog.locator('.cocotrip-mobile-booking-form label').evaluateAll((labels) => labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize)));
    const lastNameBounds = await dialog.locator('input[id$="-last-name"]').boundingBox();
    const firstNameBounds = await dialog.locator('input[id$="-first-name"]').boundingBox();
    expect(Math.abs(lastNameBounds!.y - firstNameBounds!.y), 'Name inputs stay aligned when their labels wrap').toBeLessThanOrEqual(1);
    const phone = dialog.locator('input[inputmode="tel"]').first();
    await expect(phone).toBeVisible();
    await phone.fill('+1 202 555 0100');
    // Keep terms unchecked and all other required fields empty. Never submit.
    for (const checkbox of await dialog.locator('input[type="checkbox"]').all()) await expect(checkbox).not.toBeChecked();
    await dialog.locator('.cocotrip-mobile-booking-footer').scrollIntoViewIfNeeded();
    await expect(dialog.locator('.cocotrip-mobile-booking-footer button[disabled]')).toBeVisible();
    await expect(dialog.locator('.paypal-buttons, iframe[src*="paypal"]')).toHaveCount(0);
    await capture(page, info, `${width}-booking-contact-gate`);
    await dialog.locator(':scope > [data-slot="dialog-close"]').click();
    await expect(dialog).toHaveCount(0);
    expect(await page.getByTestId('tour-detail-booking-price').innerText()).toBe(priceBefore);
    expect(audit.writes).toEqual([]);
    expect(audit.pageErrors).toEqual([]);
    const readability = { counterButtons, labelSizes, totalBounds, footerBounds, lastNameBounds, firstNameBounds };
    const metricsPath = info.outputPath(`${width}-readability.json`);
    await writeFile(metricsPath, JSON.stringify(readability, null, 2));
    await info.attach('readability', { path: metricsPath, contentType: 'application/json' });
    expect(counterButtons).toHaveLength(2);
    for (const button of counterButtons) {
      expect.soft(button.width, 'Hanbok counter target width').toBeGreaterThanOrEqual(44);
      expect.soft(button.height, 'Hanbok counter target height').toBeGreaterThanOrEqual(44);
    }
    expect(labelSizes.length).toBeGreaterThan(0);
    if (width < 768) for (const size of labelSizes) expect.soft(size, 'Mobile booking label size').toBeGreaterThanOrEqual(14);
  });
}
