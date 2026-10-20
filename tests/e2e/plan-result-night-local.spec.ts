import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page, Request, Route } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

/** Known read-only payloads (ReviewList list / rating aggregate) on exact `/api/reviews`. */
function isReviewRead(req: Request) {
  if (new URL(req.url()).pathname !== '/api/reviews') return false;
  if (req.method() === 'GET') return true;
  if (req.method() !== 'POST') return false;
  try {
    const body = req.postDataJSON() as { action?: string };
    return body.action === 'list' || body.action === 'aggregate';
  } catch {
    return false;
  }
}

/**
 * Plan result "Night Dossier" — local preview only (127.0.0.1:5178).
 * Every non-local request is aborted, service workers are blocked, and the
 * local `/api/*` boundary is mocked exactly: `/api/get-plan` returns a synthetic
 * plan (fixture shape reused from plan-detail-editorial.spec.ts), `/api/reviews`
 * returns no reviews for read payloads only (action list/aggregate), anything
 * else under `/api/` answers `{}`. Nothing is submitted: any other non-GET
 * request fails the test. PDF export is never invoked.
 * Screenshots are written only when EXPANSION_SCREENSHOT_DIR is set.
 */

test.use({ serviceWorkers: 'block' });
test.use({
  video: process.env.EXPANSION_VIDEO === '1'
    ? { mode: 'on', size: { width: 390, height: 844 } }
    : 'off',
});

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');

type Lang = 'ko' | 'en' | 'ja' | 'zh';
type PlanState = 'normal' | 'empty' | 'error';

const LANGUAGES: Lang[] = ['ko', 'en', 'ja', 'zh'];
const VIEWPORTS = [
  { label: '360', width: 360, height: 800 },
  { label: '390', width: 390, height: 844 },
  { label: '430', width: 430, height: 932 },
  { label: '1024', width: 1024, height: 768 },
  { label: '1280', width: 1280, height: 800 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
// Full KO/EN/JA/ZH × 360/390/430/1024/1280/1440 matrix, plus the existing 768 ja tablet case.
const CASES: { viewport: { label: string; width: number; height: number }; lang: Lang }[] = [
  ...VIEWPORTS.flatMap((viewport) => LANGUAGES.map((lang) => ({ viewport, lang }))),
  { viewport: { label: '768', width: 768, height: 1024 }, lang: 'ja' },
];

const copy = {
  ko: { title: '서울 2일 실행 일정', theme: '도심과 한강', theme2: '남산과 시장', stop: '경복궁', nextStop: '북촌한옥마을', day2Stop: '남산서울타워', day2NextStop: '광장시장', note: '지하철 조회 결과를 확인하세요.', city: '서울' },
  en: { title: 'Two days in Seoul', theme: 'City and river', theme2: 'Namsan and markets', stop: 'Gyeongbokgung Palace', nextStop: 'Bukchon Hanok Village', day2Stop: 'N Seoul Tower', day2NextStop: 'Gwangjang Market', note: 'Check the measured subway leg.', city: 'Seoul' },
  ja: { title: 'ソウル2日間の実行日程', theme: '都心と漢江', theme2: '南山と市場', stop: '景福宮', nextStop: '北村韓屋村', day2Stop: 'Nソウルタワー', day2NextStop: '広蔵市場', note: '地下鉄の検索結果を確認してください。', city: 'ソウル' },
  zh: { title: '首尔两日执行行程', theme: '市区与汉江', theme2: '南山与市场', stop: '景福宫', nextStop: '北村韩屋村', day2Stop: 'N首尔塔', day2NextStop: '广藏市场', note: '请查看地铁查询结果。', city: '首尔' },
} as const;

const REPORT_LABEL = /플랜에 문제가 있나요|Report an issue with this plan|プランに問題がありますか|行程有问题/;

function planFixture(language: Lang, state: PlanState, tMoneyLoad?: number) {
  const text = copy[language];
  const days = state === 'empty'
    ? []
    : [{
        day: 1,
        date: '2026-09-12',
        city: text.city,
        theme: text.theme,
        stops: [
          {
            start_time: '09:00',
            stay_min: 90,
            category: 'attraction',
            display_name: text.stop,
            address: '161 Sajik-ro, Jongno-gu, Seoul',
            lat: 37.5796,
            lng: 126.977,
            tip: text.note,
          },
          {
            start_time: '11:10',
            stay_min: 70,
            category: 'culture',
            display_name: text.nextStop,
            address: '37 Gyedong-gil, Jongno-gu, Seoul',
            lat: 37.5826,
            lng: 126.983,
            transit_from_prev: { method: 'subway', est_min: 20, fare: 1500, transfers: 0, walk_min: 6 },
          },
        ],
      }, {
        // Second coherent day: the title promises two days, so the fixture has two.
        day: 2,
        date: '2026-09-13',
        city: text.city,
        theme: text.theme2,
        stops: [
          {
            start_time: '10:00',
            stay_min: 80,
            category: 'attraction',
            display_name: text.day2Stop,
            address: '105 Namsangongwon-gil, Yongsan-gu, Seoul',
            reservation_required: true,
            reservation_note: 'Synthetic local test note · 로컬 테스트용 가상 안내 · ローカルテスト用 · 本地测试用',
            lat: 37.5512,
            lng: 126.9882,
          },
          {
            start_time: '12:10',
            stay_min: 60,
            category: 'food',
            display_name: text.day2NextStop,
            address: '88 Changgyeonggung-ro, Jongno-gu, Seoul',
            lat: 37.5701,
            lng: 126.9996,
            transit_from_prev: { method: 'subway', est_min: 25, fare: 1500, transfers: 1, walk_min: 8 },
          },
        ],
      }];
  return {
    id: `night-${state}-${language}`,
    isPublic: true,
    status: state === 'error' ? 'error' : 'ready',
    input: { language, area: text.city, regions: ['seoul'], startDate: '2026-09-12', adults: 2 },
    itinerary: { tour_title: text.title, days, ...(tMoneyLoad === undefined ? {} : { t_money_recommended_load: tMoneyLoad }) },
  };
}

async function setupPage(page: Page, lang: Lang, state: PlanState = 'normal', tMoneyLoad?: number) {
  expect(BASE.hostname).toBe('127.0.0.1');
  expect(BASE.port).toBe('5178');

  await page.addInitScript(([origin, l]) => {
    if (window.location.origin !== origin) throw new Error('origin mismatch');
    localStorage.setItem('cocotrip_lang', l);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, [BASE.origin, lang]);

  const apiCalls: string[] = [];
  await page.route('**/*', (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) {
      apiCalls.push(url.pathname);
      if (url.pathname === '/api/get-plan') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, plan: planFixture(lang, state, tMoneyLoad) }),
        });
      }
      if (isReviewRead(route.request())) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: [] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });

  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && !isReviewRead(req)) writes.push(`${req.method()} ${req.url()}`);
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { pageErrors, writes, apiCalls };
}

