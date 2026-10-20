import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';
import { EXAMPLE_PLANS } from '../../src/data/example-plans';
import { naverMapDirectionsUrl } from '../../src/lib/naverMap';

type Language = 'ko' | 'en' | 'ja' | 'zh';

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1172, height: 900 },
  { width: 1440, height: 1000 },
] as const;
const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
// From HomeCopy.specimen.sampleBadge.
const SAMPLE_BADGE: Record<Language, string> = { en: 'Sample', ko: '예시', ja: 'サンプル', zh: '示例' };
// From locales nav.navigation (Header menu toggle and dialog aria-label). en only is used below.
const MENU_LABEL_EN = 'Navigation';
const BOTTOM_NAV_HREFS = ['/', '/tours', '/planner', '/map', '/my-plans', '/mypage'];
// HOME_CITIES order, then the "other cities" link.
const CITY_HREFS = [
  '/planner?prefillRegions=seoul',
  '/planner?prefillRegions=busan',
  '/planner?prefillRegions=jeju',
  '/planner?prefillRegions=gyeongju',
  '/planner?prefillRegions=gangneung',
  '/planner',
];
const HERO_POSTER_SRC = '/home-dope/v3-cloud-poster.jpg';
const HERO_VIDEO_SRC = '/home-dope/v3-cloud-flight.mp4';
const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');

/** Consent, promo and language are set before app code runs; every request is routed. */
async function setupPage(page: Page, lang: Language) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');

  await page.addInitScript(
    ({ origin, lang: language }) => {
      if (window.location.origin !== origin) throw new Error('origin mismatch');
      localStorage.setItem('cocotrip_lang', language);
      localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
      localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    },
    { origin: BASE.origin, lang },
  );

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  const pageErrors: string[] = [];
  const localFailures: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === BASE.origin && response.status() >= 400 && !url.pathname.startsWith('/api/')) {
      localFailures.push(`${response.status()} ${url.pathname}`);
    }
  });
  return { pageErrors, localFailures };
}

async function gotoHome(page: Page, path = '/') {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.home-dope')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function assertLayout(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Visible text geometry, not h1 scrollHeight: the line box is taller than the glyph ink, so scrollHeight false-positives.
  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const h1 = document.querySelector('h1');
    const copy = document.querySelector('.home-dope-hero__copy');
    const pass = document.querySelector('.home-dope-pass');
    // First rendered primary CTA in the hero: the pass's on tablet/desktop, the lede's on phones (pass hidden).
    const isRendered = (el: Element) => el.getClientRects().length > 0;
    const primary = Array.from(document.querySelectorAll('.home-dope-hero .home-dope-btn--primary')).find(isRendered);
    if (!h1 || !copy || !pass || !primary) throw new Error('home layout landmarks missing');

    // v3 phone entries (pass hidden below 768px): must be fully in view and hit-testable.
    const entry = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || !isRendered(el)) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        href: el.getAttribute('href'),
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        hit: !!hit && (hit === el || el.contains(hit)),
      };
    };

    // Nearest ancestor that clips its overflow; falls back to the viewport.
    let clip: Element | null = h1.parentElement;
    while (clip) {
      const style = getComputedStyle(clip);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') break;
      clip = clip.parentElement;
    }
    const clipBox = clip ? clip.getBoundingClientRect() : new DOMRect(0, 0, viewportWidth, window.innerHeight);

    const range = document.createRange();
    range.selectNodeContents(h1);
    const textRects = Array.from(range.getClientRects()).map((r) => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    }));

    const toX = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    };
    return {
      viewportWidth,
      viewportHeight: window.innerHeight,
      phone: window.innerWidth < 768,
      passRendered: isRendered(pass),
      planner: entry('.home-dope-hero__cta .home-dope-btn--primary'),
      sample: entry('.home-dope-play'),
      clipBox: { left: clipBox.left, right: clipBox.right, top: clipBox.top, bottom: clipBox.bottom },
      textRects,
      copy: toX(copy),
      pass: toX(pass),
      primary: toX(primary),
      passButtons: Array.from(pass.querySelectorAll('.home-dope-btn, button')).filter(isRendered).map(toX),
      passHeight: pass.getBoundingClientRect().height,
      passText: (pass as HTMLElement).innerText.trim(),
    };
  });

  for (const r of geometry.textRects) {
    expect(r.left).toBeGreaterThanOrEqual(geometry.clipBox.left - 1);
    expect(r.right).toBeLessThanOrEqual(geometry.clipBox.right + 1);
    expect(r.top).toBeGreaterThanOrEqual(geometry.clipBox.top - 1);
    expect(r.bottom).toBeLessThanOrEqual(geometry.clipBox.bottom + 1);
    expect(r.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  }
  for (const box of [geometry.copy, geometry.primary]) {
    expect(box.left).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  }

  if (geometry.phone) {
    // v3 phone contract: the pass is hidden; planner CTA and sample link carry the first fold.
    expect(geometry.passRendered).toBe(false);
    expect(geometry.planner?.href).toBe('/planner');
    expect(geometry.sample?.href).toBe('#sample-day');
    for (const box of [geometry.planner!, geometry.sample!]) {
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(box.top).toBeGreaterThanOrEqual(-1);
      expect(box.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      expect(box.hit).toBe(true);
    }
    return;
  }

  // Tablet/desktop: the pass is visible, inside the viewport, with real content and contained buttons.
  expect(geometry.passRendered).toBe(true);
  expect(geometry.pass.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.pass.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.passHeight).toBeGreaterThanOrEqual(56);
  expect(geometry.passText.length).toBeGreaterThan(4);
  expect(geometry.passButtons.length).toBeGreaterThan(0);
  for (const button of geometry.passButtons) {
    expect(button.left).toBeGreaterThanOrEqual(geometry.pass.left - 1);
    expect(button.right).toBeLessThanOrEqual(geometry.pass.right + 1);
  }
}

async function assertItineraryCard(page: Page) {
  // Lower itinerary card: v3 translucent tint over the dark #sample-day surface, never the white light-theme alias.
  const card = page.locator('.home-dope .ec-card').first();
  await expect(card).toBeAttached();
  const style = await card.evaluate((el) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
      return { r: +r, g: +g, b: +b, a: +a };
    };
    const lum = (c: { r: number; g: number; b: number }) => {
      const ch = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    };
    const s = getComputedStyle(el);
    // First opaque ancestor colour is the surface the tint actually sits on.
    let under: { r: number; g: number; b: number; a: number } | null = null;
    for (let n = el.parentElement; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a >= 0.99) {
        under = c;
        break;
      }
    }
    return {
      background: s.backgroundColor,
      inSampleDay: !!el.closest('#sample-day'),
      underLum: under ? lum(under) : null,
      textLum: lum(parse(s.color)!),
    };
  });
  expect(style.background).toBe('rgba(255, 255, 255, 0.06)');
  expect(style.background).not.toBe('rgb(255, 255, 255)');
  expect(style.inSampleDay).toBe(true);
  expect(style.underLum).not.toBeNull();
  // Dark underlying surface; the 6% white tint keeps it dark, so card text stays readable.
  expect(style.underLum!).toBeLessThan(0.05);
  const tinted = style.underLum! * 0.94 + 0.06;
  expect((style.textLum + 0.05) / (tinted + 0.05)).toBeGreaterThanOrEqual(4.5);
}

