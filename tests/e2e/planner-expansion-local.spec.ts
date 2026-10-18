import { isAbsolute, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Planner steps 2-5 ("Night dossier") on the real page — local preview only.
 * Same isolation as planner-dope-local.spec.ts: every non-local request is
 * aborted, service workers are blocked and the local `/api/*` boundary
 * answers `{}`. The walk stops on the review step: the generate button is
 * never pressed, and any non-GET request fails the test.
 *
 * Captures every stage into EXPANSION_SCREENSHOT_DIR (required, absolute).
 * EXPANSION_VIDEO=1 records video (worker-scoped, so set at the top level);
 * run it with --grep '390 ko' for the one recorded walk.
 */

test.use({ serviceWorkers: 'block' });
test.use({
  video: process.env.EXPANSION_VIDEO === '1'
    ? { mode: 'on', size: { width: 390, height: 844 } }
    : 'off',
});

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
const SHOT_DIR = process.env.EXPANSION_SCREENSHOT_DIR || '';

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

  const plannerCalls: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.startsWith('/api/ai-planner')) plannerCalls.push(url.pathname);
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
  return { pageErrors, writes, plannerCalls };
}

/** Desktop opens the intro (innerWidth >= 768, 350ms after mount); close it as a visitor would. */
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

const currentStep = (page: Page) =>
  page.locator('.ec-steptick').evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-current') === 'step'));
const stage = (page: Page, name: string) => page.locator(`.wizard-stage--${name}`);
const next = (page: Page) => page.locator('.wizard-stage .ec-btn.ec-btn-primary').last();
const back = (page: Page) => page.locator('.wizard-stage .ec-btn.ec-btn-secondary').last();

/** Nothing pushes sideways; every control stays inside its step; options keep a 44px target. */
async function expectFits(page: Page) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const root = document.querySelector('.wizard-stage') as HTMLElement;
    const box = root.getBoundingClientRect();
    const outside = Array.from(root.querySelectorAll('button, input, textarea, select'))
      // A control inside its own horizontal scroller (the calendar) is reachable by scrolling it.
      .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('.overflow-x-auto'))
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.left < box.left - 1 || b.right > box.right + 1).length;
    const short = Array.from(root.querySelectorAll('.ec-option'))
      .filter((el) => (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().height < 44).length;
    return { page: doc.scrollWidth - doc.clientWidth, outside, short };
  });
  expect(r).toEqual({ page: 0, outside: 0, short: 0 });
}

/** Steps 3-5: cloud poster behind the header, one solid (opaque) outer plate, readable fields on it. */
async function expectPlate(page: Page) {
  const r = await page.evaluate(() => {
    const plate = getComputedStyle(document.querySelector('.planner-question')!);
    const poster = getComputedStyle(document.querySelector('.ec-planner')!, '::before').backgroundImage;
    return { poster, radius: plate.borderTopLeftRadius, bg: plate.backgroundColor };
  });
  expect(r.poster).toContain('v3-cloud-poster');
  expect(r.radius).toBe('22px');
  expect(r.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(r.bg).not.toMatch(/, 0\)$/);
}

async function capture(page: Page, label: string) {
  // Viewport capture of the stage itself: the question panel sits just under the
  // fixed header (a missing-field summary renders at the stage top, so it shows too).
  await page.evaluate(() => {
    const header = document.querySelector('header');
    const offset = (header?.getBoundingClientRect().height || 64) + 8;
    // `instant`: the page's smooth scroll-behavior would otherwise still be animating at capture time.
    const panel = document.querySelector('.planner-question');
    if (panel) window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - offset, behavior: 'instant' });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: join(SHOT_DIR, `${label}.png`) });
}

const CASES: { width: number; height: number; lang: Lang }[] = [];
// Full KO/EN/JA/ZH × 360/390/430/1024/1280/1440 matrix, plus the existing 768 ja tablet case.
for (const lang of ['ko', 'en', 'ja', 'zh'] as Lang[]) {
  CASES.push(
    { width: 360, height: 800, lang },
    { width: 390, height: 844, lang },
    { width: 430, height: 932, lang },
    { width: 1024, height: 768, lang },
    { width: 1280, height: 800, lang },
    { width: 1440, height: 1000, lang },
  );
}
CASES.push({ width: 768, height: 1024, lang: 'ja' });

