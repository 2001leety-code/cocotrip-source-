import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Planner compact workspace — layout regressions on the real page (local
 * preview only). Same isolation as customer-night-wiring.spec.ts: every
 * non-local request is aborted and the local `/api/*` boundary answers `{}`.
 * Nothing is generated, submitted or paid for — every case stops at a step
 * gate, and any non-GET request fails the test.
 */

test.use({ serviceWorkers: 'block' });
// `video` is worker-scoped, so it can only be set at the top level. Off by
// default; PLANNER_COHESION_VIDEO=1 records (run with --grep 'normal, hover').
test.use({
  video: process.env.PLANNER_COHESION_VIDEO === '1'
    ? { mode: 'on', size: { width: 390, height: 844 } }
    : 'off',
});

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');

type Lang = 'en' | 'ko' | 'ja' | 'zh';

async function setupPage(page: Page, lang: Lang) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');

  await page.addInitScript(([origin, l]) => {
    if (window.location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', l);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, [BASE.origin, lang]);

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`);
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { pageErrors, writes };
}

/**
 * First visit opens the intro — but only at innerWidth >= 768, 350ms after
 * mount (AIIntroModal). On a phone assert it stays absent; on desktop close it
 * the way a visitor would.
 */
async function dismissIntro(page: Page) {
  const intro = page.getByRole('dialog').filter({ has: page.locator('#ai-intro-title') });
  const width = await page.evaluate(() => window.innerWidth);
  if (width < 768) {
    await page.waitForTimeout(500);
    await expect(intro).toHaveCount(0);
    return;
  }
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(intro).toBeHidden();
}

const question = (page: Page) => page.locator('.planner-question');
const firstBookingChoice = (page: Page) => question(page).locator('button[aria-pressed]').first();

const bookingRows = (page: Page) => question(page).locator('.wizard-res-row');

async function expectBookingRows(page: Page, minHeight: number) {
  await expect(bookingRows(page)).toHaveCount(4);
  const rows = await bookingRows(page).evaluateAll((els) => els.map((el) => {
    const list = el.parentElement!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const texts = [...el.querySelectorAll('.wizard-res-row__title, .wizard-res-row__sub')].map((t) => {
      const cs = getComputedStyle(t);
      return {
        title: t.classList.contains('wizard-res-row__title'),
        display: cs.display,
        visible: t.getBoundingClientRect().width > 0,
        // An inline span reports 0 for both client* and scroll* (never "clipped");
        // a block title compares its real boxes.
        clipped: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1,
        clamp: cs.webkitLineClamp,
        empty: !(t.textContent || '').trim(),
      };
    });
    return {
      height: r.height,
      fullWidth: Math.abs(r.width - list.width) <= 1,
      texts,
      titleText: (el.querySelector('.wizard-res-row__title')?.textContent || '').trim(),
      nestedBoxes: el.querySelectorAll('svg:not(.wizard-res-row__mark svg), [class*="rounded-ec"]').length,
    };
  }));
  for (const row of rows) {
    // Subpixel rounding: getBoundingClientRect can report e.g. 55.9999; round to 2 decimals (≤0.01px tolerance).
    expect(Math.round(row.height * 100) / 100).toBeGreaterThanOrEqual(minHeight);
    expect(row.fullWidth).toBe(true);
    expect(row.nestedBoxes).toBe(0);
    // Both spans stay in the DOM; first step shows the title only.
    expect(row.texts).toHaveLength(2);
    for (const t of row.texts) {
      expect(t.empty).toBe(false);
      if (t.title) {
        expect(t.visible).toBe(true);
        expect(t.clipped).toBe(false);
        expect(t.clamp === 'none' || t.clamp === '').toBe(true);
      } else {
        expect(t.display).toBe('none');
      }
    }
    expect(row.titleText.length).toBeGreaterThan(0);
  }
  const names = await bookingRows(page).evaluateAll((els) =>
    els.map((el) => (el.querySelector('.wizard-res-row__title')?.textContent || '').trim()));
  for (const [i, name] of names.entries()) {
    await expect(bookingRows(page).nth(i)).toHaveAccessibleName(name);
  }
}

/** First step only: the explanations around the question are gone, the price note is whole (short wording). */
async function expectChoiceFirst(page: Page) {
  const width = page.viewportSize()!.width;
  const price = page.locator('.planner-price');
  await expect(price.locator('li')).toHaveCount(3);
  for (const li of await price.locator('li').all()) {
    await expect(li).toBeVisible();
    await expect(li.locator('.ai-planner-pricing-note__short')).toBeVisible();
    await expect(li.locator('.ai-planner-pricing-note__full')).toBeHidden();
  }
  const fx = price.locator('.ai-planner-pricing-note > p:not(.ec-eyebrow)');
  await expect(fx).toBeVisible();
  await expect(fx.locator('.ai-planner-pricing-note__short')).toBeVisible();
  await expect(fx.locator('.ai-planner-pricing-note__full')).toBeHidden();
  await expect(price.locator('.ai-planner-pricing-note > .ec-eyebrow')).toBeHidden();
  await expect(page.locator('.planner-lede')).toBeHidden();
  await expect(page.locator('#planner-mode-heading')).toBeHidden();
  await expect(question(page).locator('.wizard-res-ticket > div:first-child > h2')).toBeVisible();
  await expect(question(page).locator('.wizard-res-ticket > div:first-child > p')).toBeHidden();
  await expect(question(page).locator('.ec-steprail')).toBeHidden();
  await expect(question(page).locator('.w-full > .mb-5 > div:first-child > .ec-figure')).toBeHidden();
  // Step hint and trust line: first step only, hidden.
  await expect(page.locator('.wizard-step-hint-slot')).toBeHidden();
  await expect(page.locator('.wizard-trust-list')).toBeHidden();
  // The step count stays in the accessibility tree at every width. On a phone
  // it is screen-reader-only (clipped 1px box), so the five buttons get one line.
  const count = question(page).locator('.w-full > .mb-5 > div:first-child > .ec-eyebrow');
  await expect(count).toHaveText(/\d/);
  const countBox = question(page).locator('.w-full > .mb-5 > div:first-child');
  if (width < 768) {
    await expect(countBox).toHaveCSS('position', 'absolute');
    await expect(countBox).toHaveCSS('width', '1px');
    await expect(countBox).toHaveCSS('overflow', 'hidden');
    await expect(question(page).locator('.w-full > .mb-5')).toHaveCSS('margin-bottom', '12px');
  } else {
    await expect(count).toBeVisible();
    await expect(countBox).not.toHaveCSS('position', 'absolute');
    await expect(question(page).locator('.w-full > .mb-5')).toHaveCSS('margin-bottom', '20px');
  }
  // The only visible full question is the step's own h2.
  await expect(question(page).locator('.w-full > .mb-5 > .ec-question')).toHaveCSS('position', 'absolute');

  const steps = await question(page).locator('.w-full > .mb-5 > ol').evaluate((ol) => ({
    overflow: ol.scrollWidth - ol.clientWidth,
    rects: [...ol.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { w: r.width, h: r.height, top: r.top, label: b.getAttribute('aria-label') || '' };
    }),
  }));
  expect(steps.overflow).toBeLessThanOrEqual(1);
  expect(steps.rects).toHaveLength(5);
  // One line: all five step buttons share a top edge.
  const tops = steps.rects.map((s) => s.top);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  for (const s of steps.rects) {
    expect(s.w).toBeGreaterThanOrEqual(44);
    expect(s.h).toBeGreaterThanOrEqual(44);
    expect(s.label.length).toBeGreaterThan(0);
  }
  await expect(question(page).locator('.w-full > .mb-5 button[aria-current="step"]')).toHaveCount(1);
  await expect(question(page).locator('.wizard-res-cta')).toBeVisible();
  await expect(question(page).locator('.wizard-res-cta')).toBeEnabled();
}

/**
 * Short (first step) and full (steps 2-5) price wording come from the same
 * formatted amounts: full paid row = "USD (KRW)"; short paid row carries that
 * USD, short FX note that KRW; coupon day range is the same in both.
 */
async function expectPriceVariantsAgree(page: Page) {
  const v = await page.locator('.planner-price .ai-planner-pricing-note').evaluate((note) => {
    const text = (el: Element | null | undefined, cls: string) =>
      (el?.querySelector(cls)?.textContent || '').trim();
    const lis = [...note.querySelectorAll(':scope > ul > li')];
    const fx = note.querySelector(':scope > p:not(.ec-eyebrow)');
    return {
      rows: lis.length,
      couponFull: text(lis[1], '.ai-planner-pricing-note__full'),
      couponShort: text(lis[1], '.ai-planner-pricing-note__short'),
      paidFull: text(lis[2], '.ai-planner-pricing-note__full'),
      paidShort: text(lis[2], '.ai-planner-pricing-note__short'),
      noteFull: text(fx, '.ai-planner-pricing-note__full'),
      noteShort: text(fx, '.ai-planner-pricing-note__short'),
    };
  });
  expect(v.rows).toBe(3);
  const m = v.paidFull.match(/(\S+) \(([^)]+)\)/);
  expect(m, v.paidFull).not.toBeNull();
  const [, usd, krw] = m!;
  expect(usd).toMatch(/\d/);
  expect(krw).toMatch(/\d/);
  expect(v.paidShort).toContain(usd);
  expect(v.noteShort).toContain(krw);
  // Currency name in the locale's own wording (zh: 美元).
  expect(v.noteShort).toMatch(/USD|美元/);
  expect(v.noteShort).not.toMatch(/\{(price|krw)\}/);
  expect(v.paidShort).not.toMatch(/\{(price|krw)\}/);
  expect(v.noteFull.length).toBeGreaterThan(0);
  const digits = (s: string) => s.match(/\d+/g) || [];
  expect(digits(v.couponShort)).toEqual(digits(v.couponFull));
}

/**
 * Computed type of the first-step text a visitor reads. For the price rows and
 * FX note, `text` is the innerText of the visible variant span only.
 */
async function fontSamples(page: Page) {
  return page.evaluate(() => {
    const groups: [string, string][] = [
      ['question', '.planner-question .wizard-step-viewport h2'],
      ['priceRow', '.planner-price .ai-planner-pricing-note > ul > li'],
      ['fxNote', '.planner-price .ai-planner-pricing-note > p:not(.ec-eyebrow)'],
      ['rowTitle', '.wizard-res-row__title'],
      ['cta', '.wizard-res-cta'],
    ];
    return groups.flatMap(([role, selector]) => [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el, index) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const visibleSpan = [...el.querySelectorAll<HTMLElement>(
          ':scope > .ai-planner-pricing-note__short, :scope > .ai-planner-pricing-note__full')]
          .find((s) => getComputedStyle(s).display !== 'none');
        return {
          role,
          index,
          variant: visibleSpan ? (visibleSpan.classList.contains('ai-planner-pricing-note__short') ? 'short' : 'full') : null,
          fontSize: cs.fontSize,
          lineHeight: cs.lineHeight,
          fontWeight: cs.fontWeight,
          foreground: cs.color,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          text: (visibleSpan || el).innerText.trim().slice(0, 80),
        };
      }));
  });
}

/** Fixed mobile bottom nav (<768px) covers the bottom of the viewport. */
const MOBILE_NAV_RESERVE = 64;

const LAYOUTS: { width: number; height: number; lang: Lang }[] = [
  { width: 360, height: 800, lang: 'ko' },
  { width: 360, height: 800, lang: 'en' },
  { width: 360, height: 800, lang: 'ja' },
  { width: 360, height: 800, lang: 'zh' },
  { width: 430, height: 932, lang: 'ko' },
  { width: 430, height: 932, lang: 'en' },
  { width: 430, height: 932, lang: 'ja' },
  { width: 430, height: 932, lang: 'zh' },
  { width: 390, height: 844, lang: 'ko' },
  { width: 390, height: 844, lang: 'en' },
  { width: 390, height: 844, lang: 'ja' },
  { width: 390, height: 844, lang: 'zh' },
  { width: 768, height: 1024, lang: 'ja' },
  { width: 1024, height: 768, lang: 'ko' },
  { width: 1024, height: 768, lang: 'en' },
  { width: 1024, height: 768, lang: 'ja' },
  { width: 1024, height: 768, lang: 'zh' },
  { width: 1280, height: 800, lang: 'ko' },
  { width: 1280, height: 800, lang: 'en' },
  { width: 1280, height: 800, lang: 'ja' },
  { width: 1280, height: 800, lang: 'zh' },
  { width: 1172, height: 800, lang: 'en' },
  { width: 1440, height: 900, lang: 'ko' },
  { width: 1440, height: 900, lang: 'en' },
  { width: 1440, height: 900, lang: 'ja' },
  { width: 1440, height: 900, lang: 'zh' },
];

for (const { width, height, lang } of LAYOUTS) {
  test(`layout ${width}x${height} ${lang}: price note precedes the first question, nothing overflows`, async ({ page }) => {
    const { pageErrors, writes } = await setupPage(page, lang);
    await page.setViewportSize({ width, height });
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();

    const price = page.locator('.planner-price');
    await expect(price).toBeVisible();
    await expect(question(page)).toBeVisible();

    // DOM order and visual order: the price note comes first.
    const priceFirst = await price.evaluate((el) => {
      const form = document.querySelector('.planner-question');
      return !!form && !!(el.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(priceFirst).toBe(true);
    const priceBox = await price.boundingBox();
    const formBox = await question(page).boundingBox();
    expect(priceBox && formBox && priceBox.y + priceBox.height <= formBox.y + 1).toBe(true);

    // The first booking choice is wholly inside the first screen, above the
    // fixed mobile nav — not merely "just past" it.
    const choice = firstBookingChoice(page);
    await expect(choice).toBeVisible();
    const choiceBox = await choice.boundingBox();
    const reserve = width < 768 ? MOBILE_NAV_RESERVE : 0;
    expect(choiceBox).not.toBeNull();
    expect(choiceBox!.y + choiceBox!.height).toBeLessThanOrEqual(height - reserve);

    // Mode buttons keep the 44px floor.
    for (const box of await page.locator('.planner-mode-btn').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }

    // First step: four full-width rows, each ≥44px (≥56 on a phone), no
    // clipped or clamped label, no nested icon tile.
    await expectBookingRows(page, width < 768 ? 56 : 44);
    await expectChoiceFirst(page);
    await expectPriceVariantsAgree(page);

    // Cloud poster behind the first step's page header (decoration only).
    expect(await page.locator('.ec-planner').evaluate((el) => getComputedStyle(el, '::before').backgroundImage))
      .toContain('v3-cloud-poster');

    // Type: question 19, row titles 15; price rows and FX note 14 on a phone,
    // original 14/13 from 640px up (desktop sizing untouched).
    const fonts = await fontSamples(page);
    const sizeOf = (role: string) => fonts.filter((f) => f.role === role).map((f) => f.fontSize);
    expect(sizeOf('question')).toEqual(['19px']);
    expect(sizeOf('rowTitle')).toEqual(['15px', '15px', '15px', '15px']);
    expect(sizeOf('priceRow')).toEqual(['14px', '14px', '14px']);
    expect(sizeOf('fxNote')).toEqual([width < 768 ? '14px' : '13px']);
    if (width < 768) expect(sizeOf('cta')).toEqual(['15px']);
    for (const f of fonts.filter((x) => x.role === 'priceRow' || x.role === 'fxNote')) {
      expect(f.variant).toBe('short');
      expect(f.text.length).toBeGreaterThan(0);
    }
    expect((await question(page).locator('.wizard-res-cta').boundingBox())!.height).toBeGreaterThanOrEqual(48);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);

    const shotDir = process.env.HOME_DOPE_SCREENSHOT_DIR;
    if (shotDir) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${shotDir}/planner-${lang}-${width}.png` });
    }
  });
}