async function assertHeroPhotoLoaded(page: Page) {
  // v3: the poster still is the sky background (the video, when allowed, sits on top).
  const sky = page.locator('.home-dope-sky');
  await expect
    .poll(() => sky.evaluate((el) => getComputedStyle(el).backgroundImage))
    .toContain(HERO_POSTER_SRC);
  await expect
    .poll(() =>
      page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode().catch(() => undefined);
        return img.naturalWidth > 0;
      }, HERO_POSTER_SRC))
    .toBe(true);
}

async function assertChrome(page: Page) {
  const headerBg = await page
    .locator('header.home-dope-chrome')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(['rgba(0, 0, 0, 0)', 'transparent', 'rgb(255, 255, 255)']).not.toContain(headerBg);

  const cardBg = await page.locator('.home-dope-pass').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(cardBg).not.toBe('rgb(255, 255, 255)');
}

async function assertCityLinks(page: Page) {
  const hrefs = await page
    .locator('.home-dope-rail__list a')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  expect(hrefs).toEqual(CITY_HREFS);
}

async function assertHeroCta(page: Page, viewportHeight: number) {
  // First visible primary CTA in the hero (phones: under the lede, the pass is hidden).
  const cta = page.locator('.home-dope-hero .home-dope-btn--primary:visible').first();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '/planner');
  const box = await cta.boundingBox();
  if (!box) throw new Error('primary CTA has no bounding box');
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight - 56);
}

async function assertBottomNav(page: Page) {
  const links = page.locator('.mobile-bottom-nav a');
  await expect(links).toHaveCount(BOTTOM_NAV_HREFS.length);
  const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  expect(hrefs).toEqual(BOTTOM_NAV_HREFS);
  for (let i = 0; i < BOTTOM_NAV_HREFS.length; i++) {
    await expect(links.nth(i)).toBeVisible();
    const box = await links.nth(i).boundingBox();
    expect(box?.height || 0).toBeGreaterThanOrEqual(44);
  }
}

async function assertDesktopHeader(page: Page) {
  // Attribute-based selectors: their labels change per language.
  const header = page.locator('header.home-dope-chrome').first();
  const controls = [
    header.locator('button[title*="⌘K"]'),
    header.locator('button[aria-label*=" · "]'),
    header.locator('a[href^="https://wa.me/"]'),
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box?.height || 0).toBeGreaterThanOrEqual(44);
  }
}

async function maybeScreenshot(page: Page, name: string, fullPage = false) {
  const dir = process.env.HOME_DOPE_SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

for (const language of LANGUAGES) {
  test(`${language} home renders at all five widths`, async ({ page }) => {
    test.setTimeout(120_000);
    const { pageErrors, localFailures } = await setupPage(page, language);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await gotoHome(page);

      await expect(page.locator('.home-dope-sample').first()).toHaveText(SAMPLE_BADGE[language]);
      await assertLayout(page);
      await assertHeroPhotoLoaded(page);
      await assertChrome(page);
      await assertCityLinks(page);
      await assertItineraryCard(page);
      if (viewport.width === 390) {
        await assertHeroCta(page, viewport.height);
        await assertBottomNav(page);
      }
      if (viewport.width >= 1024) await assertDesktopHeader(page);

      await maybeScreenshot(page, `${language}-${viewport.width}`);
      const fullPage = (language === 'en' && viewport.width === 1440) || (language === 'ko' && viewport.width === 390);
      if (fullPage) await maybeScreenshot(page, `${language}-${viewport.width}-full`, true);
    }

    expect(pageErrors).toEqual([]);
    expect(localFailures).toEqual([]);
  });
}

