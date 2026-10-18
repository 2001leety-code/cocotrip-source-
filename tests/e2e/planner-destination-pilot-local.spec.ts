import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/**
 * Mobile destination-step pilot — local preview only (http://127.0.0.1:5178).
 * Same isolation as planner-expansion-local.spec.ts: service workers blocked,
 * off-origin requests aborted, local /api/* answers `{}`, any non-GET request
 * is logged and fails the test. The generate button is never pressed.
 */

test.use({ serviceWorkers: 'block' });
test.use({ video: { mode: 'on', size: { width: 390, height: 844 } } });

const LOCAL = process.env.BASE_URL === 'http://127.0.0.1:5178';
test.skip(!LOCAL, 'requires BASE_URL=http://127.0.0.1:5178');

const BASE = new URL('http://127.0.0.1:5178');
// The original before PNG/JSON live here and are only ever read (or written by the opt-in baseline test).
const BASELINE_DIR = 'E:/ai에이젼시만들기/outputs/home-dope-local-20261007/planner-mobile-dest-pilot-20261008/implementation/captures';
const OUT = process.env.PILOT_OUTPUT_DIR || BASELINE_DIR;

// Values embedded from the current baseline (after.priceNoteShort.text/style.fontSize, after.gridRect.y):
// E:/ai에이젼시만들기/outputs/home-dope-local-20261007/planner-destination-ticket-20261008/before/mobile-390-ko.json
// Embedded so the test has no runtime dependency on that external file. Older before artifacts are untouched.
const NEW_BASELINE_390_KO = {
  priceNoteText: '결제 전 1일차 일정 개요 무료',
  priceNoteFontSize: '14px',
  gridY: 464,
};

type Lang = 'en' | 'ko' | 'ja' | 'zh';

