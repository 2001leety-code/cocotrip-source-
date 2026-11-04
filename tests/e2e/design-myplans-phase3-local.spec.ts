import { writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

const BASE = new URL(process.env.BASE_URL || 'http://127.0.0.1:5178');
type Language = 'ko' | 'en' | 'ja' | 'zh';
type State = 'normal' | 'loading' | 'empty' | 'error' | 'partial';
const COPY = {
  ko: { loading: '저장한 일정을 불러오는 중', search: '제목·지역으로 검색', clear: '검색 지우기' },
  en: { loading: 'Loading your saved plans', search: 'Search by title or area', clear: 'Clear search' },
  ja: { loading: '保存したプランを読み込んでいます', search: 'タイトル・地域で検索', clear: '検索をクリア' },
  zh: { loading: '正在加载已保存的行程', search: '按标题或地区搜索', clear: '清除搜索' },
} as const;
test.use({ baseURL: BASE.origin, serviceWorkers: 'block', reducedMotion: 'reduce' });

async function isolate(page: Page, width: number, language: Language = 'ko') {
  expect(BASE.origin).toBe('http://127.0.0.1:5178');
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript((lang) => {
    localStorage.setItem('cocotrip_lang', lang);
    localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
    localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
  }, language);
  const errors: string[] = [];
  const writes: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== BASE.origin) return route.abort('blockedbyclient');
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (/^\/api\/_shared\/[^?]+\.js$/.test(url.pathname)) return route.continue();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  return { errors, writes };
}

async function openFixture(page: Page, state: State) {
  await page.goto(`/dev/my-plans-editorial?__fixture=${state}`, { waitUntil: 'domcontentloaded' });
  const library = page.getByTestId('my-plans-library');
  await expect(library).toBeVisible({ timeout: 30000 });
  // App.tsx CustomerNightScope uses this existing display:contents ancestor.
  // DEV deliberately lacks its class. Reproduce the real page's CSS cascade
  // on that same wrapper; do not change authentication or product routes.
  await library.evaluate((el) => {
    let wrapper = el.parentElement;
    while (wrapper && wrapper.style.display !== 'contents') wrapper = wrapper.parentElement;
    if (!wrapper) throw new Error('CustomerNightScope wrapper not found');
    wrapper.classList.add('ec-night');
  });
  await expect(page.locator('.ec-night .my-plans-editorial')).toBeVisible();
  await page.locator('.my-plans-editorial img:visible').evaluateAll(async (imgs) => {
    await Promise.all(imgs.map(async (img) => {
      const image = img as HTMLImageElement;
      if (image.complete && image.naturalWidth > 0) return;
      await image.decode();
    }));
  });
}

async function capture(page: Page, info: TestInfo, state: string, signedOut = false) {
  const main = signedOut ? page.getByTestId('auth-required-shell') : page.getByTestId('my-plans-library');
  await page.evaluate(() => window.scrollTo(0, 0));
  const metrics = await main.evaluate((el) => ({
    viewport: innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    top: el.getBoundingClientRect().top + scrollY,
    paddingTop: parseFloat(getComputedStyle(el).paddingTop),
    mastheadTop: el.querySelector('.my-plans-editorial-masthead')?.getBoundingClientRect().top,
    text: (el as HTMLElement).innerText,
    controls: Array.from(el.querySelectorAll('button, a, input')).map((node) => {
      const box = node.getBoundingClientRect();
      return { label: node.getAttribute('aria-label') || node.textContent?.trim(), width: box.width, height: box.height, font: parseFloat(getComputedStyle(node).fontSize) };
    }).filter((item) => item.width && item.height),
    cards: Array.from(el.querySelectorAll('[data-testid="my-plans-plan-card"]')).map((node) => ({ top: node.getBoundingClientRect().top + scrollY, height: node.getBoundingClientRect().height })),
    loadingCopy: (() => {
      const node = el.querySelector('.my-plans-editorial-loading-copy .sr-only');
      return node ? { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height } : null;
    })(),
    visibleLoading: (() => {
      const node = el.querySelector('.my-plans-editorial-loading-label');
      return node ? { text: node.textContent, height: node.getBoundingClientRect().height, font: parseFloat(getComputedStyle(node).fontSize) } : null;
    })(),
  }));
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewport + 1);
  for (const control of metrics.controls) {
    expect(control.width, control.label || '').toBeGreaterThanOrEqual(44);
    expect(control.height, control.label || '').toBeGreaterThanOrEqual(44);
  }
  if (!signedOut) {
    expect(metrics.paddingTop).toBeLessThanOrEqual(40);
    expect(metrics.mastheadTop).toBeLessThanOrEqual(110);
  }
  writeFileSync(info.outputPath(`${state}.json`), JSON.stringify(metrics, null, 2), 'utf8');
  await page.screenshot({ path: info.outputPath(`${state}-viewport.png`) });
  if (!signedOut) {
    await page.locator('#my-plans-plans-panel').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 84));
    await page.screenshot({ path: info.outputPath(`${state}-content-viewport.png`) });
  }
}