test('390px mobile menu opens, closes on Escape, and restores focus', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);

  const toggle = page.locator('header.home-dope-chrome').getByRole('button', { name: MENU_LABEL_EN, exact: true });
  await expect(toggle).toBeVisible();
  const box = await toggle.boundingBox();
  expect(box?.height || 0).toBeGreaterThanOrEqual(44);

  await toggle.click();
  const dialog = page.getByRole('dialog', { name: MENU_LABEL_EN, exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();

  expect(pageErrors).toEqual([]);
});

test('390 open chat is hidden under the open menu, keeps menu focus, and is still open after Escape', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);

  const chatTrigger = page.locator('button.home-dope-chat-trigger');
  const chatPanel = page.locator('#chat-widget-panel');
  await expect(chatTrigger).toHaveAttribute('aria-label', 'Open chat');
  await expect(chatTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(chatTrigger).toHaveAttribute('aria-controls', 'chat-widget-panel');
  const chatBox = await chatTrigger.boundingBox();
  expect(chatBox?.width || 0).toBeGreaterThanOrEqual(44);
  expect(chatBox?.height || 0).toBeGreaterThanOrEqual(44);

  await chatTrigger.click();
  await expect(chatPanel).toBeVisible();
  await expect(chatTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(chatTrigger).toHaveAttribute('aria-label', 'Close');

  // Open the menu inside the chat's 100ms input-focus timeout: focus must stay in the menu.
  const toggle = page.locator('header.home-dope-chrome').getByRole('button', { name: MENU_LABEL_EN, exact: true });
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: MENU_LABEL_EN, exact: true });
  await expect(dialog).toBeVisible();
  await expect(chatTrigger).toBeHidden();
  await expect(chatPanel).toBeHidden();
  expect(await chatPanel.evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
  await page.waitForTimeout(300);
  expect(await dialog.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(chatPanel).toBeVisible();
  await expect(chatTrigger).toBeVisible();
  await expect(chatTrigger).toHaveAttribute('aria-expanded', 'true');

  await chatTrigger.click();
  await expect(chatPanel).toBeHidden();
  await expect(chatTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(chatTrigger).toHaveAttribute('aria-label', 'Open chat');

  expect(pageErrors).toEqual([]);
});

for (const width of [768, 1024, 1172]) {
  test(`${width}px compact header opens the full menu, reaches every nav link, and closes on Escape`, async ({ page }) => {
    const { pageErrors } = await setupPage(page, 'en');
    await page.setViewportSize({ width, height: 900 });
    await gotoHome(page);

    const header = page.locator('header.home-dope-chrome').first();
    await expect(header.locator('nav')).toHaveCount(0);
    if (width >= 1024) await assertDesktopHeader(page);

    // The hamburger is the only header button with aria-expanded and no aria-haspopup
    // (Radix dropdown triggers carry aria-haspopup). Its label flips to "Close menu" when open.
    const toggle = header.locator('button[aria-expanded]:not([aria-haspopup])');
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box?.height || 0).toBeGreaterThanOrEqual(44);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const dialog = page.getByRole('dialog', { name: MENU_LABEL_EN, exact: true });
    await expect(dialog).toBeVisible();
    for (const href of ['/charter', '/tours', '/planner', '/community', '/about', '/mypage']) {
      await expect(dialog.locator(`a[href="${href}"]`).first()).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    if (width === 1024) {
      // Resizing out of the compact layout must drop the lock and the open flag;
      // resizing back must not reopen the menu.
      await toggle.click();
      await expect(dialog).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(dialog).toBeHidden();
      await expect(page.locator('body')).not.toHaveCSS('position', 'fixed');
      await page.setViewportSize({ width: 1024, height: 900 });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog).toBeHidden();
    }

    expect(pageErrors).toEqual([]);
  });
}

test('#sample-day link scrolls the specimen into view', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 768, height: 1024 });
  await gotoHome(page);

  await page.locator('.home-dope-pass a[href="#sample-day"]').click();
  await expect(page.locator('#sample-day')).toBeInViewport();
  expect(page.url()).toContain('#sample-day');

  expect(pageErrors).toEqual([]);
});

test('/#regions shows the region section with nine region links', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'ko');
  await page.setViewportSize({ width: 1024, height: 900 });
  await gotoHome(page, '/#regions');

  await expect(page.locator('#regions')).toBeInViewport();
  await expect(page.locator('#regions a[href^="/region/"]')).toHaveCount(9);

  expect(pageErrors).toEqual([]);
});

test('Seoul city link opens /planner with the Seoul prefill', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 768, height: 1024 });
  await gotoHome(page);

  await page.locator('.home-dope-rail__list a[href="/planner?prefillRegions=seoul"]').click();
  await page.waitForURL(/\/planner\?prefillRegions=seoul/, { timeout: 5000 });

  expect(pageErrors).toEqual([]);
});

test('prefers-reduced-motion zeroes home button transitions and animations', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHome(page);

  // Every button is still measured below; the first in DOM is the phone-only CTA (display: none at 1440).
  const buttons = page.locator('.home-dope-btn');
  await expect(page.locator('.home-dope-btn:visible').first()).toBeVisible();
  const timings = await buttons.evaluateAll((els) =>
    els.map((el) => ({
      transition: getComputedStyle(el).transitionDuration,
      animation: getComputedStyle(el).animationDuration,
    })),
  );
  expect(timings.length).toBeGreaterThan(0);
  for (const { transition, animation } of timings) {
    expect(transition).toMatch(/^0s(, 0s)*$/);
    expect(animation).toMatch(/^0s(, 0s)*$/);
  }

  expect(pageErrors).toEqual([]);
});

