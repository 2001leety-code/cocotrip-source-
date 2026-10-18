import { mkdir } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Planner wizard — keyboard focus after a step change (local preview only).
 * Same isolation as planner-dope-local.spec.ts: service workers blocked, every
 * off-origin request aborted, local `/api/*` answers `{}`. Nothing is generated,
 * saved or paid for: any non-GET request or planner/generation API call fails
 * the test.
 */

test.use({ serviceWorkers: 'block', video: { mode: 'on', size: { width: 1280, height: 720 } } });

const LOCAL_BASE = 'http://127.0.0.1:5178';
const BASE = new URL(process.env.BASE_URL || LOCAL_BASE);

test.skip(process.env.BASE_URL !== LOCAL_BASE, `local-only spec: requires BASE_URL=${LOCAL_BASE}`);
const OUT = 'E:/ai에이젼시만들기/outputs/home-dope-local-20261007/local-ui-fixes-20261008/planner/screenshots';

async function setupPage(page: Page, seedSnapshot = false) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');

  await page.addInitScript(([origin, seed]) => {
    if (window.location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', 'en');
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    if (seed && !localStorage.getItem('cocotrip:wizard:planner')) {
      localStorage.setItem('cocotrip:wizard:planner', JSON.stringify({
        step: 2,
        ts: Date.now(),
        values: {
          reservationStatus: 'nothing', mainCity: 'Seoul', mainCityKey: 'seoul',
          extraCities: [], selectedActivities: ['food'], freeText: 'resume focus probe',
          dietPrefs: [], dietaryRestrictions: [], priceRange: 'Any', spiceLevel: 'medium',
          bucketDishes: [], paxInput: '2',
        },
      }));
    }
  }, [BASE.origin, seedSnapshot] as const);

  const offOrigin: string[] = [];
  const writes: string[] = [];
  const plannerApi: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin) {
      offOrigin.push(url.origin);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/')) {
      if (/plan|generat|preview|auth|pay|book|share/i.test(url.pathname)) plannerApi.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  page.on('request', (req) => {
    if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`);
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { writes, plannerApi, pageErrors, offOrigin };
}

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
const heading = (page: Page) => question(page).locator('h2').first();
// Step 1's CTA is `.wizard-res-cta`; later steps name it after the next step, so use the
// button right after Back.
const cta = (page: Page) => question(page).locator('.wizard-res-cta')
  .or(page.getByRole('button', { name: 'Back', exact: true }).first().locator('xpath=following-sibling::button[1]'));
const railStep = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Step ${n}:`) });

async function openPlanner(page: Page) {
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await expect(heading(page)).toBeVisible();
}

/** Keyboard-activate a button: focus it, press the key. */
async function press(page: Page, button: ReturnType<Page['locator']>, key: 'Enter' | 'Space') {
  await button.focus();
  await page.keyboard.press(key);
}

async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      tag: a?.tagName || '',
      inQuestion: !!a?.closest('.planner-question'),
      inRail: !!a?.closest('ol'),
      isHeading: a?.tagName === 'H2',
    };
  });
}

/** Measure (never scroll): the question heading / active control must sit below the fixed header and inside the viewport. */
async function expectVisibleBelowHeader(page: Page, testInfo: TestInfo, label: string, target: 'heading' | 'active') {
  const measure = () => page.evaluate((t) => {
    const q = document.querySelector('.planner-question');
    const el = t === 'heading' ? q?.querySelector('h2') : document.activeElement;
    const r = el?.getBoundingClientRect();
    const h = document.querySelector('header')?.getBoundingClientRect();
    return {
      found: !!el && !!q && q.contains(el),
      top: r ? r.top : Number.NaN, bottom: r ? r.bottom : Number.NaN, headerBottom: h ? h.bottom : Number.NaN,
      scrollY: window.scrollY, vw: window.innerWidth, vh: window.innerHeight,
    };
  }, target);
  const isVisible = (v: Awaited<ReturnType<typeof measure>>) => v.found && v.top >= v.headerBottom && v.bottom <= v.vh;
  // The heading focus lands after the lazy step chunk resolves and layout settles: poll the
  // same measurement (no scrolling) for a bounded window, then assert on the last reading.
  let m = await measure();
  for (let i = 0; i < 60 && !isVisible(m); i += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    m = await measure();
  }
  await page.screenshot({ path: testInfo.outputPath(`visibility-${label}.png`) });
  const msg = `${label}: ${JSON.stringify(m)}`;
  console.log(msg);
  expect(m.found, msg).toBe(true);
  expect(m.top, msg).toBeGreaterThanOrEqual(m.headerBottom);
  expect(m.bottom, msg).toBeLessThanOrEqual(m.vh);
}