async function setupPage(page: Page, lang: Lang) {
  await page.addInitScript(([origin, l]) => {
    if (window.location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', l);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, [BASE.origin, lang]);

  const plannerCalls: string[] = [];
  const writes: string[] = [];
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/')) {
      if (/ai-planner|payment|book|save|auth/.test(url.pathname)) plannerCalls.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { pageErrors, writes, plannerCalls };
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

const stage = (page: Page) => page.locator('.wizard-stage--dest');
const next = (page: Page) => page.locator('.wizard-stage .ec-btn.ec-btn-primary').last();
const back = (page: Page) => page.locator('.wizard-stage .ec-btn.ec-btn-secondary').last();

async function openDestination(page: Page, lang: Lang, width: number, height: number) {
  const guards = await setupPage(page, lang);
  await page.setViewportSize({ width, height });
  await page.goto('/planner', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('.wizard-res-row').first().click();
  await page.locator('.wizard-res-cta').click();
  await expect(stage(page)).toBeVisible();
  return guards;
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const cs = (el: Element | null, keys: string[]) => {
      if (!el) return null;
      const s = getComputedStyle(el) as unknown as Record<string, string>;
      const out: Record<string, string> = {};
      keys.forEach((k) => { out[k] = s[k]; });
      return out;
    };
    const stageEl = document.querySelector('.wizard-stage--dest');
    const grid = stageEl?.querySelector('.wizard-city-grid') || null;
    const tile = grid?.querySelector('.ec-option') || null;
    const name = grid?.querySelector('.wizard-city-name') || null;
    const img = tile?.querySelector('img') || null;
    const h2 = stageEl?.querySelector('h2') || null;
    const header = document.querySelector('header');
    const cta = Array.from(document.querySelectorAll('.wizard-stage .ec-btn.ec-btn-primary')).pop() || null;
    const note = Array.from(document.querySelectorAll('.ai-planner-pricing-note__short')).find((e) => (e as HTMLElement).offsetParent !== null) || null;
    const preset = stageEl?.querySelector('.ec-option-sm') || null;
    const tiles = grid ? Array.from(grid.querySelectorAll('.ec-option')).map((e) => r(e)) : [];
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY },
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h2: { rect: r(h2), style: cs(h2, ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontFamily']), text: h2 ? h2.textContent : null },
      cityName: { rect: r(name), style: cs(name, ['fontSize', 'fontWeight', 'lineHeight']), text: name ? name.textContent : null },
      tileButton: { rect: r(tile), style: cs(tile, ['fontSize', 'fontWeight', 'minHeight', 'minWidth', 'paddingTop', 'paddingLeft', 'gap']) },
      tileMin: { minH: Math.min(...tiles.map((t) => (t ? t.h : 9999))), minW: Math.min(...tiles.map((t) => (t ? t.w : 9999))), count: tiles.length },
      tilePhoto: r(img),
      gridRect: r(grid),
      gridStyle: cs(grid, ['rowGap', 'columnGap']),
      presetFirst: { rect: r(preset), text: preset ? preset.textContent : null },
      cta: { rect: r(cta), visibleInViewport: cta ? cta.getBoundingClientRect().bottom <= window.innerHeight : false, text: cta ? cta.textContent : null },
      header: { rect: r(header), position: header ? getComputedStyle(header).position : null },
      priceNoteShort: { rect: r(note), style: cs(note, ['fontSize', 'fontWeight', 'lineHeight']), text: note ? note.textContent : null },
    };
  });
}

async function alignTop(page: Page) {
  // Capture alignment only (not navigation): the step is already reached through the UI.
  // Wait for fonts and the step-entry motion to settle, then pin to the top.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(async () => {
    const settled = () => document.getAnimations().every((a) => a.playState !== 'running' && a.playState !== 'pending');
    for (let i = 0; i < 120 && !settled(); i += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// Screenshot-only: settle, align, measure, capture, measure again; the two measures must agree.
async function settledCapture(page: Page, name: string, strict?: { width: number; height: number }) {
  mkdirSync(OUT, { recursive: true });
  await alignTop(page);
  // Target state: the destination step is up, the page top is in view, and the header,
  // progress indicator and question all sit inside the viewport (so the PNG must show them).
  // The pricing note now lives in the ticket below the cities; it is asserted separately
  // (scrolled into view) in the pricing and interaction tests.
  await expect(stage(page)).toBeVisible();
  const progress = page.locator('[aria-current="step"]:visible').first();
  await expect(progress).toBeVisible();
  const top = () => page.evaluate(() => {
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
    };
    const note = Array.from(document.querySelectorAll('.ai-planner-pricing-note__short')).find((e) => (e as HTMLElement).offsetParent !== null);
    return {
      scrollY: window.scrollY, docScrollTop: document.documentElement.scrollTop, vw: window.innerWidth, vh: window.innerHeight,
      header: box(document.querySelector('header')), note: box(note),
      progress: box(document.querySelector('[aria-current="step"]')), h2: box(document.querySelector('.wizard-stage--dest h2')),
    };
  });
  // Paint-ready: two frames after fonts/animations settled, then read the geometry that will be photographed.
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const topBefore = await top();
  const viewport = page.viewportSize()!;
  expect(topBefore.vw).toBe(viewport.width);
  expect(topBefore.vh).toBe(viewport.height);
  if (strict) {
    expect(topBefore.vw).toBe(strict.width);
    expect(topBefore.vh).toBe(strict.height);
  }
  expect(topBefore.scrollY).toBe(0);
  expect(topBefore.note, 'note').not.toBeNull();
  for (const part of ['header', 'progress', 'h2'] as const) {
    expect(topBefore[part], part).not.toBeNull();
    expect(topBefore[part]!.top, part).toBeGreaterThanOrEqual(0);
    expect(topBefore[part]!.bottom, part).toBeLessThanOrEqual(viewport.height);
  }
  const before = await measure(page);
  // `animations: 'disabled'` is capture-only: it finishes/cancels CSS animations for the shot.
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' });
  const after = await measure(page);
  const topAfter = await top();
  expect(before.viewport.scrollY).toBe(0);
  expect(after.viewport.scrollY).toBe(0);
  expect(topAfter).toEqual(topBefore);
  expect(after.h2.rect).toEqual(before.h2.rect);
  expect(after.gridRect).toEqual(before.gridRect);
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ before, after, topBefore, topAfter }));
  return after;
}

const quickStart = (page: Page) => stage(page).locator('details.wizard-quick-start');
const firstPreset = (page: Page) => stage(page).locator('.ec-option-sm').first();
const cityTiles = (page: Page) => stage(page).locator('.wizard-city-grid > .ec-option');

async function expectNoWrites(g: { writes: string[]; plannerCalls: string[]; pageErrors: string[] }) {
  expect(g.writes).toEqual([]);
  expect(g.plannerCalls).toEqual([]);
  expect(g.pageErrors).toEqual([]);
}

test('destination pilot after 390 KO capture', async ({ page }) => {
  const g = await openDestination(page, 'ko', 390, 844);
  const data = await settledCapture(page, 'final-after-390-ko', { width: 390, height: 844 });
  expect(data.docOverflowX).toBe(0);
  expect(data.viewport.scrollY).toBe(0);
  expect(data.h2.style?.fontSize).toBe('26px');
  expect(data.h2.style?.fontWeight).toBe('400');
  expect(data.cityName.style?.fontSize).toBe('15px');
  expect(data.tilePhoto?.w).toBe(52);
  expect(data.tileMin.minH).toBeGreaterThanOrEqual(70);
  expect(data.cta.rect?.h).toBeGreaterThanOrEqual(44);
  // City grid precedes Quick Start and the CTA in DOM order, and sits no lower than the new baseline.
  const gridFirst = await stage(page).evaluate((root) => {
    const grid = root.querySelector('.wizard-city-grid') as HTMLElement;
    const det = root.querySelector('details.wizard-quick-start') as HTMLElement;
    const cta = Array.from(root.querySelectorAll('.ec-btn.ec-btn-primary')).pop() as HTMLElement;
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return follows(grid, det) && follows(grid, cta);
  });
  expect(gridFirst).toBe(true);
  expect(data.gridRect?.y).toBeLessThanOrEqual(NEW_BASELINE_390_KO.gridY);
  // Exact text and font size against the new baseline; line-height intentionally not pinned (new 1.45).
  expect(data.priceNoteShort.text).toBe(NEW_BASELINE_390_KO.priceNoteText);
  expect(data.priceNoteShort.style?.fontSize).toBe(NEW_BASELINE_390_KO.priceNoteFontSize);
  expect(data.priceNoteShort.style?.fontSize).toBe('14px');
  await expectNoWrites(g);
});

// The pricing component renders one `.ai-planner-pricing-note__short` span per term: three <li> rows
// (free / coupon / full itinerary) and the FX note <p>. On the first steps the full twin is display:none.
test('destination pilot visible short-price terms at 390 KO: four, readable, unclipped', async ({ page }) => {
  const g = await openDestination(page, 'ko', 390, 844);
  await alignTop(page);
  // One note instance, inside the ticket and ahead of the wizard navigation.
  await expect(page.locator('.ai-planner-pricing-note')).toHaveCount(1);
  const hosted = await page.evaluate(() => {
    const note = document.querySelector('.ai-planner-pricing-note');
    const ticket = document.querySelector('.wizard-stage--dest .wizard-dest-ticket');
    const nav = Array.from(document.querySelectorAll('.wizard-stage--dest .ec-btn.ec-btn-primary')).pop();
    return Boolean(note && ticket && nav && ticket.contains(note)
      && (note.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(hosted).toBe(true);
  await page.locator('.wizard-dest-ticket__price').scrollIntoViewIfNeeded();
  const terms = await page.evaluate(() => {
    const vw = window.innerWidth;
    return Array.from(document.querySelectorAll('.ai-planner-pricing-note__short'))
      .filter((el) => getComputedStyle(el).display !== 'none' && (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const b = el.getBoundingClientRect();
        const parent = el.parentElement as HTMLElement;
        const p = parent.getBoundingClientRect();
        const ps = getComputedStyle(parent);
        return {
          text: (el.textContent || '').trim(),
          fontSize: parseFloat(getComputedStyle(el).fontSize),
          insideViewport: b.left >= 0 && b.right <= vw + 0.5,
          insideParent: b.left >= p.left - 0.5 && b.right <= p.right + 0.5 && b.top >= p.top - 0.5 && b.bottom <= p.bottom + 0.5,
          parentClips: ps.overflow !== 'visible' || ps.textOverflow === 'ellipsis' || ps.webkitLineClamp !== 'none',
          scrollFits: (el as HTMLElement).getClientRects().length > 0 && parent.scrollWidth <= parent.clientWidth + 1,
        };
      });
  });
  expect(terms).toHaveLength(4);
  for (const t of terms) {
    expect(t.text.length).toBeGreaterThan(0);
    expect(t.fontSize).toBeGreaterThanOrEqual(14);
    expect(t.insideViewport).toBe(true);
    expect(t.insideParent).toBe(true);
    expect(t.parentClips).toBe(false);
    expect(t.scrollFits).toBe(true);
  }
  await expectNoWrites(g);
});

test('destination pilot selected state at 390 KO: two cities, one activity', async ({ page }) => {
  const g = await openDestination(page, 'ko', 390, 844);
  await cityTiles(page).nth(0).click();
  await cityTiles(page).nth(1).click();
  await stage(page).locator('.wizard-pick-grid > .ec-option').first().click();
  await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).toHaveCount(2);
  await expect(stage(page).locator('.wizard-pick-grid > .ec-option[aria-pressed="true"]')).toHaveCount(1);
  await expect(stage(page).locator('.wizard-city-main')).toHaveCount(1);
  await settledCapture(page, 'final-after-selected-390-ko', { width: 390, height: 844 });
  await expectNoWrites(g);
});

// One real interaction: the pressed state while the mouse is down, then two cities, the main-base
// mark and the exact pricing copy. Captures/video go to the external artifact root, never the repo.
test('destination pilot press feedback, two cities, main base and pricing copy at 390 KO', async ({ page }) => {
  const g = await openDestination(page, 'ko', 390, 844);
  const first = cityTiles(page).nth(0);
  await first.scrollIntoViewIfNeeded();
  const paint = () => first.evaluate((el) => {
    const s = getComputedStyle(el);
    return { transform: s.transform, shadow: s.boxShadow };
  });
  const rest = await paint();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await paint()).transform).toBe('matrix(1, 0, 0, 1, 0, 1)');
  expect((await paint()).shadow).not.toBe(rest.shadow);
  if (process.env.PILOT_OUTPUT_DIR) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, 'final-pressed-390-ko.png'), animations: 'disabled' });
  }
  await page.mouse.up();
  await cityTiles(page).nth(1).click();
  await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).toHaveCount(2);
  await expect(stage(page).locator('.wizard-city-main')).toHaveCount(1);
  await expect(first.locator('.wizard-city-main')).toBeVisible();

  await page.locator('.wizard-dest-ticket__price').scrollIntoViewIfNeeded();
  const terms = await page.locator('.ai-planner-pricing-note__short').evaluateAll((els) => els
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => (el.textContent || '').trim()));
  expect(terms).toHaveLength(4);
  expect(terms[0]).toBe('결제 전 1일차 일정 개요 무료');
  expect(terms[1]).toBe('신규 가입 쿠폰: 1~3일 일정 무료');
  expect(terms[2]).toMatch(/^전체 일정 .*9\.90.*: 일별 동선·교통·지도·PDF 포함$/);
  expect(terms[3]).toMatch(/^표시된 USD로 결제됩니다\. 참고 원화: .+ \(카드사 환율에 따라 달라짐\)\.$/);
  if (process.env.PILOT_OUTPUT_DIR) {
    await page.screenshot({ path: join(OUT, 'final-pricing-390-ko.png'), animations: 'disabled' });
  }
  await expectNoWrites(g);
  if (process.env.PILOT_OUTPUT_DIR) {
    await page.close();
    await page.video()?.saveAs(join(OUT, 'final-press-interaction-390-ko.webm'));
  }
});