for (const width of [390, 1280]) {
  test(`${width} ko: actual signed-out gate stays intact`, async ({ page }, info) => {
    const guards = await isolate(page, width);
    await page.goto('/my-plans', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('auth-required-shell')).toHaveAttribute('data-state', 'signed-out', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: '로그인이 필요합니다', exact: true })).toBeVisible();
    await expect(page.getByTestId('my-plans-library')).toHaveCount(0);
    await capture(page, info, 'signed-out', true);
    expect(guards.writes).toEqual([]);
    expect(guards.errors).toEqual([]);
  });

  test(`${width} ko: synthetic library states and recovery`, async ({ page }, info) => {
    test.setTimeout(150000);
    const guards = await isolate(page, width);
    for (const state of ['normal', 'loading', 'empty', 'error', 'partial'] as const) {
      await openFixture(page, state);
      if (state === 'normal' || state === 'partial') await expect(page.getByTestId('my-plans-plan-card')).toHaveCount(2);
      else await expect(page.getByTestId(`my-plans-list-${state}`)).toBeVisible();
      await capture(page, info, state);
      if (state === 'normal') {
        const search = page.getByRole('searchbox', { name: '제목·지역으로 검색' });
        await search.fill('SYNTHETIC-NO-MATCH');
        await expect(page.getByTestId('my-plans-list-no-match')).toBeVisible();
        await expect(page.getByTestId('my-plans-list-no-match')).toHaveAttribute('role', 'status');
        await expect(page.getByTestId('my-plans-list-no-match')).toHaveAttribute('aria-live', 'polite');
        await capture(page, info, 'search-empty');
        await page.getByRole('button', { name: '검색 지우기', exact: true }).click();
        await expect(search).toHaveValue('');
        await expect(page.getByTestId('my-plans-plan-card')).toHaveCount(2);
        const plans = page.locator('#my-plans-plans-tab');
        const bookings = page.locator('#my-plans-bookings-tab');
        await plans.focus();
        await page.keyboard.press('ArrowRight');
        await expect(bookings).toBeFocused();
        await expect(bookings).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('my-plans-bookings-boundary')).toBeVisible();
        await page.screenshot({ path: info.outputPath('bookings-tab-fixture-limitation-viewport.png') });
        // This DEV fixture does not inject a user. The bookings spinner is not
        // an authenticated bookings-state fixture; only tab wiring is checked.
        await page.keyboard.press('Home');
        await expect(plans).toBeFocused();
        await expect(plans).toHaveAttribute('aria-selected', 'true');
      }
      if (state === 'loading') {
        await expect(page.getByTestId('my-plans-list-loading')).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.my-plans-editorial-loading-label')).toHaveText(COPY.ko.loading);
        await expect(page.locator('.my-plans-editorial-loading-label')).toBeVisible();
      }
      if (state === 'error' || state === 'partial') {
        await page.getByRole('button', { name: '다시 시도', exact: true }).click();
        await expect(page.getByTestId('my-plans-plan-card')).toHaveCount(2);
        await expect(page.getByTestId(`my-plans-list-${state}`)).toHaveCount(0);
        await capture(page, info, `${state}-recovered`);
      }
    }
    expect(guards.writes).toEqual([]);
    expect(guards.errors).toEqual([]);
  });
}

for (const language of ['en', 'ja', 'zh'] as const) {
  test(`390 ${language}: visible loading and search feedback`, async ({ page }, info) => {
    test.setTimeout(90000);
    const guards = await isolate(page, 390, language);
    await openFixture(page, 'loading');
    const loadingLabel = page.locator('.my-plans-editorial-loading-label');
    await expect(loadingLabel).toHaveText(COPY[language].loading);
    await expect(loadingLabel).toBeVisible();
    await capture(page, info, 'loading');
    await openFixture(page, 'normal');
    await capture(page, info, 'normal');
    const search = page.getByRole('searchbox', { name: COPY[language].search });
    await search.fill('SYNTHETIC-NO-MATCH');
    const empty = page.getByTestId('my-plans-list-no-match');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute('role', 'status');
    await expect(empty).toHaveAttribute('aria-live', 'polite');
    await capture(page, info, 'search-empty');
    await page.getByRole('button', { name: COPY[language].clear, exact: true }).click();
    await expect(page.getByTestId('my-plans-plan-card')).toHaveCount(2);
    expect(guards.writes).toEqual([]);
    expect(guards.errors).toEqual([]);
  });
}