test('step gate: later steps stay locked and Continue explains what is missing', async ({ page }) => {
  const { pageErrors, writes } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);

  const step1 = page.getByRole('button', { name: /^Step 1:/ });
  const step2 = page.getByRole('button', { name: /^Step 2:/ });
  await expect(step1).toHaveAttribute('aria-current', 'step');
  await expect(step2).toBeDisabled();

  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await expect(page.getByText('Still needed before you continue').first()).toBeVisible();
  await expect(step1).toHaveAttribute('aria-current', 'step');

  // Keyboard: the first booking choice is reachable and selectable.
  const choice = firstBookingChoice(page);
  await choice.focus();
  await page.keyboard.press('Space');
  await expect(choice).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /Nothing booked yet/i }).first().click();
  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await expect(step2).toHaveAttribute('aria-current', 'step');

  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('home deep link: prefillRegions=seoul still lands Seoul in the compact layout', async ({ page }) => {
  const { pageErrors, writes } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/planner?prefillRegions=seoul', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);

  await page.getByRole('button', { name: /Nothing booked yet/i }).first().click();
  await page.getByRole('button', { name: /^Continue$/ }).first().click();
  await expect(page.getByRole('button', { name: /^Seoul/ }).first()).toHaveAttribute('aria-pressed', 'true');

  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('mode=course opens the existing builder at full width', async ({ page }) => {
  const { pageErrors, writes } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/planner?mode=course', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);

  await expect(page.locator('.planner-mode-btn.is-selected')).toHaveCount(1);
  await expect(page.locator('.planner-mode-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.planner-workspace')).not.toHaveClass(/\bis-split\b/);
  await expect(question(page)).toHaveCount(0);
  await expect(page.locator('main input[type="time"]').first()).toBeVisible();

  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('reduced motion: the form is there at once, with no entrance animation', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1172, height: 800 });
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);

  await expect(firstBookingChoice(page)).toBeVisible();
  const animations = await page.locator('.planner-rail, .planner-stage').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).animationName));
  expect(animations).toEqual(['none', 'none']);
  // First-step rows, Continue and mode buttons: no property transitions at all.
  const properties = await page
    .locator('.wizard-res-row, .wizard-res-cta, .planner-mode-btn')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).transitionProperty));
  expect(properties).toHaveLength(7);
  expect(properties.every((p) => p === 'none')).toBe(true);
  expect(pageErrors).toEqual([]);
});