test('destination pilot mobile order, collapsed Quick Start, preset, validation', async ({ page }) => {
  const g = await openDestination(page, 'ko', 390, 844);
  const order = await stage(page).evaluate((root) => {
    const grid = root.querySelector('.wizard-city-grid') as HTMLElement;
    const det = root.querySelector('details.wizard-quick-start') as HTMLElement;
    const cta = Array.from(root.querySelectorAll('.ec-btn.ec-btn-primary')).pop() as HTMLElement;
    const h2 = root.querySelector('h2') as HTMLElement;
    const pos = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const y = (e: HTMLElement) => e.getBoundingClientRect().top;
    return { dom: pos(h2, grid) && pos(grid, det) && pos(det, cta), visual: y(h2) < y(grid) && y(grid) < y(det) && y(det) < y(cta), open: det.open, summaryH: (det.querySelector('summary') as HTMLElement).getBoundingClientRect().height };
  });
  expect(order).toMatchObject({ dom: true, visual: true, open: false });
  expect(order.summaryH).toBeGreaterThanOrEqual(44);
  await expect(firstPreset(page)).toBeHidden();
  expect(await cityTiles(page).count()).toBe(10);

  // Validation holds with nothing picked.
  await next(page).click();
  await expect(stage(page).locator('.ec-error-note').first()).toBeVisible();
  await expect(stage(page)).toBeVisible();

  // City select / toggle.
  await cityTiles(page).nth(1).click();
  await expect(cityTiles(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(quickStart(page)).toHaveCount(0);
  await cityTiles(page).nth(1).click();
  await expect(cityTiles(page).nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(quickStart(page)).toHaveCount(1);

  // Expand, run a preset (city + activities), then continue.
  await quickStart(page).locator('summary').click();
  await expect(firstPreset(page)).toBeVisible();
  await firstPreset(page).click();
  await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).not.toHaveCount(0);
  await expect(stage(page).locator('.wizard-pick-grid > .ec-option[aria-pressed="true"]')).not.toHaveCount(0);
  await next(page).click();
  await expect(page.locator('.wizard-stage--food')).toBeVisible();
  await back(page).click();
  await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).not.toHaveCount(0);
  // Forward/back keeps exactly one pricing note; on destination it is inside the ticket.
  await expect(page.locator('.ai-planner-pricing-note')).toHaveCount(1);
  expect(await page.evaluate(() => Boolean(document.querySelector('.wizard-dest-ticket')?.contains(document.querySelector('.ai-planner-pricing-note'))))).toBe(true);
  await next(page).click();
  await expect(page.locator('.wizard-stage--food')).toBeVisible();
  await expect(page.locator('.ai-planner-pricing-note')).toHaveCount(1);
  await back(page).click();
  await expect(stage(page)).toBeVisible();
  await expect(page.locator('.ai-planner-pricing-note')).toHaveCount(1);
  expect(await page.evaluate(() => Boolean(document.querySelector('.wizard-dest-ticket')?.contains(document.querySelector('.ai-planner-pricing-note'))))).toBe(true);
  // First step: still one note, outside the ticket, and the planner-price block is in place.
  await back(page).click();
  await expect(page.locator('.wizard-res-ticket')).toBeVisible();
  await expect(page.locator('.ai-planner-pricing-note')).toHaveCount(1);
  await expect(page.locator('.planner-price')).toHaveCount(1);
  await expect(page.locator('.wizard-dest-ticket .ai-planner-pricing-note')).toHaveCount(0);
  await expectNoWrites(g);
});

test('destination pilot desktop 1440 keeps Quick Start above the cities', async ({ page }) => {
  const g = await openDestination(page, 'ko', 1440, 1000);
  await expect(quickStart(page)).toHaveCount(0);
  await expect(firstPreset(page)).toBeVisible();
  const [pb, gb] = [(await firstPreset(page).boundingBox())!, (await stage(page).locator('.wizard-city-grid').boundingBox())!];
  expect(pb.y).toBeLessThan(gb.y);
  expect(await stage(page).locator('.ec-option-sm').count()).toBe(5);
  await firstPreset(page).click();
  await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).not.toHaveCount(0);
  await expectNoWrites(g);
});

