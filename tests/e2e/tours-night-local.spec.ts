import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Tours catalogue → detail "Night Dossier" — local preview only (localhost:5178).
 * Every non-local request is aborted (Firestore included, so the detail page
 * paints its static catalogue fixture), service workers are blocked, and the
 * local `/api/*` boundary is mocked exactly: read-only `/api/reviews` returns no
 * reviews, anything else under `/api/` answers `{}`. Nothing is submitted: the
 * booking dialog is never opened and any non-read request fails the test.
 * Screenshots are written only when EXPANSION_SCREENSHOT_DIR is set.
 */

test.use({ serviceWorkers: 'block' });
test.use({
  video: process.env.EXPANSION_VIDEO === '1'
    ? { mode: 'on', size: { width: 390, height: 844 } }
    : 'off',
});

const BASE = new URL(process.env.BASE_URL || 'http://localhost:5178');

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const LANGUAGES: Lang[] = ['ko', 'en', 'ja', 'zh'];
// Full KO/EN/JA/ZH × 360/390/430/1024/1280/1440 matrix (the old 360 ko / 430 en one-offs are inside it).
const VIEWPORTS = [
  { label: '360', width: 360, height: 800 },
  { label: '390', width: 390, height: 844 },
  { label: '430', width: 430, height: 932 },
  { label: '1024', width: 1024, height: 768 },
  { label: '1280', width: 1280, height: 800 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
// Region-rail cases keep their original 360/390/430/1440 phone+desktop spread.
const RAIL_VIEWPORTS = VIEWPORTS.filter((viewport) => viewport.label !== '1024' && viewport.label !== '1280');

function isLocalBase() {
  return BASE.hostname === 'localhost' || BASE.hostname === '127.0.0.1';
}

function skipUnlessLocalDesktop(projectName: string) {
  test.skip(projectName !== 'Desktop Chrome', 'viewport is set explicitly');
  test.skip(!isLocalBase(), 'local preview only');
}

function isReviewRead(route: Route) {
  const request = route.request();
  if (request.method() === 'GET') return true;
  if (request.method() !== 'POST') return false;
  try {
    const body = request.postDataJSON() as { action?: string };
    return body.action === 'list' || body.action === 'aggregate';
  } catch {
    return false;
  }
}

async function installLocalBoundary(page: Page) {
  const writes: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.fallback();
    if (url.pathname === '/api/reviews' && isReviewRead(route)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: [], aggregates: {} }) });
    }
    if (route.request().method() !== 'GET') writes.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return writes;
}