/* ── Enlarged text on the first step — SIMULATIONS, not real browser zoom or
   iOS Safari text size. (a) 200%: the viewport is opened at twice the phone
   width and height (360→720, 390→780; 844→1688), then a test-only stylesheet
   sets `zoom: 2` on the root, so content lays out in the phone's CSS width at
   double size inside that physical viewport. Media queries still see the
   doubled width; this is a CSS-zoom simulation only.
   (b) 150%: a test-only pass multiplies every element's computed px font-size
   (and px line-height) by 1.5 — the app's sizes are fixed px, so a root
   font-size change would be a no-op. Checked: no sideways overflow, no
   clipped text, and Continue is reachable by scrolling and not covered. The
   first choice is NOT required to fit the first screen here. ─────────────── */

const ENLARGED_SELECTORS = [
  '.planner-price li',
  '.planner-price .ai-planner-pricing-note > p:not(.ec-eyebrow)',
  '.planner-question .wizard-step-viewport h2',
  '.wizard-res-row',
  '.wizard-res-row__title',
  '.wizard-res-cta',
];

async function expectEnlargedReflows(page: Page) {
  const report = await page.evaluate((selectors) => {
    window.scrollTo(100000, window.scrollY);
    const scrollX = window.scrollX;
    window.scrollTo(0, window.scrollY);
    const vw = window.innerWidth;
    const items = selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          selector,
          text: el.innerText.trim().slice(0, 40),
          outside: r.left < -1 || r.right > vw + 1,
          clipped: el.scrollWidth > el.clientWidth + 1,
        };
      }));
    return { scrollX, items };
  }, ENLARGED_SELECTORS);
  expect(report.scrollX).toBeLessThanOrEqual(1);
  expect(report.items.length).toBeGreaterThanOrEqual(3 + 1 + 1 + 4 + 4 + 1);
  for (const item of report.items) {
    expect(item.outside, `${item.selector} "${item.text}" leaves the viewport`).toBe(false);
    expect(item.clipped, `${item.selector} "${item.text}" is clipped`).toBe(false);
  }

  const cta = question(page).locator('.wizard-res-cta');
  await cta.scrollIntoViewIfNeeded();
  // scrollIntoViewIfNeeded only checks the viewport, not the fixed bottom nav, so
  // at enlarged text the CTA can land behind it. The intent is "reachable by
  // scrolling", so deliberately center it via ordinary scroll, then verify the hit.
  await cta.evaluate((el) =>
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
  );
  await expect(cta).toBeInViewport();
  // Real actionability check without clicking/advancing.
  await cta.click({ trial: true });
  const onTop = await cta.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(onTop).toBe(true);
}