test('/tours after home has no home-dope chrome', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);

  // :visible picks the desktop header link, not the hidden bottom-nav copy.
  await page.locator('a[href="/tours"]:visible').first().click();
  await page.waitForURL(/\/tours$/);

  await expect(page.locator('.home-dope')).toHaveCount(0);
  await expect(page.locator('.home-dope-chrome')).toHaveCount(0);
  await expect(page.locator('footer[class*="home-dope"]')).toHaveCount(0);
  await expect(page.locator('.mobile-bottom-nav')).not.toHaveClass(/home-dope-chrome/);
  const headerClass = await page.locator('header').first().getAttribute('class');
  expect(headerClass).not.toContain('home-dope-chrome');
  // Shared v3 night tokens follow the customer route (src/lib/customerNight.ts).
  await expect(page.locator('div.ec-night')).toHaveCount(1);

  expect(pageErrors).toEqual([]);
});

// ── Motion (Fable §8). Polls observe real state; no blind sleeps decide a result. ──


test('1440 h1 is four v3 lines: upright "Your", italic "next", Inter middle, italic "for you."', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  const h1 = page.locator('h1');
  await expect(h1).toHaveAttribute('aria-label', 'Your next Korea trip, planned for you.');
  const lines = page.locator('.home-dope-h1__line');
  await expect(lines).toHaveCount(4);
  // Line 4 scrambles in on mount; wait for the settled text.
  await expect(lines.nth(3).locator('.home-dope-scramble__live')).toHaveText('for you.');

  const segs = await lines.evaluateAll((els) =>
    els.map((l) =>
      Array.from(l.querySelectorAll(':scope > .is-serif, :scope > .is-sans')).map((s) => {
        const cs = getComputedStyle(s);
        // Scrambled segments carry a sizing ghost + live copy; read the live one.
        const live = s.querySelector('.home-dope-scramble__live');
        const text = live ? (s.textContent || '').replace(live.parentElement!.textContent || '', live.textContent || '') : s.textContent;
        return { text, family: cs.fontFamily, style: cs.fontStyle };
      }),
    ),
  );
  expect(segs.map((l) => l.map((s) => s.text).join(''))).toEqual(['Your next ', 'Korea trip, ', 'planned ', 'for you.']);
  expect(segs[0][0]).toMatchObject({ text: 'Your ', style: 'normal' });
  expect(segs[0][1]).toMatchObject({ text: 'next ', style: 'italic' });
  expect(segs[0][0].family).toContain('V3 Serif');
  expect(segs[3][0].family).toContain('V3 Serif');
  expect(segs[3][0].style).toBe('italic');
  for (const s of [segs[1][0], segs[2][0]]) {
    expect(s.family).toContain('Inter');
    expect(s.family).not.toContain('V3 Serif');
    expect(s.style).toBe('normal');
  }

  // No clipped/ellipsised line, and the plane trail sits below line 4's glyphs.
  const geo = await lines.evaluateAll((els) => {
    const last = els[3];
    const range = document.createRange();
    range.selectNodeContents(last.querySelector('.is-serif')!);
    const ink = range.getBoundingClientRect();
    const trail = last.querySelector('.home-dope-trail__track')?.getBoundingClientRect();
    return {
      clipped: els.some((l) => getComputedStyle(l).textOverflow === 'ellipsis' || l.scrollWidth > l.clientWidth + 1),
      inkBottom: ink.bottom,
      // The dashed line is the track's bottom border.
      trailLine: trail ? trail.bottom : null,
    };
  });
  expect(geo.clipped).toBe(false);
  expect(geo.trailLine).not.toBeNull();
  expect(geo.trailLine!).toBeGreaterThanOrEqual(geo.inkBottom - 2);
  expect(pageErrors).toEqual([]);
});

test('1440 sample pass cycles on its own, pause holds it, CTA hrefs never change', async ({ page }) => {
  test.setTimeout(40_000);
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  const route = page.locator('.home-dope-pass__route');
  const hrefs = () => page.locator('.home-dope-pass__cta a').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  const before = await route.getAttribute('aria-label');
  expect(await hrefs()).toEqual(['/planner', '#sample-day']);
  await expect.poll(() => route.getAttribute('aria-label'), { timeout: 8000 }).not.toBe(before);
  expect(await hrefs()).toEqual(['/planner', '#sample-day']);

  const pause = page.locator('.home-dope-pass__pause');
  await pause.click();
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(5, 990);
  const held = await route.getAttribute('aria-label');
  const start = Date.now();
  // Observe for longer than one 5s cycle; any change fails immediately.
  await expect.poll(async () => {
    if ((await route.getAttribute('aria-label')) !== held) throw new Error('rotation advanced while paused');
    return Date.now() - start >= 6000;
  }, { timeout: 9000, intervals: [500] }).toBe(true);
  expect(await hrefs()).toEqual(['/planner', '#sample-day']);
  expect(pageErrors).toEqual([]);
});