// Desktop city grid facts: column count, narrowest tile and any name / main-base text that
// overflows its own box or its tile (clipping or truncation).
async function cityGridFacts(page: Page) {
  return stage(page).evaluate((root) => {
    const tiles = Array.from(root.querySelectorAll('.wizard-city-grid > .ec-option')) as HTMLElement[];
    const rects = tiles.map((t) => t.getBoundingClientRect());
    const columns = new Set(rects.map((r) => Math.round(r.left))).size;
    const clipped: string[] = [];
    tiles.forEach((tile) => {
      const tb = tile.getBoundingClientRect();
      tile.querySelectorAll('.wizard-city-name, .wizard-city-main').forEach((el) => {
        const e = el as HTMLElement;
        const b = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        const ellipsis = s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none';
        const spills = e.scrollWidth > e.clientWidth + 1 || b.left < tb.left - 0.5 || b.right > tb.right + 0.5;
        if (ellipsis || spills) clipped.push(`${(e.textContent || '').trim()}`);
      });
    });
    return { columns, minTileW: Math.round(Math.min(...rects.map((r) => r.width))), clipped };
  });
}

// Desktop destination ticket (1280): the actual selected and pressed states, keyboard focus, 44px
// targets, the four exact price clauses at a readable size and unclipped city names. Captures and
// the short UI video go to the external artifact root, never the repo.
test.describe('desktop destination ticket', () => {
  test('selected, pressed, focus, targets, pricing and names at 1280 KO', async ({ page }) => {
    const g = await openDestination(page, 'ko', 1280, 800);
    await alignTop(page);

    // One ticket: price note first, then rail, question, Quick Start, cities, interests, text, nav.
    const order = await page.evaluate(() => {
      const q = (sel: string, root: ParentNode = document) => root.querySelector(sel);
      const ticket = q('.planner-stage');
      const st = q('.wizard-stage--dest')!;
      const parts = [
        q('.planner-price'), q('.ec-steprail'), q('h2', st), q('.ec-option-sm', st), q('.wizard-city-grid', st),
        q('.wizard-pick-grid', st), q('textarea', st), Array.from(st.querySelectorAll('.ec-btn.ec-btn-primary')).pop() || null,
      ];
      const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        present: parts.every(Boolean),
        inOrder: parts.every((p, i) => i === 0 || follows(parts[i - 1]!, p!)),
        contained: Boolean(ticket && ticket.contains(st) && parts.every((p) => ticket.contains(p))),
        card: getComputedStyle(q('.planner-question')!).backgroundColor,
        noteCount: document.querySelectorAll('.ai-planner-pricing-note').length,
      };
    });
    expect(order).toMatchObject({ present: true, inOrder: true, contained: true, card: 'rgba(0, 0, 0, 0)', noteCount: 1 });

    // Question size and city grid shape.
    const m = await measure(page);
    const h2Size = parseFloat(m.h2.style?.fontSize || '0');
    expect(h2Size).toBeGreaterThanOrEqual(30);
    expect(h2Size).toBeLessThanOrEqual(32);
    expect(m.h2.style?.fontWeight).toBe('400');
    expect(m.docOverflowX).toBe(0);
    expect(m.cityName.style?.fontSize).toBe('15px');
    expect(m.tilePhoto?.w).toBe(52);
    expect(m.tileMin.count).toBe(10);
    expect(m.tileMin.minH).toBeGreaterThanOrEqual(70);
    const grid = await cityGridFacts(page);
    expect(grid.columns).toBeGreaterThanOrEqual(3);
    expect(grid.columns).toBeLessThanOrEqual(5);
    expect(grid.minTileW).toBeGreaterThanOrEqual(150);

    // Selected state: two cities, one activity, one main-base badge, check marks, dark text on lavender.
    const unselected = cityTiles(page).nth(2);
    const restPaint = await unselected.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, shadow: s.boxShadow, transform: s.transform };
    });
    await cityTiles(page).nth(0).click();
    await cityTiles(page).nth(1).click();
    await stage(page).locator('.wizard-pick-grid > .ec-option').first().click();
    await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).toHaveCount(2);
    await expect(stage(page).locator('.wizard-pick-grid > .ec-option[aria-pressed="true"]')).toHaveCount(1);
    await expect(stage(page).locator('.wizard-city-main')).toHaveCount(1);
    await expect(cityTiles(page).nth(0).locator('.wizard-city-main')).toBeVisible();
    await expect(cityTiles(page).nth(0).locator('svg')).toBeVisible();
    await expect(cityTiles(page).nth(1).locator('svg')).toBeVisible();
    const selectedPaint = await cityTiles(page).nth(0).evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, name: getComputedStyle(el.querySelector('.wizard-city-name')!).color };
    });
    expect(selectedPaint.bg).not.toBe(restPaint.bg);
    expect(selectedPaint.name).not.toBe(restPaint.color);
    expect((await measure(page)).docOverflowX).toBe(0);
    expect((await cityGridFacts(page)).clipped).toEqual([]);
    await alignTop(page);
    if (process.env.PILOT_OUTPUT_DIR) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, 'final-selected-1280-ko.png'), animations: 'disabled' });
    }

    // Pressed state while the mouse is down on an unselected tile: sinks 1px, shadow changes.
    await unselected.scrollIntoViewIfNeeded();
    const box = (await unselected.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(async () => unselected.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 1)');
    expect(await unselected.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(restPaint.shadow);
    if (process.env.PILOT_OUTPUT_DIR) {
      await page.screenshot({ path: join(OUT, 'final-pressed-1280-ko.png'), animations: 'disabled' });
    }
    // Release off the tile so the press does not toggle a third city.
    await page.mouse.move(box.x - 40, box.y - 40);
    await page.mouse.up();
    await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).toHaveCount(2);

    // Keyboard focus: a 2px visible ring on a tile.
    await unselected.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(unselected).toBeFocused();
    const ring = await unselected.evaluate((el) => ({ fv: el.matches(':focus-visible'), w: parseFloat(getComputedStyle(el).outlineWidth), s: getComputedStyle(el).outlineStyle }));
    expect(ring.fv).toBe(true);
    expect(ring.s).not.toBe('none');
    expect(ring.w).toBe(2);

    // Touch targets: every visible control in the ticket and the mode buttons is at least 44px tall.
    const small = await page.evaluate(() => Array.from(document.querySelectorAll('.planner-stage button, .planner-stage summary, .planner-mode-btn'))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ text: (el.textContent || '').trim().slice(0, 24), h: el.getBoundingClientRect().height }))
      .filter((t) => t.h < 44 - 0.5));
    expect(small).toEqual([]);
    expect((await next(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Pricing: the four exact clauses, whole and readable, inside the ticket and ahead of the question.
    await page.locator('.planner-price').scrollIntoViewIfNeeded();
    const terms = await page.evaluate(() => {
      const vw = window.innerWidth;
      return Array.from(document.querySelectorAll('.ai-planner-pricing-note__short'))
        .filter((el) => getComputedStyle(el).display !== 'none' && (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const b = el.getBoundingClientRect();
          const parent = el.parentElement as HTMLElement;
          const p = parent.getBoundingClientRect();
          return {
            text: (el.textContent || '').trim(),
            fontSize: parseFloat(getComputedStyle(el).fontSize),
            insideViewport: b.left >= 0 && b.right <= vw + 0.5,
            insideParent: b.left >= p.left - 0.5 && b.right <= p.right + 0.5 && b.top >= p.top - 0.5 && b.bottom <= p.bottom + 0.5,
            fits: parent.scrollWidth <= parent.clientWidth + 1,
          };
        });
    });
    expect(terms).toHaveLength(4);
    for (const t of terms) {
      expect(t.fontSize).toBeGreaterThanOrEqual(14);
      expect(t.insideViewport).toBe(true);
      expect(t.insideParent).toBe(true);
      expect(t.fits).toBe(true);
    }
    expect(terms[0].text).toBe('결제 전 1일차 일정 개요 무료');
    expect(terms[1].text).toBe('신규 가입 쿠폰: 1~3일 일정 무료');
    expect(terms[2].text).toMatch(/^전체 일정 .*9\.90.*: 일별 동선·교통·지도·PDF 포함$/);
    expect(terms[3].text).toMatch(/^표시된 USD로 결제됩니다\. 참고 원화: .+ \(카드사 환율에 따라 달라짐\)\.$/);
    if (process.env.PILOT_OUTPUT_DIR) {
      await page.screenshot({ path: join(OUT, 'final-pricing-1280-ko.png'), animations: 'disabled' });
    }

    // Reduced motion: no tile transition and no sink transform on press.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await unselected.evaluate((el) => {
      const s = getComputedStyle(el);
      return { property: s.transitionProperty, dur: Math.max(...s.transitionDuration.split(',').map((d) => parseFloat(d) || 0)) };
    });
    expect(motion.property).toBe('none');
    expect(motion.dur).toBeLessThanOrEqual(0.01);
    await unselected.scrollIntoViewIfNeeded();
    const again = (await unselected.boundingBox())!;
    await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
    await page.mouse.down();
    await expect.poll(async () => unselected.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    await page.mouse.move(again.x - 40, again.y - 40);
    await page.mouse.up();

    await expectNoWrites(g);
  });
});