for (const width of [360, 390]) {
  for (const lang of ['ko', 'en', 'ja', 'zh'] as Lang[]) {
    test(`enlarged text ${width} ${lang}: 200% CSS-zoom and 150% text-growth simulations reflow (not real Safari/browser zoom)`, async ({ page }) => {
      const { pageErrors, writes } = await setupPage(page, lang);
      // (a) 200% CSS zoom simulation in a doubled viewport (780 opens the desktop intro; 720 does not).
      await page.setViewportSize({ width: width * 2, height: 844 * 2 });
      await page.goto('/planner', { waitUntil: 'domcontentloaded' });
      await dismissIntro(page);
      await expect(firstBookingChoice(page)).toBeVisible();
      const titleBefore = (await bookingRows(page).first().locator('.wizard-res-row__title').boundingBox())!.height;
      await page.addStyleTag({ content: 'html { zoom: 2 !important; }' });
      await expect(page.locator('html')).toHaveCSS('zoom', '2');
      const titleZoomed = (await bookingRows(page).first().locator('.wizard-res-row__title').boundingBox())!.height;
      expect(titleZoomed).toBeGreaterThanOrEqual(titleBefore * 1.8);
      await expectEnlargedReflows(page);

      // (b) 150% text-growth simulation on a fresh page at the original phone viewport.
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/planner', { waitUntil: 'domcontentloaded' });
      await dismissIntro(page);
      await expect(firstBookingChoice(page)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        const els = [...document.querySelectorAll<HTMLElement>('body *')];
        const sizes = els.map((el) => {
          const cs = getComputedStyle(el);
          return { fs: parseFloat(cs.fontSize), lh: cs.lineHeight };
        });
        els.forEach((el, i) => {
          const { fs, lh } = sizes[i];
          if (fs > 0) el.style.setProperty('font-size', `${fs * 1.5}px`, 'important');
          if (lh.endsWith('px')) el.style.setProperty('line-height', `${parseFloat(lh) * 1.5}px`, 'important');
        });
      });
      await expect(question(page).locator('.wizard-step-viewport h2')).toHaveCSS('font-size', '28.5px');
      await expect(bookingRows(page).first().locator('.wizard-res-row__title')).toHaveCSS('font-size', '22.5px');
      await expect(page.locator('.planner-price li').first()).toHaveCSS('font-size', '21px');
      await expectEnlargedReflows(page);

      expect(writes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
}

/* ── Home cohesion (2026-10-07): /planner wears Home's chrome, serif, ticket
   and pill CTA on the first step only. Presentation checks; every gate above
   is untouched. ─────────────────────────────────────────────────────────── */

const LAVENDER = 'rgb(201, 184, 255)';

test('home cohesion: chrome, title serif, first-step ticket and pill CTA', async ({ page }) => {
  const { pageErrors, writes } = await setupPage(page, 'ko');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);

  await expect(page.locator('header.ec-root').first()).toHaveClass(/\bhome-dope-chrome\b/);

  // CJK title: Home's upright CJK serif stack, compact 28px on a phone.
  const serif = await page.locator('.planner-title-serif').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { family: cs.fontFamily, style: cs.fontStyle, size: getComputedStyle(el.parentElement!).fontSize };
  });
  expect(serif.family).toContain('Noto Serif KR');
  expect(serif.style).toBe('normal');
  expect(serif.size).toBe('28px');

  // Ticket material on the question card while the first step is shown — no mask.
  const card = await question(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, shadow: cs.boxShadow, mask: cs.maskImage || 'none' };
  });
  expect(card).toEqual({ radius: '10.8px', bg: 'rgba(255, 255, 255, 0.06)', shadow: 'none', mask: 'none' });
  await expect(question(page).locator('.wizard-res-stub')).toHaveCSS('border-top-style', 'dashed');

  const cta = question(page).locator('.wizard-res-cta');
  await expect(cta).toHaveCSS('background-color', LAVENDER);
  await expect(cta).toHaveCSS('border-top-left-radius', '999px');
  expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(48);

  // The price note still comes first, in full.
  await expect(page.locator('.planner-price')).toBeVisible();

  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('home cohesion: Latin title is the v3 serif italic; /tours keeps the shared shell', async ({ page }) => {
  const { writes } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);

  const serif = page.locator('.planner-title-serif');
  await expect(serif).toHaveCSS('font-style', 'italic');
  expect(await serif.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('V3 Serif');
  await expect(page.locator('footer.ec-root')).toHaveClass(/\bhome-dope-chrome\b/);

  expect(writes).toEqual([]);
  // /tours issues one known public READ (rating aggregate) via POST; the /api mock answers it.
  const reviewsUrl = 'http://127.0.0.1:5178/api/reviews';
  const aggregateQuery = page.waitForRequest((req) => req.method() === 'POST' && req.url() === reviewsUrl);
  await page.goto('/tours', { waitUntil: 'domcontentloaded' });
  expect((await aggregateQuery).postDataJSON()).toEqual({ action: 'aggregate', targetType: 'tour' });
  await expect(page.locator('header.ec-root').first()).toBeVisible();
  await expect(page.locator('header.ec-root').first()).not.toHaveClass(/\bhome-dope-chrome\b/);
  expect(writes).toEqual([`POST ${reviewsUrl}`]);
});