for (const language of LANGUAGES) {
  test(`${language} 1440 pass: every sample plan keeps both CTAs inside the card and hit-testable`, async ({ page }) => {
    const { pageErrors } = await setupPage(page, language);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoHome(page);
    const pause = page.locator('.home-dope-pass__pause');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const dots = page.locator('.home-dope-pass__dot');
    await expect(dots).toHaveCount(3);
    const route = page.locator('.home-dope-pass__route');
    const labels = new Set<string | null>();

    for (let i = 0; i < 3; i += 1) {
      await dots.nth(i).click();
      await expect(dots.nth(i)).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('.home-dope-pass__stops li')).toHaveCount(3);
      labels.add(await route.getAttribute('aria-label'));

      const fit = await page.evaluate(() => {
        const pass = document.querySelector('.home-dope-pass')!.getBoundingClientRect();
        return Array.from(document.querySelectorAll<HTMLElement>('.home-dope-pass__cta a')).map((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            top: r.top - pass.top,
            bottom: pass.bottom - r.bottom,
            left: r.left - pass.left,
            right: pass.right - r.right,
            hit: !!hit && (hit === el || el.contains(hit)),
          };
        });
      });
      expect(fit).toHaveLength(2);
      for (const box of fit) {
        expect(box, `plan ${i + 1}`).toMatchObject({ hit: true });
        for (const edge of [box.top, box.bottom, box.left, box.right]) expect(edge).toBeGreaterThanOrEqual(0);
      }
      await page.mouse.move(5, 990);
    }

    expect(labels.size).toBe(3);
    if (language === 'en') {
      const shots = process.env.ROLLOUT_DIR ?? 'test-results';
      await page.screenshot({ path: `${shots}/home-pc-fit.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${shots}/home-phone-fit.png` });
    }
    expect(pageErrors).toEqual([]);
  });
}

test('1440 sky requests the local v3 cloud video over the poster (v3)', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const videoRequest = page.waitForRequest((req) => new URL(req.url()).pathname === HERO_VIDEO_SRC);
  await gotoHome(page);
  // Local, same-origin file only. Codec support varies by browser build, so the
  // element may remove itself on error — the poster background is the fallback.
  expect(new URL((await videoRequest).url()).origin).toBe(BASE.origin);
  await assertHeroPhotoLoaded(page);
  await maybeScreenshot(page, 'motion-sky-t0');
  expect(pageErrors).toEqual([]);
});

test('reduced motion: static sky, no video, static row titles, all service and tour links visible', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHome(page);
  await expect(page.locator('.home-dope video')).toHaveCount(0);
  const running = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === 'running' && (a as CSSAnimation).animationName).length);
  expect(running).toBe(0);
  // Home A: service rows show their real titles immediately (no glyph resolve).
  await expect(page.locator('.home-dope-row__live')).toHaveText(['PLANNER', 'TOURS', 'CHARTER']);
  await expect(page.locator('#sample-day h2 .home-dope-split__word').first()).toHaveCSS('opacity', '1');
  // 3 rows + "Browse tours" + 3 tour cards.
  const links = page.locator('.home-dope-rows a, .home-dope-proof a');
  expect(await links.count()).toBe(7);
  for (let i = 0; i < 7; i++) {
    // Center it: edge alignment leaves sub-pixel clipping that is not a layout fault.
    await links.nth(i).evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    await expect(links.nth(i)).toBeInViewport({ ratio: 1 });
  }
  expect(pageErrors).toEqual([]);
});

test('1440 service rows: normal flow, 112px rows, keyboard focus resolves titles, Enter routes', async ({ page }) => {
  test.setTimeout(60_000);
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);

  // Home A replaced the 300vh pinned story: rows are short, nothing is sticky.
  const section = page.locator('.home-dope-rows');
  expect(await section.evaluate((el) => el.offsetHeight)).toBeLessThan(1000);
  const rows = page.locator('.home-dope-row');
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual(['/planner', '/tours', '/charter']);
  for (const box of await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
    expect(box).toBeGreaterThanOrEqual(112);
  }
  // Accessible name is the real title + description, never glyphs.
  await expect(rows.nth(2)).toHaveAccessibleName(/^CHARTER\s*Private vehicle and airport pickup$/);

  // Keyboard: focus each row; the visible title ends on the real word.
  const titles = ['PLANNER', 'TOURS', 'CHARTER'];
  for (let i = 0; i < 3; i++) {
    await rows.nth(i).focus();
    await expect(rows.nth(i)).toBeInViewport();
    await expect(rows.nth(i).locator('.home-dope-row__live')).toHaveText(titles[i]);
  }

  // Tour strip: three real tours with prices, conditions visible, details named.
  expect(await page.locator('.home-dope-proof__card').count()).toBe(3);
  const prices = await page.locator('.home-dope-price').allTextContents();
  expect(prices).toHaveLength(3);
  await expect(page.locator('.home-dope-conditions p')).toHaveCount(3);
  for (const p of await page.locator('.home-dope-conditions p').all()) await expect(p).toBeVisible();
  await expect(page.locator('.home-dope-details > summary')).toHaveText('What the plan is built from');

  // Same price strings under reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.home-dope-row').first()).toBeVisible();
  expect(await page.locator('.home-dope-price').allTextContents()).toEqual(prices);

  await page.locator('.home-dope-row[href="/charter"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/charter$/, { timeout: 5000 });
  expect(pageErrors).toEqual([]);
});