for (const { width, height, lang } of CASES) {
  test(`steps 2-5 ${width} ${lang}: staged choices, gates, back keeps values, nothing overflows`, async ({ page }) => {
    expect(isAbsolute(SHOT_DIR), 'EXPANSION_SCREENSHOT_DIR must be an absolute path').toBe(true);
    const tag = `${width}-${lang}`;
    const { pageErrors, writes, plannerCalls } = await setupPage(page, lang);
    await page.setViewportSize({ width, height });
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);

    // Step 1 (approved first screen, not restyled here): "Nothing booked yet" is the first row.
    await page.locator('.wizard-res-row').first().click();
    await page.locator('.wizard-res-cta').click();

    // Step 2 — destination. Continue with nothing picked is held with a visible note.
    await expect(stage(page, 'dest')).toBeVisible();
    await expect.poll(() => currentStep(page)).toBe(1);
    await next(page).click();
    await expect(stage(page, 'dest').locator('.ec-error-note').first()).toBeVisible();
    await expect.poll(() => currentStep(page)).toBe(1);
    await capture(page, `${tag}-2-destination-missing`);
    // First quick-start preset: a city, its activities and a 3-day range.
    if (width < 768) {
      // Phone: the presets sit in the native Quick Start summary, collapsed by default.
      await stage(page, 'dest').locator('details.wizard-quick-start > summary').click();
    }
    await stage(page, 'dest').locator('.ec-option-sm').first().click();
    await expect(stage(page, 'dest').locator('.ec-option[aria-pressed="true"]')).not.toHaveCount(0);
    await expectFits(page);
    await capture(page, `${tag}-2-destination`);
    await next(page).click();

    // Step 3 — food. The dietary warning stays open; pick one food style.
    await expect(stage(page, 'food')).toBeVisible();
    await expect(stage(page, 'food').locator('.wizard-safety-note')).toBeVisible();
    const foodStyle = stage(page, 'food').locator('.grid > .ec-option').first();
    await foodStyle.click();
    await expect(foodStyle).toHaveAttribute('aria-pressed', 'true');
    if (width === 390 && lang === 'ko') {
      // Spice levels are content-sized, not full-width: the first two share a row.
      const spice = stage(page, 'food').locator('.wizard-spice-options > .ec-option');
      const row = (await stage(page, 'food').locator('.wizard-spice-options').boundingBox())!;
      const [a, b] = [(await spice.nth(0).boundingBox())!, (await spice.nth(1).boundingBox())!];
      expect(a.width).toBeLessThan(row.width * 0.6);
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    }
    await expectFits(page);
    await expectPlate(page);
    await capture(page, `${tag}-3-food`);
    await next(page).click();

    // Step 4 — details. No airport yet: Continue is held with a visible note.
    await expect(stage(page, 'details')).toBeVisible();
    await next(page).click();
    await expect(stage(page, 'details').locator('.ec-error-note').first()).toBeVisible();
    await expect.poll(() => currentStep(page)).toBe(3);
    await capture(page, `${tag}-4-details-missing`);
    const airport = stage(page, 'details').locator('[aria-haspopup="listbox"]').first();
    const placeholder = ((await airport.textContent()) || '').trim();
    await airport.click();
    await page.locator('[role="option"]:visible').first().click();
    await expect(airport).not.toHaveText(placeholder);
    const airportLabel = ((await airport.textContent()) || '').trim();
    await expectFits(page);
    await expectPlate(page);
    await capture(page, `${tag}-4-details`);
    await next(page).click();

    // Step 5 — review dossier. Stop here: the generate button is not pressed.
    await expect(stage(page, 'review')).toBeVisible();
    await expect.poll(() => currentStep(page)).toBe(4);
    await expect(stage(page, 'review').locator('.wizard-dossier-group')).toHaveCount(4);
    await expect(stage(page, 'review').locator('.wizard-review-cta .ec-btn-primary')).toBeEnabled();
    await expectFits(page);
    await expectPlate(page);
    await capture(page, `${tag}-5-review`);

    if (width === 390 && lang === 'ko') {
      // Real keyboard focus + >= 44px targets per stage, then reduced-motion entrance check.
      const focusCheck = async (target: ReturnType<Page['locator']>) => {
        await target.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(target).toBeFocused();
        const s = await target.evaluate((el) => ({ fv: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) > 0, shadow: getComputedStyle(el).boxShadow !== 'none', h: el.getBoundingClientRect().height }));
        expect(s.fv).toBe(true);
        expect(s.outline || s.shadow).toBe(true);
        expect(s.h).toBeGreaterThanOrEqual(44);
      };
      const reviewCta = stage(page, 'review').locator('.wizard-review-cta .ec-btn-primary');
      await focusCheck(reviewCta);
      expect((await back(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await back(page).click();
      await focusCheck(stage(page, 'details').locator('[aria-haspopup="listbox"]').first());
      await focusCheck(next(page));
      await back(page).click();
      await focusCheck(stage(page, 'food').locator('.grid > .ec-option').first());
      await back(page).click();
      await focusCheck(stage(page, 'dest').locator('.wizard-city-grid > .ec-option').first());
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await next(page).click();
      for (const el of [stage(page, 'food').locator('.grid > .ec-option').first(), next(page)]) {
        const motion = await el.evaluate((node) => ({ running: node.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length, duration: Math.max(...getComputedStyle(node).transitionDuration.split(',').map((d) => parseFloat(d) || 0)) }));
        expect(motion.running).toBe(0);
        expect(motion.duration).toBeLessThanOrEqual(0.01);
      }
      await page.emulateMedia({ reducedMotion: null });
      // Return to review so the existing back-keeps-values walk below is unchanged.
      await next(page).click();
      await next(page).click();
      await expect.poll(() => currentStep(page)).toBe(4);
    }

    // Back keeps every value: airport, food style, destination picks.
    await back(page).click();
    await expect.poll(() => currentStep(page)).toBe(3);
    await expect(stage(page, 'details').locator('[aria-haspopup="listbox"]').first()).toContainText(airportLabel);
    await back(page).click();
    await expect(stage(page, 'food').locator('.grid > .ec-option').first()).toHaveAttribute('aria-pressed', 'true');
    await back(page).click();
    await expect(stage(page, 'dest').locator('.ec-option[aria-pressed="true"]')).not.toHaveCount(0);

    expect(writes).toEqual([]);
    expect(plannerCalls).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test('step 2 frame holds while its lazy module is still loading', async ({ page }) => {
  const { pageErrors, writes, plannerCalls } = await setupPage(page, 'en');
  // Hold the real destination module (dev source or built chunk) at the same-origin
  // boundary; the idle preload and the Next click share this one request.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held!: () => void;
  const seen = new Promise<void>((resolve) => { held = resolve; });
  await page.route(/\/WizardStep0Destination[^/]*\.(tsx|js)(\?|$)/, async (route) => {
    held();
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);
    await page.locator('.wizard-res-row').first().click();
    await page.locator('.wizard-res-cta').click();
    await seen;

    // Spinner up, no stage yet: the compact frame is already on.
    await expect(page.locator('.wizard-step-viewport .animate-spin')).toBeVisible();
    await expect(page.locator('.wizard-stage')).toHaveCount(0);
    await expect(page.locator('.ec-steprail')).toHaveAttribute('aria-valuenow', '2');
    await expect(page.locator('.ec-steprail')).toBeHidden();
    await expect(page.locator('.planner-lede')).toBeHidden();
    await expect(page.locator('.ai-planner-pricing-note__full').first()).toBeHidden();
    await expect(page.locator('.ai-planner-pricing-note__short').first()).toBeVisible();
  } finally {
    release();
  }

  await expect(stage(page, 'dest')).toBeVisible();
  await expect.poll(() => currentStep(page)).toBe(1);
  await expect(page.locator('.ec-steprail')).toBeHidden();
  await expect(page.locator('.ai-planner-pricing-note__short').first()).toBeVisible();
  expect(writes).toEqual([]);
  expect(plannerCalls).toEqual([]);
  expect(pageErrors).toEqual([]);
});