test.describe('home cohesion first step (video 390)', () => {

  test('normal, hover/focus, pressed, invalid Continue, valid Continue → step 2 → Back keeps the choice', async ({ page }) => {
    const { pageErrors, writes } = await setupPage(page, 'en');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);
    const dir = process.env.HOME_DOPE_SCREENSHOT_DIR;
    const video = process.env.PLANNER_COHESION_VIDEO === '1';
    // Recording only: the app keeps scroll position across clicks and step changes, so the
    // frame can land on the FAQ below the form. Deliberately scroll the state's target into view.
    const frame = async (name: string) => {
      const center = (el: Element) => {
        const r = el.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + r.top + r.height / 2 - window.innerHeight / 2, behavior: 'instant' });
      };
      if (name === 'hover-focus' || name === 'pressed') {
        const flightRow = page.getByRole('button', { name: /^Flight booked/i }).first();
        await flightRow.evaluate(center);
        await flightRow.hover();
        await flightRow.focus();
      } else if (name === 'invalid') {
        await page.getByText('Still needed before you continue').first().evaluate(center);
      } else if (name === 'step2') {
        await question(page).evaluate((el) => {
          window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 80, behavior: 'instant' });
        });
      } else if (name === 'back') {
        await page.getByRole('button', { name: /Nothing booked yet/i }).first().evaluate(center);
      }
    };
    const shot = async (name: string) => {
      // Recording only: frame the state, then hold it long enough for a person to see it.
      if (video) {
        await frame(name);
        await page.waitForTimeout(650);
      }
      if (dir) await page.screenshot({ path: `${dir}/planner-first-step-390-${name}.png` });
    };

    await expectBookingRows(page, 56);
    await shot('normal');

    // Keyboard focus on the compact step nav: inset ring, all four edges inside the scroller.
    const step1 = page.getByRole('button', { name: /^Step 1:/ });
    await step1.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(step1).toBeFocused();
    await expect(step1).toHaveCSS('outline-style', 'solid');
    await expect(step1).toHaveCSS('outline-width', '2px');
    await expect(step1).toHaveCSS('outline-offset', '-2px');
    await expect(step1).toHaveCSS('box-shadow', 'none');

    const flight = page.getByRole('button', { name: /^Flight booked/i }).first();
    await flight.scrollIntoViewIfNeeded();
    await expect(flight).toBeInViewport();
    await flight.hover();
    await flight.focus();
    await shot('hover-focus');

    // Keyboard selection: aria-pressed and the check mark move together.
    await page.keyboard.press('Space');
    await expect(flight).toHaveAttribute('aria-pressed', 'true');
    await expect(flight.locator('.wizard-res-row__mark svg')).toHaveCount(1);
    await expect(flight.locator('.wizard-res-row__mark')).toHaveCSS('background-color', LAVENDER);
    await shot('pressed');

    // Flight needs airport + time: Continue stays clickable and explains why.
    await question(page).locator('.wizard-res-cta').click();
    await expect(page.getByText('Still needed before you continue').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Step 1:/ })).toHaveAttribute('aria-current', 'step');
    await shot('invalid');

    const nothing = page.getByRole('button', { name: /Nothing booked yet/i }).first();
    await nothing.click();
    await expect(nothing).toHaveAttribute('aria-pressed', 'true');
    await expect(flight).toHaveAttribute('aria-pressed', 'false');
    await question(page).locator('.wizard-res-cta').click();
    await expect(page.getByRole('button', { name: /^Step 2:/ })).toHaveAttribute('aria-current', 'step');

    // Step 2: the ticket and its stub belong to the first step only. Wait for
    // the lazily mounted stage before reading styles keyed on it.
    await expect(question(page).locator('.wizard-res-ticket')).toHaveCount(0);
    await expect(question(page).locator('.wizard-stage')).toBeVisible();
    // 2026-10-07 scope expansion: steps 2-5 share the first step's compact
    // frame — glass/hairline panel, five-number rail (count + step names kept
    // for assistive tech), no bar/percentage/lede/eyebrows, short price wording.
    // Later steps intentionally drop the outer card frame (flat, radius 0).
    await expect(question(page)).toHaveCSS('border-top-left-radius', '0px');
    await expect(question(page).locator('.ec-steprail')).toBeHidden();
    await expect(question(page).locator('.w-full > .mb-5 > div:first-child > .ec-figure')).toBeHidden();
    await expect(page.locator('.planner-lede')).toBeHidden();
    await expect(page.locator('#planner-mode-heading')).toBeHidden();
    await expect(page.locator('.planner-mode-btn.is-selected')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.wizard-step-hint-slot')).toHaveCSS('display', 'none');
    await expect(page.locator('.wizard-trust-list')).toBeHidden();
    await expect(question(page).locator('.w-full > .mb-5 > div:first-child')).toHaveCSS('position', 'absolute');
    await expect(question(page).locator('.w-full > .mb-5 > div:first-child > .ec-eyebrow')).not.toBeEmpty();
    await expect(question(page).locator('.w-full > .mb-5 > ol > li')).toHaveCount(5);
    await expect(page.getByRole('button', { name: /^Step 1:/ })).toBeVisible();
    // The step's own question stays the visible heading.
    await expect(question(page).locator('.wizard-step-viewport h2').first()).toBeVisible();
    const step2Price = page.locator('.planner-price');
    await expect(step2Price.locator('li')).toHaveCount(3);
    for (const el of [...await step2Price.locator('li').all(), step2Price.locator('.ai-planner-pricing-note > p:not(.ec-eyebrow)')]) {
      await expect(el.locator('.ai-planner-pricing-note__short')).toBeVisible();
      await expect(el.locator('.ai-planner-pricing-note__full')).toBeHidden();
    }
    // Same 14px price rows and FX note as the first step on a phone.
    await expect(step2Price.locator('li').first()).toHaveCSS('font-size', '14px');
    await expect(step2Price.locator('.ai-planner-pricing-note > p:not(.ec-eyebrow)')).toHaveCSS('font-size', '14px');
    await shot('step2');

    await question(page).getByRole('button', { name: 'Back', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /^Step 1:/ })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('button', { name: /Nothing booked yet/i }).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(question(page)).toHaveCSS('border-top-left-radius', '10.8px');
    await expectBookingRows(page, 56);
    await expectChoiceFirst(page);
    await shot('back');

    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

/* ── Final evidence: Home and Planner captured as a pair at the same viewport,
   plus computed colours/rects tied to each PNG for an outside contrast read.
   Writes files only when HOME_DOPE_SCREENSHOT_DIR is set. ───────────────── */

const CONTRAST_SELECTORS = [
  '.planner-title-serif',
  '.planner-title-sans',
  '.planner-lede',
  '.planner-mode-btn',
  '.wizard-res-row__title',
  '.wizard-res-row__sub',
  '.wizard-res-cta',
];

/** Computed foreground/background and on-screen rect of every match, read right after `png` was taken. */
async function contrastSamples(page: Page, png: string, state: string) {
  const samples = await page.evaluate((selectors) => selectors.flatMap((selector) =>
    [...document.querySelectorAll(selector)].map((el, index) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const row = el.closest('.wizard-res-row');
      return {
        selector,
        index,
        selected: el.classList.contains('is-selected') || row?.getAttribute('aria-pressed') === 'true',
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        inViewport: r.bottom > 0 && r.top < window.innerHeight && r.width > 0,
        foreground: cs.color,
        background: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        text: (el.textContent || '').trim().slice(0, 60),
      };
    })), CONTRAST_SELECTORS);
  // Elements the first step hides (lede, row sub-labels) have no box — nothing to read.
  return samples.filter((s) => s.rect.width > 0 && s.rect.height > 0).map((s) => ({ png, state, ...s }));
}