test('#sample-day: first sample visible at once, three region tabs switch the sheet and its map links', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  const section = page.locator('#sample-day');
  const tabs = section.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  const panel = section.getByRole('tabpanel');
  await expect(panel.locator('.ec-card')).toHaveCount(1);
  await expect(panel.locator('.ec-chip')).toHaveText(SAMPLE_BADGE.en);

  const mapHrefs = () => panel.locator('a[href^="https://www.google.com/maps/"]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('href') || ''));
  const seen = new Set<string>();
  const first = await mapHrefs();
  expect(first.length).toBeGreaterThan(0);
  seen.add(first.join('|'));

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  seen.add((await mapHrefs()).join('|'));
  // Arrow keys move selection and focus (roving tabindex).
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(2)).toBeFocused();
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  seen.add((await mapHrefs()).join('|'));
  expect(seen.size).toBe(3);
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  expect(pageErrors).toEqual([]);
});

test('motion unavailable (no IntersectionObserver): rows and sample heading stay final and readable', async ({ page }) => {
  await page.addInitScript(() => {
    // Simulates the effect layer failing; content must not depend on it.
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
  });
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  await expect(page.locator('.home-dope-row__live')).toHaveText(['PLANNER', 'TOURS', 'CHARTER']);
  // First-fold layout (viewport CTA / centre-hit checks) runs before scrolling to the lower home.
  await assertLayout(page);
  const heading = page.locator('#sample-day h2');
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toHaveAccessibleName('This is what a day looks like');
  for (const word of await heading.locator('.home-dope-split__word').all()) await expect(word).toHaveCSS('opacity', '1');
  expect(pageErrors).toEqual([]);
});

test('390 first fold: v3 h1 band, planner CTA + sample link in view, pass hidden, tabs/cities/regions intact', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  const h1Box = await page.locator('h1').boundingBox();
  if (!h1Box) throw new Error('missing h1 box');
  // v3 compact headline: four lines at ~48–54px.
  expect(h1Box.height).toBeGreaterThanOrEqual(176);
  expect(h1Box.height).toBeLessThanOrEqual(224);

  // v3 phone: the pass is hidden; both entries stay in the first fold.
  await expect(page.locator('.home-dope-pass-wrap')).toBeHidden();
  const planner = page.locator('.home-dope-hero__cta .home-dope-btn--primary');
  await expect(planner).toHaveAttribute('href', '/planner');
  await expect(planner).toBeInViewport({ ratio: 1 });
  const sample = page.locator('.home-dope-play');
  await expect(sample).toHaveAttribute('href', '#sample-day');
  await expect(sample).toBeInViewport({ ratio: 1 });
  await sample.click();
  await expect(page.locator('#sample-day')).toBeInViewport();
  await gotoHome(page);

  await assertBottomNav(page);
  await assertCityLinks(page);
  await gotoHome(page, '/#regions');
  await expect(page.locator('#regions')).toBeInViewport();
  expect(pageErrors).toEqual([]);
});

// ── 2026-10-07 browser annotations ──