/** After the heading has focus, one Tab must land on a control of that step (not rail / body). */
async function expectTabEntersStep(page: Page, testInfo?: TestInfo, label = '') {
  await page.keyboard.press('Tab');
  const f = await focusInfo(page);
  expect(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']).toContain(f.tag);
  expect(f.inQuestion).toBe(true);
  expect(f.inRail).toBe(false);
  if (testInfo) await expectVisibleBelowHeader(page, testInfo, `${label}-tab`, 'active');
}

async function pickNothingBooked(page: Page) {
  await page.getByRole('button', { name: /Nothing booked yet/i }).first().click();
}

test.describe('planner wizard keyboard focus', () => {
  test('keyboard Enter and Space land on the new question; next Tab enters it; Back and step rail too', async ({ page }, testInfo) => {
    const net = await setupPage(page);
    await mkdir(OUT, { recursive: true });
    await openPlanner(page);

    // Initial entry: nothing steals focus.
    await expect(heading(page)).not.toBeFocused();
    await page.screenshot({ path: `${OUT}/01-initial-no-focus-steal.png` });

    await pickNothingBooked(page);
    await press(page, cta(page), 'Enter');
    await expect(railStep(page, 2)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeFocused();
    await expectVisibleBelowHeader(page, testInfo, 'step2', 'heading');
    await page.screenshot({ path: `${OUT}/02-enter-step2-heading-focused.png` });
    await expectTabEntersStep(page, testInfo, 'step2');
    await page.screenshot({ path: `${OUT}/03-tab-first-control-step2.png` });

    // Back (Enter) -> step 1 heading.
    await press(page, page.getByRole('button', { name: 'Back', exact: true }).first(), 'Enter');
    await expect(railStep(page, 1)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeFocused();
    await expectVisibleBelowHeader(page, testInfo, 'step1-back', 'heading');

    // Space advances too.
    await press(page, cta(page), 'Space');
    await expect(railStep(page, 2)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeFocused();

    // Fill step 2 by keyboard-reachable controls, continue to Food.
    const seoulCity = page.locator('.wizard-city-grid button[aria-pressed]').filter({ hasText: /^\s*Seoul/ }).first();
    await seoulCity.click();
    await expect(seoulCity).toHaveAttribute('aria-pressed', 'true');
    const firstActivity = page.locator('.wizard-pick-grid').first().locator('button[aria-pressed]').first();
    await firstActivity.click();
    await expect(firstActivity).toHaveAttribute('aria-pressed', 'true');
    await press(page, cta(page), 'Enter');
    await expect(railStep(page, 3)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeFocused();
    await expectVisibleBelowHeader(page, testInfo, 'step3', 'heading');
    await expectTabEntersStep(page, testInfo, 'step3');
    await page.screenshot({ path: `${OUT}/04-food-step-tab-control.png` });

    // Food -> Details (step 4): heading focus after a keyboard advance.
    await press(page, cta(page), 'Enter');
    await expect(railStep(page, 4)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeFocused();
    await expectVisibleBelowHeader(page, testInfo, 'step4', 'heading');
    await expectTabEntersStep(page, testInfo, 'step4');

    // Required travel dates (canGoStep3 needs a real range starting tomorrow or later): pick two enabled days in the calendar.
    const enabledDays = question(page).locator('.rdp-day button:enabled');
    await enabledDays.nth(0).click();
    await enabledDays.nth(2).click();
    await expect(question(page).getByText('Select date', { exact: true })).toHaveCount(0);

    // Required arrival airport, desktop sets it by keyboard (open the listbox, Tab to the first option, Enter); mobile taps/clicks the option.
    const airportTrigger = question(page).locator('button[aria-haspopup="listbox"]').first();
    if ((page.viewportSize()?.width || 1024) < 768) {
      // Mobile: this test isolates heading focus, so pick the airport with a real tap.
      await airportTrigger.click();
      await expect(airportTrigger).toHaveAttribute('aria-expanded', 'true');
      await page.locator('[role="option"]:visible', { hasText: 'ICN Terminal 1' }).first().click();
    } else {
      await press(page, airportTrigger, 'Enter');
      await expect(airportTrigger).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('option').first()).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await expect(airportTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(airportTrigger).not.toContainText(/Select airport/i);

    // Details -> Review (step 5). Never activate the Review action itself.
    await press(page, cta(page), 'Enter');
    await expect(railStep(page, 5)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeFocused();
    await expectVisibleBelowHeader(page, testInfo, 'step5', 'heading');

    // Step rail edit (reachable earlier step) by keyboard.
    await press(page, railStep(page, 1), 'Enter');
    await expect(railStep(page, 1)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeFocused();
    await expectVisibleBelowHeader(page, testInfo, 'step1-rail', 'heading');
    await page.screenshot({ path: `${OUT}/05-step-rail-edit-heading.png` });

    expect(net.writes).toEqual([]);
    expect(net.plannerApi).toEqual([]);
    expect(net.offOrigin.every((o) => o !== BASE.origin)).toBe(true);
    expect(net.pageErrors).toEqual([]);
  });

  test('invalid next stays put with its error and does not jump to a heading', async ({ page }) => {
    const net = await setupPage(page);
    await mkdir(OUT, { recursive: true });
    await openPlanner(page);

    // Step 1 invalid (nothing picked): stays, error shows.
    await press(page, cta(page), 'Enter');
    await expect(railStep(page, 1)).toHaveAttribute('aria-current', 'step');
    await expect(question(page).locator('[role="alert"]').first()).toBeVisible();
    await expect(heading(page)).not.toBeFocused();

    // Step 2 invalid (no city): same.
    await pickNothingBooked(page);
    await press(page, cta(page), 'Enter');
    await expect(heading(page)).toBeFocused();
    await press(page, cta(page), 'Enter');
    await expect(railStep(page, 2)).toHaveAttribute('aria-current', 'step');
    await expect(question(page).locator('[role="alert"]').first()).toBeVisible();
    await expect(heading(page)).not.toBeFocused();
    const f = await focusInfo(page);
    expect(f.tag).not.toBe('BODY');
    await page.screenshot({ path: `${OUT}/06-invalid-next-stays.png` });

    expect(net.writes).toEqual([]);
    expect(net.plannerApi).toEqual([]);
  });

  test('pointer advance does not steal focus programmatically', async ({ page }) => {
    const net = await setupPage(page);
    await openPlanner(page);
    await pickNothingBooked(page);
    await cta(page).click();
    await expect(railStep(page, 2)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeVisible();
    await expect(heading(page)).not.toBeFocused();
    await railStep(page, 1).click();
    await expect(railStep(page, 1)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).not.toBeFocused();
    expect(net.writes).toEqual([]);
    expect(net.plannerApi).toEqual([]);
  });

  test('automatic resume does not steal focus', async ({ page }) => {
    const net = await setupPage(page, true);
    await page.goto('/planner', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);
    const resume = page.getByRole('dialog').filter({ has: page.locator('#resume-wizard-title') });
    await expect(resume).toBeVisible();
    await expect(heading(page)).not.toBeFocused();
    await resume.getByRole('button').first().click();
    await expect(resume).toBeHidden();
    await expect(railStep(page, 3)).toHaveAttribute('aria-current', 'step');
    await expect(heading(page)).toBeVisible();
    await expect(heading(page)).not.toBeFocused();
    expect(net.writes).toEqual([]);
    expect(net.plannerApi).toEqual([]);
  });
});