async function shot(page: Page, name: string) {
  const dir = process.env.EXPANSION_SCREENSHOT_DIR;
  if (!dir) return;
  const out = path.join(dir, 'plan-result-night');
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

for (const { viewport, lang } of CASES) {
  {
    test(`${viewport.label}px ${lang} night dossier result + timeline`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const { pageErrors, writes, apiCalls } = await setupPage(page, lang);

      await page.goto(`/my-plans/night-normal-${lang}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      const root = page.getByTestId('plan-document');
      await expect(root).toHaveClass(/plan-result-night/);
      await expect(page.getByTestId('plan-document-ready')).toBeVisible();

      // One restrained serif title: readable, never a poster headline.
      const masthead = page.getByTestId('plan-document-masthead');
      await expect(masthead).toContainText(copy[lang].title);
      const titleSize = await masthead.locator('h1').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(titleSize).toBeGreaterThanOrEqual(20);
      expect(titleSize).toBeLessThanOrEqual(40);
      // Facts agree with the fixture and the "2 days" title: days, stops, travelers, start date.
      const facts = masthead.locator('dd');
      await expect(facts).toHaveCount(4);
      await expect(facts.nth(0)).toHaveText('2');
      await expect(facts.nth(1)).toHaveText('4');
      await expect(facts.nth(2)).toHaveText('2');
      // Start date is localized to the app language, keeps calendar day 12 (no UTC shift), and appears once.
      const dateLocale = ({ ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' } as Record<string, string>)[lang] || 'en-US';
      const localizedDate = new Intl.DateTimeFormat(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(2026, 8, 12));
      await expect(facts.nth(3)).toHaveText(localizedDate);
      expect((await masthead.innerText()).split(localizedDate).length - 1).toBe(1);
      await expect(masthead).not.toContainText('2026-09-12');
      const factSizes = await facts.evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      for (const px of factSizes) expect(px).toBeGreaterThanOrEqual(14);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await shot(page, `${viewport.label}-${lang}-top`);

      // Sticky tabs, 44px targets, horizontal scroll container.
      const tabsNav = page.locator('nav.plan-night-tabs');
      await expect(tabsNav).toHaveCSS('position', 'sticky');
      const tabs = page.getByTestId('section-tabs-scroll').getByRole('tab');
      const heights = await tabs.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(heights.length).toBeGreaterThan(1);
      expect(heights.every((h) => h >= 44)).toBe(true);
      await expect(page.getByTestId('section-tabs-scroll')).toHaveCSS('overflow-x', 'auto');
      // Exactly one tab per real day — agrees with the title and the days fact.
      const dayTabs = tabs.filter({ hasText: /Day\s*\d|\d+\s*일|\d+\s*日|第\s*\d+\s*天/ });
      await expect(dayTabs).toHaveCount(2);

      // Day timeline: route map element preserved (offline tiles are blocked by the
      // isolation boundary, so the geographic map view itself is NOT verified here),
      // compact 56-62px time column, name >= 15, meta >= 13, tip >= 14.
      await dayTabs.first().click();
      // Two-day fixture renders one route map per day; the Day 1 map comes first.
      await expect(page.getByTestId('day-route-map')).toHaveCount(2);
      await expect(page.getByTestId('day-route-map').first()).toBeVisible();
      const firstStop = page.getByRole('button', { name: new RegExp(copy[lang].stop) }).first();
      await expect(firstStop).toBeVisible();
      const timeWidth = await firstStop.locator('.plan-night-stop-time').evaluate((el) => el.getBoundingClientRect().width);
      expect(Math.round(timeWidth)).toBeGreaterThanOrEqual(56);
      expect(Math.round(timeWidth)).toBeLessThanOrEqual(62);
      const px = (sel: string) => firstStop.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(await px('.plan-night-stop-name')).toBeGreaterThanOrEqual(15);
      expect(await px('.plan-night-stop-meta .ec-chip')).toBeGreaterThanOrEqual(13);
      await firstStop.click();
      await expect(firstStop).toHaveAttribute('aria-expanded', 'true');
      const tip = firstStop.locator('.plan-night-tip');
      await expect(tip).toContainText(copy[lang].note);
      expect(await tip.locator('p').last().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
      await shot(page, `${viewport.label}-${lang}-timeline`);

      // Day 2 is real content, not a phantom tab.
      await dayTabs.nth(1).click();
      await expect(dayTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('button', { name: new RegExp(copy[lang].day2Stop) }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

      if (viewport.label === '390' && lang === 'ko') {
        // Route disclaimer and any reservation-condition line stay readable (>= 14px).
        const fontPx = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
        expect(await page.locator('.plan-night-route-note').first().evaluate(fontPx)).toBeGreaterThanOrEqual(14);
        for (const size of await root.locator('.plan-night-tip p').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))) {
          expect(size).toBeGreaterThanOrEqual(14);
        }
        // Synthetic Day2 reservation block: heading and note both stay >= 14px.
        // StopCard body starts collapsed, so expand the Day2 stop first.
        await page.getByRole('button', { name: new RegExp(copy[lang].day2Stop) }).first().click();
        const reservation = root.locator('.plan-night-stop-body > [class*="border-l-2"]').filter({ hasText: 'Synthetic local test note' }).first();
        await expect(reservation).toContainText('Synthetic local test note');
        await expect(reservation.locator('> p').filter({ hasText: 'Synthetic local test note' })).toBeVisible();
        for (const line of [reservation.locator('> p').nth(0), reservation.locator('> p').nth(1)]) {
          expect(await line.evaluate(fontPx)).toBeGreaterThanOrEqual(14);
        }
        await shot(page, '390-ko-reservation');
        // Map row: Directions + Naver + Google on one row, each >= 44px, no overflow.
        const mapRow = root.locator('[data-testid="plan-stop-map-row"]').filter({ visible: true }).first();
        const mapControls = mapRow.locator('> a, > button');
        await expect(mapControls).toHaveCount(3);
        const boxes = await mapControls.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
        for (const b of boxes) {
          expect(b.height).toBeGreaterThanOrEqual(44);
          expect(Math.abs(b.top - boxes[0].top)).toBeLessThanOrEqual(1);
        }
        expect(await mapRow.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        const naver = mapRow.locator('a', { hasText: 'Naver' });
        const google = mapRow.locator('a', { hasText: 'Google' });
        await expect(naver).toHaveAttribute('aria-label', /\(Naver\)$/);
        await expect(google).toHaveAttribute('aria-label', /\(Google\)$/);
        await expect(naver).toHaveAttribute('href', /^https:\/\/map\.naver\.com\/v5\/search\//);
        await expect(google).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        // Real keyboard focus on a tab shows a visible indicator.
        await dayTabs.nth(1).focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const focusedTab = page.locator('[role="tab"]:focus-visible');
        await expect(focusedTab).toHaveCount(1);
        const ring = await focusedTab.evaluate((el) => { const s = getComputedStyle(el); return { outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== 'none' }; });
        expect(ring.outline || ring.shadow).toBe(true);
        // Reduced motion: the tab and stop carry no ongoing transition/animation.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const stop = page.getByRole('button', { name: new RegExp(copy[lang].day2Stop) }).first();
        for (const el of [focusedTab, stop]) {
          const motion = await el.evaluate((node) => ({ running: node.getAnimations().filter((a) => a.playState === 'running').length, duration: Math.max(...getComputedStyle(node).transitionDuration.split(',').map((d) => parseFloat(d) || 0)) }));
          expect(motion.running).toBe(0);
          expect(motion.duration).toBeLessThanOrEqual(0.01);
        }
        await page.emulateMedia({ reducedMotion: null });
      }

      if (viewport.label === '360' && lang === 'en') {
        // Compact map row: "Route" stays on one line with Naver + Google intact.
        const mapRow = root.locator('[data-testid="plan-stop-map-row"]').filter({ visible: true }).first();
        await expect(mapRow.locator('> a, > button')).toHaveCount(3);
        await expect(mapRow.locator('a', { hasText: 'Naver' })).toHaveAttribute('href', /^https:\/\/map\.naver\.com\/v5\/search\//);
        await expect(mapRow.locator('a', { hasText: 'Google' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
        const route = mapRow.locator('> a, > button').filter({ hasText: /^\s*Route\s*$/ });
        await expect(route).toHaveCount(1);
        await expect(route).toBeVisible();
        const fit = await route.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const lineTops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          return { lines: lineTops.size, overflow: el.scrollWidth - el.clientWidth };
        });
        expect(fit.lines).toBe(1);
        expect(fit.overflow).toBeLessThanOrEqual(1);
      }

      expect(apiCalls).toContain('/api/get-plan');
      expect(writes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
}

test('390px en navigation: tabs, report modal open/close, browser back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { pageErrors, writes } = await setupPage(page, 'en');

  // A static local page as the history entry to return to (no auth gate).
  await page.goto('/terms', { waitUntil: 'domcontentloaded' });
  await page.goto('/my-plans/night-normal-en', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('plan-document-ready')).toBeVisible();

  const tabs = page.getByTestId('section-tabs-scroll').getByRole('tab');
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  // Keyboard focus (Shift+Tab then Tab) so :focus-visible applies.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveCSS('outline-style', 'solid');

  const report = page.getByRole('button', { name: REPORT_LABEL });
  await report.scrollIntoViewIfNeeded();
  await report.click();
  const close = page.getByTestId('report-plan-close');
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box?.height || 0).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(close).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/terms$/);
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('390px ko empty and error states stay inside the night scope', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const empty = await setupPage(page, 'ko', 'empty');
  await page.goto('/my-plans/night-empty-ko', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('plan-detail-empty')).toBeVisible();
  await expect(page.getByTestId('plan-document')).toHaveClass(/plan-result-night/);
  expect(empty.writes).toEqual([]);
  expect(empty.pageErrors).toEqual([]);
});

for (const { name, load, visible } of [
  { name: 'zero', load: 0, visible: false },
  { name: 'positive', load: 35000, visible: true },
]) {
  test(`390px en T-money row ${name} load`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { pageErrors, writes } = await setupPage(page, 'en', 'normal', load);
    await page.goto(`/my-plans/night-normal-en`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('plan-document-ready')).toBeVisible();
    const row = page.getByTestId('plan-intro-tmoney');
    if (visible) {
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeVisible();
      await expect(row).toContainText('T-money');
      await expect(row).toContainText('35,000');
    } else {
      await expect(row).toHaveCount(0);
      await expect(page.getByText('T-money', { exact: true })).toHaveCount(0);
    }
    await shot(page, `tmoney-${name}-load-390-en`);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test('390px en error state stays inside the night scope', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { pageErrors, writes } = await setupPage(page, 'en', 'error');
  await page.goto('/my-plans/night-error-en', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('plan-detail-error')).toBeVisible();
  await expect(page.getByTestId('plan-error-state')).toHaveClass(/plan-result-night/);
  await shot(page, '390-en-error');
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});