test('annotations: #sample-day legs show exact prior → next stops, existing labels, and 2-endpoint transit links', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  const section = page.locator('#sample-day');
  const tabs = section.getByRole('tab');
  const panel = section.getByRole('tabpanel');
  // One sample/estimate note per sheet, above the list.
  await expect(panel.locator('.home-dope-leg-note')).toHaveCount(1);
  await expect(panel.locator('.home-dope-leg-note')).toContainText('not live');

  for (let p = 0; p < EXAMPLE_PLANS.length; p += 1) {
    await tabs.nth(p).click();
    await expect(tabs.nth(p)).toHaveAttribute('aria-selected', 'true');
    const plan = EXAMPLE_PLANS[p];
    const legs = plan.stops.flatMap((stop, i) => (i > 0 && stop.transit ? [{ prev: plan.stops[i - 1], stop }] : []));
    const rendered = panel.locator('.home-dope-leg');
    await expect(rendered).toHaveCount(legs.length);
    for (let l = 0; l < legs.length; l += 1) {
      const { prev, stop } = legs[l];
      const leg = rendered.nth(l);
      // Visible route = name, aria-hidden arrow, name; the sr-only dash is the accessible separator.
      const route = leg.locator('.home-dope-leg__route > span');
      await expect(route).toHaveCount(4);
      await expect(route.nth(0)).toHaveText(prev.name.en);
      await expect(route.nth(1)).toHaveAttribute('aria-hidden', 'true');
      await expect(route.nth(1)).toHaveText('→');
      await expect(route.nth(2)).toHaveClass(/\bsr-only\b/);
      await expect(route.nth(2)).toHaveText('–');
      await expect(route.nth(3)).toHaveText(stop.name.en);
      const label = leg.locator('.home-dope-leg__label');
      await expect(label).toContainText(stop.transit!.label.en);
      if (stop.transit!.mode === 'car') await expect(label).toContainText('by car');
      else await expect(label).not.toContainText('by car');

      const link = leg.locator('a.home-dope-leg__link');
      await expect(link).toHaveAttribute('href', naverMapDirectionsUrl(
        [{ lat: prev.lat, lng: prev.lng, name: prev.name.en }, { lat: stop.lat, lng: stop.lng, name: stop.name.en }],
        'transit',
      ));
      expect(await link.getAttribute('href')).toMatch(/\/-\/transit$/);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveAccessibleName(`Public transit directions from ${prev.name.en} to ${stop.name.en} (Naver Map, opens in a new tab)`);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }

  // Keyboard route unchanged: roving tabs, then Tab lands on the first stop's map pin.
  await tabs.nth(0).click();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press('Tab');
  const focusedHref = await page.evaluate(() => document.activeElement?.getAttribute('href') || '');
  expect(focusedHref.startsWith('https://www.google.com/maps/')).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('annotations: 390 transit legs wrap inside the viewport with 44px links', async ({ page }) => {
  await setupPage(page, 'ko');
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  const links = page.locator('#sample-day a.home-dope-leg__link');
  expect(await links.count()).toBeGreaterThan(0);
  await expect(links.first()).toHaveText(/대중교통 길찾기/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const height of await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
    expect(height).toBeGreaterThanOrEqual(44);
  }
});

const FOOTER_CONTACT_HREFS = ['tel:+821087140611', 'https://wa.me/821087140611', '/planner', '/tours', '/charter', '/guide'];
const FOOTER_LEGAL_HREFS = ['/about', '/terms', '/privacy', '/account-deletion', '/travel-terms'];

test('annotations: home footer info starts closed, opens by keyboard, keeps every contact link; legal stays outside', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  const footer = page.locator('footer.home-dope-chrome');
  const details = footer.locator('details.home-dope-footer-info');
  await expect(details).toHaveCount(1);
  expect(await details.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
  const summary = details.locator('summary');
  await expect(summary).toContainText('COCOTRIP');
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(footer.locator('a[href="tel:+821087140611"]')).toBeHidden();

  // Legal links + cookie settings are outside the fold, visible while closed.
  for (const href of FOOTER_LEGAL_HREFS) {
    await expect(footer.locator(`a[href="${href}"]`)).toBeVisible();
    await expect(details.locator(`a[href="${href}"]`)).toHaveCount(0);
  }

  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await details.evaluate((el: HTMLDetailsElement) => el.open)).toBe(true);
  for (const href of FOOTER_CONTACT_HREFS) {
    await expect(details.locator(`a[href="${href}"]`)).toBeVisible();
  }
  await expect(details.locator('a[href="https://wa.me/821087140611"]')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(pageErrors).toEqual([]);
});

test('annotations: non-home footer keeps the expanded layout with no fold', async ({ page }) => {
  await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  // /tours renders no Footer; /guide renders the shared sections/Footer.
  await page.goto('/guide', { waitUntil: 'domcontentloaded' });
  const footer = page.locator('footer').last();
  await expect(footer.locator('a[href="tel:+821087140611"]')).toBeVisible();
  await expect(footer.locator('details')).toHaveCount(0);
  for (const href of [...FOOTER_CONTACT_HREFS, ...FOOTER_LEGAL_HREFS]) {
    await expect(footer.locator(`a[href="${href}"]`)).toBeVisible();
  }
});

/** Waits until the sky video is decodable or has removed itself; true if it is still there. */
async function skyVideoPresent(page: Page) {
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>('.home-dope-sky__video');
    return !v || v.readyState >= 2;
  }, undefined, { timeout: 15000 });
  return page.evaluate(() => !!document.querySelector('.home-dope-sky__video'));
}

test('annotations: sky button plays and pauses the real video, label follows media state', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  const button = page.locator('.home-dope-sky-toggle');
  if (!(await skyVideoPresent(page))) {
    // Codec unsupported in this browser build: poster only, no dead control.
    await expect(button).toHaveCount(0);
    test.skip(true, 'sky video not decodable in this browser build');
  }
  // The control is outside the decorative aria-hidden sky.
  expect(await button.evaluate((el) => !!el.closest('[aria-hidden="true"]'))).toBe(false);
  const video = page.locator('.home-dope-sky__video');
  const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);
  const paused = () => video.evaluate((v: HTMLVideoElement) => v.paused);

  if (await paused()) {
    await expect(button).toHaveAccessibleName('Play sky video');
    await button.click();
  }
  await expect(button).toHaveAccessibleName('Pause sky video');
  const t0 = await time();
  await expect.poll(time, { timeout: 5000 }).toBeGreaterThan(t0);

  await button.click();
  await expect(button).toHaveAccessibleName('Play sky video');
  expect(await paused()).toBe(true);
  const held = await time();
  await page.waitForTimeout(600);
  expect(await time()).toBe(held);

  await button.press('Enter');
  await expect(button).toHaveAccessibleName('Pause sky video');
  await expect.poll(time, { timeout: 5000 }).toBeGreaterThan(held);
  expect(pageErrors).toEqual([]);
});