test('destination pilot focus, reduced motion, CTA size at 390 KO', async ({ page }) => {
  const g = await openDestination(page, 'ko', 390, 844);
  const summary = quickStart(page).locator('summary');
  await summary.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  const f = await summary.evaluate((el) => ({ fv: el.matches(':focus-visible'), w: parseFloat(getComputedStyle(el).outlineWidth), s: getComputedStyle(el).outlineStyle }));
  expect(f.fv).toBe(true);
  expect(f.s).not.toBe('none');
  expect(f.w).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(quickStart(page)).toHaveAttribute('open', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dur = await cityTiles(page).first().evaluate((el) => Math.max(...getComputedStyle(el).transitionDuration.split(',').map((d) => parseFloat(d) || 0)));
  expect(dur).toBeLessThanOrEqual(0.01);
  expect((await next(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoWrites(g);
});

const MATRIX: { width: number; height: number; lang: Lang }[] = [];
for (const lang of ['ko', 'en', 'ja', 'zh'] as Lang[]) {
  for (const [width, height] of [[360, 800], [390, 844], [430, 932], [1440, 1000], [1280, 800], [1024, 768]]) MATRIX.push({ width, height, lang });
}
for (const { width, height, lang } of MATRIX) {
  test(`destination pilot layout ${width} ${lang}: no overflow, wrapping, targets`, async ({ page }) => {
    const g = await openDestination(page, lang, width, height);
    const m = await measure(page);
    if (process.env.PILOT_OUTPUT_DIR) {
      // Collapsed/default state, then (phone only) the expanded Quick Start — screenshot + measured JSON each.
      await settledCapture(page, `final-matrix-${width}-${lang}-default`);
      if (width < 768) {
        await quickStart(page).locator('summary').click();
        await expect(firstPreset(page)).toBeVisible();
        await settledCapture(page, `final-matrix-${width}-${lang}-quickstart-open`);
        await quickStart(page).locator('summary').click();
        await expect(firstPreset(page)).toBeHidden();
      }
    }
    expect(m.docOverflowX).toBe(0);
    expect(m.tileMin.count).toBe(10);
    expect(m.tileMin.minH).toBeGreaterThanOrEqual(44);
    expect(m.cta.rect?.h).toBeGreaterThanOrEqual(44);
    const lineH = parseFloat(m.h2.style?.lineHeight || '0');
    expect(m.h2.rect?.h).toBeLessThanOrEqual(lineH * 2 + 1);
    const inside = await stage(page).evaluate((root) => {
      const box = root.getBoundingClientRect();
      return Array.from(root.querySelectorAll('button, summary, textarea'))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => { const b = el.getBoundingClientRect(); return b.left < box.left - 1 || b.right > box.right + 1; }).length;
    });
    expect(inside).toBe(0);
    if (width < 768) {
      expect(m.tilePhoto?.w).toBe(52);
      expect(await quickStart(page).locator('summary').evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    } else {
      await expect(quickStart(page)).toHaveCount(0);
      const h2Size = parseFloat(m.h2.style?.fontSize || '0');
      expect(h2Size).toBeGreaterThanOrEqual(30);
      expect(h2Size).toBeLessThanOrEqual(32);
      expect(m.tilePhoto?.w).toBe(52);
      expect(m.cityName.style?.fontSize).toBe('15px');
      expect(m.tileMin.minH).toBeGreaterThanOrEqual(70);
      const grid = await cityGridFacts(page);
      expect(grid.columns).toBeGreaterThanOrEqual(3);
      expect(grid.columns).toBeLessThanOrEqual(5);
      expect(grid.minTileW).toBeGreaterThanOrEqual(150);
      expect(grid.clipped).toEqual([]);
    }
    await expectNoWrites(g);
  });
}

for (const [width, phoneLayout] of [[767, true], [768, false]] as [number, boolean][]) {
  test(`destination pilot breakpoint ${width}: ${phoneLayout ? 'phone' : 'desktop'} layout`, async ({ page }) => {
    const g = await openDestination(page, 'ko', width, 1000);
    const m = await measure(page);
    expect(m.docOverflowX).toBe(0);
    expect(m.tileMin.count).toBe(10);
    if (phoneLayout) {
      await expect(quickStart(page)).toHaveCount(1);
      await expect(firstPreset(page)).toBeHidden();
      expect(m.h2.style?.fontSize).toBe('26px');
    } else {
      await expect(quickStart(page)).toHaveCount(0);
      await expect(firstPreset(page)).toBeVisible();
      // Desktop destination question: 30–32px (first-step expectations are elsewhere and unchanged).
      const h2Size = parseFloat(m.h2.style?.fontSize || '0');
      expect(h2Size).toBeGreaterThanOrEqual(30);
      expect(h2Size).toBeLessThanOrEqual(32);
    }
    await expectNoWrites(g);
  });
}

// Real resize across the breakpoint: choices made through the UI persist and the single note is re-homed.
for (const [from, to] of [[767, 768], [768, 767]] as [number, number][]) {
  test(`destination pilot resize ${from} to ${to}: one note, selections and text persist`, async ({ page }) => {
    const g = await openDestination(page, 'ko', from, 1000);
    const text = 'resize check 123';
    await cityTiles(page).nth(1).click();
    await stage(page).locator('.wizard-pick-grid > .ec-option').first().click();
    await stage(page).locator('textarea').first().fill(text);
    for (const width of [to, from]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
      const phone = width < 768;
      // A city is selected, so `!mainCity` hides the Quick Start preset on both layouts.
      await expect(quickStart(page)).toHaveCount(0);
      await expect(page.locator('.ai-planner-pricing-note')).toHaveCount(1);
      await expect(page.locator('.wizard-dest-ticket .ai-planner-pricing-note')).toHaveCount(phone ? 1 : 0);
      await expect(stage(page).locator('.wizard-city-grid > .ec-option[aria-pressed="true"]')).toHaveCount(1);
      await expect(stage(page).locator('.wizard-pick-grid > .ec-option[aria-pressed="true"]')).toHaveCount(1);
      await expect(stage(page).locator('textarea').first()).toHaveValue(text);
    }
    await expectNoWrites(g);
  });
}

// Before-only: rewrites the original baseline files, so it never runs unless explicitly opted in.
test('pilot baseline 390 KO', async ({ page }) => {
  test.skip(process.env.PILOT_BASELINE_ONLY !== '1', 'before-only opt-in: set PILOT_BASELINE_ONLY=1');
  const g = await openDestination(page, 'ko', 390, 844);
  mkdirSync(OUT, { recursive: true });
  await alignTop(page);
  const data = await measure(page);
  writeFileSync(join(OUT, 'baseline.json'), JSON.stringify(data));
  await page.screenshot({ path: join(OUT, 'before-390-ko.png') });
  expect(g.writes).toEqual([]);
  expect(g.plannerCalls).toEqual([]);
  expect(g.pageErrors).toEqual([]);
});