/** First-step notches are real, the card is not clipped, the page does not overflow, the price note leads. */
async function expectFirstStepFinal(page: Page) {
  const card = await question(page).evaluate((el) => {
    const notch = (pseudo: string) => {
      const cs = getComputedStyle(el, pseudo);
      return { content: cs.content, width: cs.width, background: cs.backgroundColor, events: cs.pointerEvents };
    };
    const cs = getComputedStyle(el);
    return { position: cs.position, overflow: cs.overflow, before: notch('::before'), after: notch('::after') };
  });
  expect(card.position).toBe('relative');
  expect(card.overflow).toBe('visible');
  for (const n of [card.before, card.after]) {
    expect(n).toEqual({ content: '""', width: '13px', background: 'rgb(10, 11, 20)', events: 'none' });
  }
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const priceBox = await page.locator('.planner-price').boundingBox();
  const formBox = await question(page).boundingBox();
  expect(priceBox && formBox && priceBox.y + priceBox.height <= formBox.y + 1).toBe(true);
}

test('final paired captures and contrast evidence', async ({ page }) => {
  const dir = process.env.HOME_DOPE_SCREENSHOT_DIR;
  if (!dir) return;
  const { pageErrors, writes } = await setupPage(page, 'ko');
  const fontsReady = () => page.evaluate(async () => { await document.fonts.ready; });
  const viewport = () => page.evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }));
  const meta: Record<string, unknown>[] = [];

  for (const { width, height } of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize({ width, height });

    // Home: hold the sky video and the sample pass through their own controls.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await fontsReady();
    await page.waitForTimeout(800);
    const sky = page.locator('.home-dope-sky-toggle');
    if (await sky.isVisible() && (await sky.getAttribute('data-state')) === 'playing') {
      await sky.click();
      await expect(sky).toHaveAttribute('data-state', 'paused');
    }
    const passPause = page.locator('.home-dope-pass__pause');
    if (await passPause.isVisible() && (await passPause.getAttribute('aria-pressed')) !== 'true') {
      await passPause.click();
      await expect(passPause).toHaveAttribute('aria-pressed', 'true');
    }
    await page.mouse.move(0, 0);
    const homePng = `final-home-${width}.png`;
    await page.screenshot({ path: `${dir}/${homePng}` });
    meta.push({ png: homePng, page: 'home', ...(await viewport()) });

    // Planner at the same viewport.
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);
    await expect(firstBookingChoice(page)).toBeVisible();
    await fontsReady();
    await expectFirstStepFinal(page);
    await page.mouse.move(0, 0);
    const plannerPng = `final-planner-${width}.png`;
    await page.screenshot({ path: `${dir}/${plannerPng}` });
    meta.push({ png: plannerPng, page: 'planner', ...(await viewport()),
      samples: await contrastSamples(page, plannerPng, 'normal'),
      fonts: await fontSamples(page) });

    if (width !== 390) continue;

    // Selected: pick "Nothing booked yet" the way a visitor does, then bring Continue into view.
    // QUADS order in WizardStep0Reservation: "nothing" is the first row.
    const nothingRow = bookingRows(page).first();
    await nothingRow.scrollIntoViewIfNeeded();
    await nothingRow.click();
    await expect(nothingRow).toHaveAttribute('aria-pressed', 'true');
    const cta = question(page).locator('.wizard-res-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeInViewport();
    await expect(nothingRow).toBeInViewport();
    await page.mouse.move(0, 0);
    const selectedPng = 'final-planner-390-selected.png';
    await page.screenshot({ path: `${dir}/${selectedPng}` });
    meta.push({ png: selectedPng, page: 'planner', ...(await viewport()),
      samples: await contrastSamples(page, selectedPng, 'selected-nothing'),
      fonts: await fontSamples(page) });
  }

  await writeFile(`${dir}/final-contrast-evidence.json`, JSON.stringify(meta, null, 2));
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});