test('annotations: rejected play() leaves the sky paused and the button offering Play', async ({ page }) => {
  const { pageErrors } = await setupPage(page, 'en');
  // External boundary only: the browser refuses playback (autoplay attribute
  // ignored, play() rejected). The component itself is not stubbed.
  await page.addInitScript(() => {
    const setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name: string, value: string) {
      if (this instanceof HTMLMediaElement && name.toLowerCase() === 'autoplay') return;
      return setAttr.call(this, name, value);
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', { configurable: true, get: () => false, set: () => {} });
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    };
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  test.skip(!(await skyVideoPresent(page)), 'sky video not decodable in this browser build');
  const button = page.locator('.home-dope-sky-toggle');
  await expect(button).toHaveAccessibleName('Play sky video');
  await button.click();
  await page.waitForTimeout(300);
  await expect(button).toHaveAccessibleName('Play sky video');
  await expect(button).toHaveAttribute('data-state', 'paused');
  expect(await page.locator('.home-dope-sky__video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('annotations: failed sky video falls back to the poster with no control', async ({ page }) => {
  await setupPage(page, 'en');
  await page.route((url) => url.pathname === HERO_VIDEO_SRC, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoHome(page);
  await expect(page.locator('.home-dope-sky__video')).toHaveCount(0);
  await expect(page.locator('.home-dope-sky-toggle')).toHaveCount(0);
  expect(await page.locator('.home-dope-sky').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(HERO_POSTER_SRC);
});

for (const mode of ['reduced-motion', 'save-data'] as const) {
  test(`annotations: ${mode} renders the poster only, no video request, no sky control`, async ({ page }) => {
    await setupPage(page, 'en');
    if (mode === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    else {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) });
      });
    }
    let videoRequested = false;
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === HERO_VIDEO_SRC) videoRequested = true;
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoHome(page);
    await expect(page.locator('.home-dope-sky__video')).toHaveCount(0);
    await expect(page.locator('.home-dope-sky-toggle')).toHaveCount(0);
    expect(await page.locator('.home-dope-sky').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(HERO_POSTER_SRC);
    expect(videoRequested).toBe(false);
  });
}

// Menu content redesign (2026-10-07): same links/handlers, editorial layout on home.
const MENU_HREFS = [
  '/charter', '/tours', '/planner', '/community', '/about', '/mypage', '/my-plans',
  '/mypage?tab=bookings', '/mypage?tab=courses', '/mypage?tab=coupons', '/mypage?tab=wishlist',
  '/mypage?tab=history', 'https://wa.me/821087140611', 'mailto:help@cocotripkr.com',
  '/terms', '/privacy', '/travel-terms',
];
for (const language of LANGUAGES) {
  for (const width of [390, 1024]) {
    test(`${language} ${width} home menu keeps every link, 44px targets, 4 languages and no overflow`, async ({ page }) => {
      const { pageErrors } = await setupPage(page, language);
      await page.setViewportSize({ width, height: 900 });
      await gotoHome(page);
      await page.locator('header.home-dope-chrome button[aria-expanded]:not([aria-haspopup])').click();
      const dialog = page.locator('[role="dialog"].home-dope-menu');
      await expect(dialog).toBeVisible();

      for (const href of MENU_HREFS) await expect(dialog.locator(`a[href="${href}"]`).first()).toBeAttached();
      await expect(dialog.locator('button[aria-pressed]')).toHaveCount(4);
      await expect(dialog.locator('button[aria-pressed="true"]')).toHaveCount(1);

      const small = await dialog.evaluate((el) => [...el.querySelectorAll('a, button')]
        .map((n) => n.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.height < 44 || r.width < 44)).length);
      expect(small).toBe(0);
      expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      const offRight = await dialog.evaluate((el) => [...el.querySelectorAll('a, button, p')]
        .filter((n) => n.getBoundingClientRect().right > window.innerWidth + 0.5).length);
      expect(offRight).toBe(0);

      const main = (await dialog.locator('.home-dope-menu__main').boundingBox())!;
      const account = (await dialog.locator('.home-dope-menu__account').boundingBox())!;
      if (width >= 1024) expect(main.x + main.width).toBeLessThanOrEqual(account.x);
      else expect(account.y).toBeLessThan(main.y);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      expect(pageErrors).toEqual([]);
    });
  }
}

// Open chat panel redesign: no gradients, 44px controls, FAQ toggles, close/maximize route; never sends.
for (const width of [390, 1024]) {
  test(`${width} open home chat: no gradients, 44px controls, FAQ toggle, input fits, close + maximize without sending`, async ({ page }) => {
    const { pageErrors } = await setupPage(page, 'en');
    const sends: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname.startsWith('/api/chat')) sends.push(req.url());
    });
    await page.setViewportSize({ width, height: 844 });
    await gotoHome(page);

    const trigger = page.locator('button.home-dope-chat-trigger');
    const panel = page.locator('#chat-widget-panel');
    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/home-dope-chat-panel/);

    const gradients = await panel.evaluate((el) => [el, ...el.querySelectorAll('*')]
      .filter((n) => getComputedStyle(n).backgroundImage.includes('gradient')).length);
    expect(gradients).toBe(0);

    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(56);

    const expand = panel.getByRole('button', { name: 'Open full screen assistant' });
    const close = panel.getByRole('button', { name: 'Close chat' });
    const faq = panel.getByRole('button', { name: 'Open FAQ' });
    const send = panel.getByRole('button', { name: 'Send' });
    const wa = panel.locator('a[href="https://wa.me/821087140611"]');
    for (const target of [expand, close, faq, send, wa]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(send).toBeDisabled();

    const input = panel.locator('input');
    const ib = (await input.boundingBox())!;
    expect(ib.width).toBeGreaterThan(120);
    expect(ib.x + ib.width).toBeLessThanOrEqual(box.x + box.width);
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');

    await faq.click();
    const faqPanel = panel.locator('.home-dope-chat__faq');
    await expect(faqPanel).toBeVisible();
    const shortFaq = await faqPanel.evaluate((el) => [...el.querySelectorAll('button')]
      .filter((n) => n.getBoundingClientRect().height < 44).length);
    expect(shortFaq).toBe(0);
    await faq.click();
    await expect(faqPanel).toBeHidden();

    await close.click();
    await expect(panel).toBeHidden();
    await trigger.click();
    await expect(panel).toBeVisible();
    await expand.click();
    await expect(page).toHaveURL(/\/assistant$/);

    expect(sends).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