async function expectNoHorizontalOverflow(page: Page, context: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${context}: horizontal overflow`).toBeLessThanOrEqual(1);
}

async function capture(page: Page, name: string) {
  const dir = process.env.EXPANSION_SCREENSHOT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

/** Visible catalogue blocks, in document order, never overlap vertically (season line vs results eyebrow). */
async function expectCatalogBlocksStacked(page: Page, context: string) {
  const rects = await page.evaluate(() => {
    const selectors = [
      '.tours-catalog-masthead',
      '.tours-catalog-trust',
      '.tours-catalog-season',
      '.tours-catalog-filter-section',
      '.tours-catalog-season-mobile',
      '.tours-catalog-results-heading .ec-eyebrow',
      '.tours-catalog-results-heading .ec-h2',
      '[data-testid="tours-grid"]',
      '.tours-catalog-destinations',
    ];
    return selectors.flatMap((selector) => {
      const el = document.querySelector(selector);
      if (!el || getComputedStyle(el).display === 'none') return [];
      const r = el.getBoundingClientRect();
      if (r.height === 0) return [];
      // Unclipped text may paint past its box, so count its content height too.
      const clipped = getComputedStyle(el).overflow === 'hidden';
      return [{ selector, top: r.top, bottom: clipped ? r.bottom : Math.max(r.bottom, r.top + (el as HTMLElement).scrollHeight) }];
    });
  });
  for (let i = 1; i < rects.length; i += 1) {
    expect(rects[i].top, `${context}: ${rects[i].selector} overlaps ${rects[i - 1].selector}`).toBeGreaterThanOrEqual(rects[i - 1].bottom - 1);
  }
}

async function runCatalogToDetail(
  page: Page,
  language: Lang,
  viewport: { label: string; width: number; height: number },
  mode: 'ready' | 'fallback' = 'ready',
) {
  const context = `${viewport.label}/${language}`;
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.addInitScript((lang) => {
    window.localStorage.setItem('cocotrip_lang', lang);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    window.localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, language);

  await page.goto('/tours', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  const grid = page.getByTestId('tours-grid');
  await expect(grid).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  // Catalogue card keeps title, USD price and its detail link.
  const firstCard = grid.locator('.tour-catalog-card').first();
  await expect(firstCard.locator('h3')).not.toBeEmpty();
  await expect(firstCard.locator('.tour-catalog-card-price')).toContainText('USD');
  await expect(firstCard.locator('.tour-catalog-card-wishlist > button')).toBeVisible();
  await expectNoHorizontalOverflow(page, `${context}/catalog`);
  await expectCatalogBlocksStacked(page, context);
  // Style proof: cloud band is the existing poster, flat (no blur), and adds no height of its own.
  const band = await page.locator('.tours-catalog-masthead').evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { image: s.backgroundImage, backdrop: s.backdropFilter, position: s.position };
  });
  expect(band.image, `${context}: cloud band image`).toContain('v3-cloud-poster');
  expect(band.backdrop === 'none' || band.backdrop === '', `${context}: no backdrop filter`).toBe(true);
  expect(band.position, `${context}: cloud band overlays, adds no height`).toBe('absolute');
  // Region rail sits after the product grid, never above it.
  const gridBox = await grid.boundingBox();
  const railBox = await page.getByTestId('tours-region-rail').boundingBox();
  expect(railBox!.y, `${context}: region rail below grid`).toBeGreaterThanOrEqual(gridBox!.y + gridBox!.height - 1);
  if (viewport.width < 768) {
    // First real product photo and name land in the initial phone viewport.
    const mediaBox = await firstCard.locator('img').first().boundingBox();
    const nameBox = await firstCard.locator('h3').boundingBox();
    expect(mediaBox!.y, `${context}: first photo above fold`).toBeLessThan(viewport.height);
    expect(nameBox!.y + nameBox!.height, `${context}: first name within viewport`).toBeLessThanOrEqual(viewport.height);
    // Season note shows at least two lines, not a one-line ellipsis.
    const seasonText = page.getByTestId('tours-season-mobile-text');
    const lines = await seasonText.evaluate((el) => {
      const style = getComputedStyle(el);
      return Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight));
    });
    const singleLine = await seasonText.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
    expect(lines >= 2 || singleLine, `${context}: season note not forced to one line`).toBe(true);
    const countBox = await page.getByTestId('tours-results-count').boundingBox();
    expect(countBox!.height, `${context}: compact result count`).toBeLessThanOrEqual(28);
  }
  if (viewport.width >= 981) {
    const mastheadBox = await page.locator('.tours-catalog-masthead').boundingBox();
    const trustBox = await page.locator('.tours-catalog-trust').boundingBox();
    expect(mastheadBox!.height, `${context}: compact masthead`).toBeLessThanOrEqual(420);
    expect(trustBox!.height, `${context}: compact trust band`).toBeLessThanOrEqual(170);
  }
  await capture(page, `tours-catalog-${viewport.label}-${language}`);
  if (process.env.EXPANSION_VIDEO === '1' && mode === 'ready') await page.waitForTimeout(1000);

  // Region filter: phones go through the sheet, desktop uses the inline panel.
  const isPhone = viewport.width < 768;
  if (isPhone) {
    await page.getByTestId('tours-filter-trigger').click();
    await expect(page.getByTestId('tours-filter-dialog')).toBeVisible();
  }
  const filterScope = isPhone ? page.getByTestId('tours-filter-dialog-body') : page.locator('.tours-catalog-filter-fields');
  const regionChip = filterScope.locator('fieldset').first().locator('button.tour-chip').nth(1);
  await regionChip.click();
  await expect(regionChip).toHaveAttribute('aria-pressed', 'true');
  if (isPhone) {
    await page.getByTestId('tours-filter-dialog-close').click();
    await expect(page.getByTestId('tours-filter-dialog')).toBeHidden();
  }

  const cardLink = grid.locator('a.tour-catalog-card-link').first();
  await expect(cardLink).toBeVisible();
  const href = await cardLink.getAttribute('href');
  expect(href, `${context}: card link`).toMatch(/^\/tours\/[a-z0-9-]+$/);
  await cardLink.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByTestId('tour-detail-ready')).toBeVisible();

  if (mode === 'ready') {
    // Normal capture: the existing localhost-only ready fixture (useTour.ts). This is a
    // local fixture, not a claim that production realtime data loaded.
    await page.goto(`${href}?localTourState=ready`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('tour-detail-ready')).toBeVisible();
    await expect(page.getByTestId('tour-detail-partial')).toHaveCount(0);
  } else {
    // Firestore is aborted: the realtime-failure banner must stay visible over static data.
    await expect(page.getByTestId('tour-detail-partial')).toBeVisible();
  }
  await expect(page.getByTestId('tour-detail-heading')).not.toBeEmpty();
  await expectNoHorizontalOverflow(page, `${context}/detail`);

  // Bundled tour photos paint; external regional images may be blocked by isolation
  // and are only annotated, never treated as verified.
  const imageState = await page.locator('.tour-detail-gallery img').evaluateAll((els) => els.map((el) => {
    const img = el as HTMLImageElement;
    return { local: new URL(img.currentSrc || img.src, location.href).origin === location.origin, ok: img.complete && img.naturalWidth > 0 };
  }));
  const blockedExternal = imageState.filter((img) => !img.local && !img.ok).length;
  if (blockedExternal) test.info().annotations.push({ type: 'unverified', description: `${context}: ${blockedExternal} external gallery image(s) blocked offline` });

  // Gallery: existing control advances the counter when there is more than one slide.
  const gallery = page.locator('.tour-detail-gallery');
  await expect(gallery).toBeVisible();
  const next = gallery.locator('.tour-detail-gallery-control-next');
  if (await next.count()) {
    const counter = gallery.locator('.tour-detail-gallery-count');
    const before = (await counter.textContent()) || '';
    await next.click();
    await expect(counter).not.toHaveText(before);
    if (process.env.EXPANSION_VIDEO === '1') await page.waitForTimeout(1200);
  }

  // FAQ accordion toggles in place when the tour has FAQs.
  const faqButton = page.locator('#faq .tour-detail-accordion-button').first();
  if (await faqButton.count()) {
    await faqButton.scrollIntoViewIfNeeded();
    await expect(faqButton).toHaveAttribute('aria-expanded', 'false');
    await faqButton.click();
    await expect(faqButton).toHaveAttribute('aria-expanded', 'true');
  }

  // Price / booking gate stays visible and uncollapsed; nothing is submitted.
  await expect(page.getByTestId('tour-detail-cancellation')).toBeAttached();
  await expect(page.getByTestId('tour-detail-booking-bar')).toBeVisible();
  await expect(page.getByTestId('tour-detail-booking-price')).toContainText('$');
  await expect(page.getByTestId('tour-detail-booking-price')).toContainText('USD');
  await expect(page.getByTestId('tour-detail-cutoff-note')).toBeVisible();
  await expect(page.getByTestId('tour-detail-trust-fees')).toBeVisible();
  const cta = page.getByTestId('tour-detail-book-cta');
  await expect(cta).toBeVisible();
  await expect(cta).toBeEnabled();
  const ctaBox = await cta.boundingBox();
  expect(ctaBox && ctaBox.height, `${context}: book CTA height`).toBeGreaterThanOrEqual(44);
  // Booking stub is a solid readable surface, not a translucent or blurred one.
  const stub = await page.getByTestId('tour-detail-booking-bar').evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, backdrop: s.backdropFilter };
  });
  expect(stub.background, `${context}: booking stub solid`).not.toMatch(/rgba\(.*,\s*0(\.\d+)?\)$|transparent/);
  expect(stub.backdrop === 'none' || stub.backdrop === '', `${context}: booking stub no backdrop filter`).toBe(true);
  // No fixed/sticky layer sits on top of the CTA.
  const ctaOnTop = await cta.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(ctaOnTop, `${context}: book CTA covered`).toBe(true);
  // Price / cutoff / fee / cancellation lines are readable (>= 14px), not hidden.
  for (const id of ['tour-detail-booking-price', 'tour-detail-cutoff-note', 'tour-detail-trust-fees']) {
    const size = await page.getByTestId(id).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, `${context}: ${id} font size`).toBeGreaterThanOrEqual(14);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, `tours-detail-${mode === 'ready' ? '' : 'fallback-'}${viewport.label}-${language}`);
  if (process.env.EXPANSION_VIDEO === '1' && mode === 'ready') await page.waitForTimeout(1000);

  if (mode === 'ready' && viewport.label === '390' && language === 'ko') {
    const focusRing = (el: Element) => { const s = getComputedStyle(el); return el.matches(':focus-visible') && ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'); };
    const noMotion = (node: Element) => node.getAnimations({ subtree: true }).every((a) => a.playState !== 'running') && Math.max(...getComputedStyle(node).transitionDuration.split(',').map((d) => parseFloat(d) || 0)) <= 0.01;
    // Detail gallery control: real keyboard focus, visible indicator, then reduced motion.
    const galleryControl = gallery.locator('button').first();
    if (await galleryControl.count()) {
      await galleryControl.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(galleryControl).toBeFocused();
      expect(await galleryControl.evaluate(focusRing), `${context}: gallery focus ring`).toBe(true);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await galleryControl.evaluate(noMotion), `${context}: gallery reduced motion`).toBe(true);
      await page.emulateMedia({ reducedMotion: null });
    } else {
      test.info().annotations.push({ type: 'unverified', description: `${context}: no gallery control to focus` });
    }
    // Catalogue: filter trigger takes keyboard focus; card has no movement under reduced motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/tours', { waitUntil: 'domcontentloaded' });
    const trigger = page.getByTestId('tours-filter-trigger');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    expect(await trigger.evaluate(focusRing), `${context}: filter trigger focus ring`).toBe(true);
    const card = page.getByTestId('tours-grid').locator('.tour-catalog-card').first();
    await expect(card).toBeVisible();
    expect(await card.evaluate(noMotion), `${context}: catalog card reduced motion`).toBe(true);
    await page.emulateMedia({ reducedMotion: null });
  }
}

test.describe('/tours night dossier — local catalogue → detail', () => {
  for (const viewport of VIEWPORTS) {
    for (const language of LANGUAGES) {
      test(`${viewport.label} × ${language}`, async ({ page }, testInfo) => {
        skipUnlessLocalDesktop(testInfo.project.name);
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(String(error)));
        const writes = await installLocalBoundary(page);

        await runCatalogToDetail(page, language, viewport);

        expect(writes, 'no write requests').toEqual([]);
        expect(pageErrors).toEqual([]);
      });
    }
  }

  test('390 × ko realtime failure keeps the banner over static data', async ({ page }, testInfo) => {
    skipUnlessLocalDesktop(testInfo.project.name);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const writes = await installLocalBoundary(page);
    await runCatalogToDetail(page, 'ko', { label: '390', width: 390, height: 844 }, 'fallback');
    expect(writes, 'no write requests').toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('1024 × ja tablet stress + reduced motion', async ({ page }, testInfo) => {
    skipUnlessLocalDesktop(testInfo.project.name);
    const writes = await installLocalBoundary(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await runCatalogToDetail(page, 'ja', { label: '1024', width: 1024, height: 768 });
    await page.goto('/tours', { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('tours-grid').locator('.tour-catalog-card').first();
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('none');
    expect(writes, 'no write requests').toEqual([]);
  });
});

/** Region rail → results visibility. Measured with page.evaluate only, so no locator auto-scroll hides a miss. */
async function readResultsRect(page: Page) {
  return page.evaluate(() => {
    const heading = document.getElementById('tours-results-title');
    const card = document.querySelector('[data-testid="tours-grid"] .tour-catalog-card');
    const header = document.querySelector('header');
    if (!heading) return null;
    const h = heading.getBoundingClientRect();
    const hp = header ? getComputedStyle(header).position : 'static';
    const headerBottom = header && (hp === 'fixed' || hp === 'sticky') ? header.getBoundingClientRect().bottom : 0;
    const hit = document.elementFromPoint(h.left + Math.min(h.width, 40) / 2, h.top + h.height / 2);
    const c = card ? card.getBoundingClientRect() : null;
    return {
      vh: window.innerHeight,
      scrollY: Math.round(window.scrollY),
      headingTop: h.top,
      headingBottom: h.bottom,
      headerBottom,
      headingCovered: !(hit && (hit === heading || heading.contains(hit))),
      cardTop: c ? c.top : null,
      cardBottom: c ? c.bottom : null,
    };
  });
}

async function expectResultsVisible(page: Page, context: string, expectCard: boolean) {
  await expect.poll(async () => {
    const r = await readResultsRect(page);
    if (!r) return 'no heading';
    if (r.headingTop < r.headerBottom - 1) return `heading under header (${r.headingTop} < ${r.headerBottom})`;
    if (r.headingBottom > r.vh) return `heading below viewport (${r.headingBottom} > ${r.vh})`;
    if (r.headingCovered) return 'heading covered';
    if (expectCard) {
      if (r.cardTop === null || r.cardBottom === null) return 'no card';
      if (r.cardTop >= r.vh || r.cardBottom <= r.headerBottom) return `first card off-screen (${r.cardTop})`;
    }
    return 'ok';
  }, { message: `${context}: results visible`, timeout: 4000 }).toBe('ok');
}

/** Same as capture(), plus a copy in the test's own output dir so a run without EXPANSION_SCREENSHOT_DIR still leaves a PNG. */
async function snap(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  await capture(page, name);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
}

async function openTours(page: Page, language: Lang, viewport: { width: number; height: number }) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.addInitScript((lang) => {
    window.localStorage.setItem('cocotrip_lang', lang);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    window.localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, language);
  await page.goto('/tours', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.describe('/tours region rail selection', () => {
  const cases = [
    ...RAIL_VIEWPORTS.map((viewport) => ({ viewport, language: 'ko' as Lang })),
    ...(['en', 'ja', 'zh'] as Lang[]).map((language) => ({ viewport: RAIL_VIEWPORTS[1], language })),
  ];

  for (const { viewport, language } of cases) {
    test(`region rail selection — ${viewport.label} × ${language}`, async ({ page }, testInfo) => {
      skipUnlessLocalDesktop(testInfo.project.name);
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      const writes = await installLocalBoundary(page);
      const context = `${viewport.label}/${language}`;
      await openTours(page, language, viewport);

      const buttons = page.getByTestId('tours-region-rail').locator('button');
      await expect(buttons.nth(1)).toBeVisible();

      // Sort state set before the pick must survive it.
      const sort = page.locator('select:visible').first();
      await sort.selectOption('price-asc');

      await buttons.nth(1).scrollIntoViewIfNeeded();
      await snap(page, testInfo, `region-before-selection-${viewport.label}-${language}`);
      await buttons.nth(1).click();
      await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expectResultsVisible(page, `${context}/pick`, true);
      await snap(page, testInfo, `region-after-selection-${viewport.label}-${language}`);

      // Pointer focus stays on the rail button, with state intact.
      expect(await buttons.nth(1).evaluate((el) => el === document.activeElement), `${context}: pointer focus kept`).toBe(true);
      await expect(sort).toHaveValue('price-asc');
      const cardCount = await page.getByTestId('tours-grid').locator('.tour-catalog-card').count();
      expect(cardCount, `${context}: region has tours`).toBeGreaterThan(0);
      const count = await page.getByTestId('tours-results-count').locator('strong').textContent();
      expect(Number(count), `${context}: count matches cards`).toBe(cardCount);
      await expectNoHorizontalOverflow(page, context);

      // Same region again: stays the only selected one, results brought back into view.
      await page.evaluate(() => window.scrollTo(0, 0));
      await buttons.nth(1).click();
      await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('tours-region-rail').locator('button[aria-pressed="true"]')).toHaveCount(1);
      await expectResultsVisible(page, `${context}/same`, true);
      await expect(sort).toHaveValue('price-asc');
      expect(await page.getByTestId('tours-grid').locator('.tour-catalog-card').count()).toBe(cardCount);

      // Empty search: state kept, empty heading visible.
      await page.goto('/tours?q=zzqqxx', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('tours-grid')).toHaveCount(0);
      await buttons.nth(1).click();
      await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expectResultsVisible(page, `${context}/empty`, false);
      await expect(page.locator('.tours-catalog-empty')).toBeVisible();
      await expect(page.locator('input[type="search"]').first()).toHaveValue('zzqqxx');
      await expect(page.getByTestId('tours-results-count').locator('strong')).toHaveText('0');

      expect(writes, 'no write requests').toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  test('region rail selection — 390 × ko keyboard focus and reduced motion', async ({ page }, testInfo) => {
    skipUnlessLocalDesktop(testInfo.project.name);
    const writes = await installLocalBoundary(page);
    await openTours(page, 'ko', VIEWPORTS[1]);
    const buttons = page.getByTestId('tours-region-rail').locator('button');
    const target = buttons.nth(1);

    // Keyboard: Enter on the rail button must leave focus where the next Tab enters the results.
    await target.focus();
    await page.keyboard.press('Enter');
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expectResultsVisible(page, 'keyboard/pick', true);
    await page.keyboard.press('Tab');
    const landedInResults = await page.evaluate(() => !!document.activeElement?.closest('.tours-catalog-results'));
    expect(landedInResults, 'next Tab after keyboard pick enters the results list').toBe(true);
    await expectResultsVisible(page, 'keyboard/after-tab', true);

    // Reduced motion: the jump is immediate, no smooth scroll to wait out.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/tours', { waitUntil: 'domcontentloaded' });
    await buttons.nth(2).scrollIntoViewIfNeeded();
    await buttons.nth(2).click();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const r = await readResultsRect(page);
    expect(!!r && r.headingTop >= r.headerBottom - 1 && r.headingBottom <= r.vh, 'reduced motion: heading in view immediately').toBe(true);
    expect(await buttons.nth(2).evaluate((el) => el === document.activeElement), 'reduced motion: pointer focus kept').toBe(true);
    await page.emulateMedia({ reducedMotion: null });
    expect(writes, 'no write requests').toEqual([]);
  });
});

test.describe('/tours tour state restore', () => {
  test('tour state restore — 390 × ko q/region/sort survive detail and browser Back', async ({ page }, testInfo) => {
    skipUnlessLocalDesktop(testInfo.project.name);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const writes = await installLocalBoundary(page);
    await openTours(page, 'ko', VIEWPORTS[1]);

    const dialog = page.getByTestId('tours-filter-dialog');
    const body = page.getByTestId('tours-filter-dialog-body');
    const search = body.locator('input[type="search"]');
    const sort = page.locator('select:visible').first();
    const expectedSearch = '?q=DMZ&region=DMZ&sort=price-asc';

    // Typing replaces the same history entry, so it never grows per character.
    await page.getByTestId('tours-filter-trigger').click();
    await expect(dialog).toBeVisible();
    const historyBefore = await page.evaluate(() => window.history.length);
    await search.pressSequentially('DMZ');
    await expect(search).toHaveValue('DMZ');
    await expect(page).toHaveURL(/[?&]q=DMZ(&|$)/);
    expect(await page.evaluate(() => window.history.length), 'typing keeps one history entry').toBe(historyBefore);

    const dmzChip = body.locator('fieldset').first().locator('button.tour-chip', { hasText: 'DMZ' });
    await dmzChip.click();
    await expect(dmzChip).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('tours-filter-dialog-close').click();
    await expect(dialog).toBeHidden();

    await sort.selectOption('price-asc');
    await expect(sort).toHaveValue('price-asc');
    await expect.poll(() => new URL(page.url()).search).toBe(expectedSearch);

    const grid = page.getByTestId('tours-grid');
    await expect(grid.locator('.tour-catalog-card')).toHaveCount(1);
    await expect(page.getByTestId('tours-results-count').locator('strong')).toHaveText('1');
    const cardLink = grid.locator('a.tour-catalog-card-link');
    const href = await cardLink.getAttribute('href');
    expect(href, 'card link').toMatch(/^\/tours\/[a-z0-9-]+$/);
    await snap(page, testInfo, 'tour-state-before-detail');

    await cardLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    const ready = page.getByTestId('tour-detail-ready');
    const partial = page.getByTestId('tour-detail-partial');
    await expect(ready.or(partial).first()).toBeVisible();
    if (await partial.count()) {
      test.info().annotations.push({ type: 'isolated-local-partial', description: 'Firestore is aborted in isolation; detail shows the partial banner over static data' });
    }
    await snap(page, testInfo, 'tour-state-detail');

    await page.goBack();
    await expect(page).toHaveURL(/\/tours\?q=DMZ&region=DMZ&sort=price-asc$/);
    await expect(grid.locator('.tour-catalog-card')).toHaveCount(1);
    await expect(grid.locator('a.tour-catalog-card-link')).toHaveAttribute('href', href!);
    await expect(search).toHaveValue('DMZ');
    await expect(dmzChip).toHaveAttribute('aria-pressed', 'true');
    await expect(sort).toHaveValue('price-asc');
    await expect(page.getByTestId('tours-results-count').locator('strong')).toHaveText('1');
    await snap(page, testInfo, 'tour-state-after-back');

    expect(writes, 'no write requests').toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('tour state POP sync — 390 × ko fast typing, clear, region/sort, filter Back/Forward keep q, input and count aligned', async ({ page }, testInfo) => {
    skipUnlessLocalDesktop(testInfo.project.name);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const writes = await installLocalBoundary(page);
    await openTours(page, 'ko', VIEWPORTS[1]);

    const dialog = page.getByTestId('tours-filter-dialog');
    const body = page.getByTestId('tours-filter-dialog-body');
    const search = body.locator('input[type="search"]');
    const sort = page.locator('select:visible').first();
    const grid = page.getByTestId('tours-grid');
    const countEl = page.getByTestId('tours-results-count').locator('strong');
    const cards = grid.locator('.tour-catalog-card');

    /** URL q, search input and list size must agree; reads the input through the real filter dialog. */
    const expectAligned = async (label: string) => {
      await expect.poll(async () => {
        const urlQ = new URL(page.url()).searchParams.get('q') || '';
        if (!(await dialog.isVisible())) await page.getByTestId('tours-filter-trigger').click();
        await expect(dialog).toBeVisible();
        const inputQ = await search.inputValue();
        const shown = Number(await countEl.textContent());
        const rendered = await cards.count();
        return urlQ === inputQ && shown === rendered ? 'ok' : `url=${urlQ} input=${inputQ} count=${shown} cards=${rendered}`;
      }, { message: `${label}: q/input/count aligned`, timeout: 5000 }).toBe('ok');
      await page.getByTestId('tours-filter-dialog-close').click();
      await expect(dialog).toBeHidden();
    };

    await page.getByTestId('tours-filter-trigger').click();
    await expect(dialog).toBeVisible();
    const historyBefore = await page.evaluate(() => window.history.length);
    await search.pressSequentially('DMZ', { delay: 0 });
    await expect(search).toHaveValue('DMZ');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('DMZ');
    expect(await page.evaluate(() => window.history.length), 'typing keeps one history entry').toBe(historyBefore);

    const dmzChip = body.locator('fieldset').first().locator('button.tour-chip', { hasText: 'DMZ' });
    const qqOf = () => new URL(page.url()).searchParams.get('q') || '';
    const expectedCounts = new Map<string, number>();
    const remember = async () => {
      expectedCounts.set(new URL(page.url()).search, Number(await countEl.textContent()));
    };
    await remember();
    const typedUrl = page.url();

    // Region selection PUSHes an entry that still carries q=DMZ.
    await dmzChip.click();
    await expect(dmzChip).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => new URL(page.url()).search).toBe('?q=DMZ&region=DMZ');
    await remember();

    // Clearing q afterwards REPLACEs the current entry only, so the earlier entry keeps q=DMZ.
    await search.fill('');
    await expect(search).toHaveValue('');
    await expect.poll(qqOf).toBe('');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();
    await page.getByTestId('tours-filter-dialog-close').click();
    await expect(dialog).toBeHidden();
    await expectAligned('after clear');
    await remember();
    await sort.selectOption('price-asc');
    await expect.poll(() => new URL(page.url()).search).toBe('?region=DMZ&sort=price-asc');
    await expectAligned('region+sort');
    await remember();
    const finalUrl = page.url();
    await snap(page, testInfo, 'tour-pop-sync-final');

    // Real browser Back until the region is gone, then Forward the same distance; every step stays aligned.
    const trail: string[] = [finalUrl];
    const qTrail: string[] = [qqOf()];
    for (let i = 0; i < 4 && new URL(page.url()).searchParams.has('region'); i += 1) {
      await page.goBack();
      await expect(page).toHaveURL(/\/tours/);
      await expectAligned(`back ${i + 1}`);
      trail.push(page.url());
      qTrail.push(qqOf());
      expect(Number(await countEl.textContent()), `back ${i + 1}: expected list`).toBe(expectedCounts.get(new URL(page.url()).search));
    }
    expect(trail.length, 'Back moved through at least one entry').toBeGreaterThan(1);
    expect(trail[trail.length - 1], 'Back reached the typed entry').toBe(typedUrl);
    expect(qTrail, 'Back crossed both empty q and q=DMZ').toContain('');
    expect(qTrail, 'Back crossed both empty q and q=DMZ').toContain('DMZ');
    expect(qTrail[0]).not.toBe(qTrail[qTrail.length - 1]);
    await snap(page, testInfo, 'tour-pop-sync-back');
    for (let i = trail.length - 2; i >= 0; i -= 1) {
      await page.goForward();
      await expect(page).toHaveURL(trail[i]);
      await expectAligned(`forward to ${i}`);
      expect(qqOf(), `forward to ${i}: q`).toBe(qTrail[i]);
      expect(Number(await countEl.textContent()), `forward to ${i}: expected list`).toBe(expectedCounts.get(new URL(page.url()).search));
    }
    await expect(sort).toHaveValue('price-asc');
    await snap(page, testInfo, 'tour-pop-sync-forward');

    expect(writes, 'no write requests').toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
