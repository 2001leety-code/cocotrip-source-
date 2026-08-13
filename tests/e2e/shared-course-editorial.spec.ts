import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type SharedState = 'normal' | 'loading' | 'empty' | 'error' | 'not-found' | 'partial';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const STATES: SharedState[] = ['normal', 'loading', 'empty', 'error', 'not-found', 'partial'];

const COPY = {
  ko: { heading: '공유된 코스', loading: '공유 코스를 불러오는 중', empty: '표시할 장소가 없어요', error: '공유 코스를 불러오지 못했어요.', notFound: '이 공유 코스를 찾을 수 없어요.', partial: '일부 장소 정보만 표시하고 있어요.', retry: '다시 시도' },
  en: { heading: 'Shared course', loading: 'Loading shared course', empty: 'There are no places to show', error: 'Could not load this shared course.', notFound: 'This shared course was not found.', partial: 'Some place details are unavailable.', retry: 'Try again' },
  ja: { heading: '共有されたコース', loading: '共有コースを読み込んでいます', empty: '表示できる場所がありません', error: '共有コースを読み込めませんでした。', notFound: 'この共有コースは見つかりませんでした。', partial: '一部の場所情報を表示できません。', retry: '再試行' },
  zh: { heading: '共享行程', loading: '正在加载共享行程', empty: '没有可显示的地点', error: '无法加载此共享行程。', notFound: '未找到此共享行程。', partial: '部分地点信息无法显示。', retry: '重试' },
} as const;

const readyPayload = {
  ok: true,
  data: {
    v: 1,
    title: 'Seoul morning',
    days: [
      { stops: [
        { id: 'stop-1', title: 'Gyeongbokgung', time: '09:00', category: 'sight', memo: 'North gate', lat: 37.5796, lng: 126.977 },
        { id: 'stop-2', title: 'Changdeokgung', time: '10:30', category: 'sight', memo: '', lat: 37.5794, lng: 126.991 },
      ] },
      { stops: [{ id: 'stop-3', title: 'Mangwon Market', time: '12:00', category: 'food', memo: '', lat: 37.556, lng: 126.905 }] },
    ],
  },
};

async function installLanguage(page: Page, language: Language) {
  await page.addInitScript((value) => {
    const applyRefinedTheme = () => document.documentElement.classList.add('refined');
    if (document.documentElement) applyRefinedTheme();
    else document.addEventListener('DOMContentLoaded', applyRefinedTheme, { once: true });
    window.localStorage.setItem('cocotrip_lang', value);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  }, language);
}

async function isolateExternalFonts(page: Page) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: '',
  }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('https://*.basemaps.cartocdn.com/**', (route) => route.fulfill({ status: 204, body: '' }));
}

async function fulfillShare(route: Route, state: SharedState) {
  if (state === 'loading') return new Promise<void>(() => {});
  if (state === 'error') {
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'INTERNAL_ERROR' }) });
  }
  if (state === 'not-found') {
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'NOT_FOUND' }) });
  }
  if (state === 'empty') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { v: 1, title: '', days: [{ stops: [] }] } }) });
  }
  if (state === 'partial') {
    const payload = structuredClone(readyPayload);
    payload.data.days[0].stops.push({
      id: 'broken-stop', title: '', time: '', category: 'etc', memo: '', lat: 37.58, lng: 126.98,
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(readyPayload) });
}

async function assertGeometry(page: Page, expectControls: boolean) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const controls = page.locator('.shared-course-main button:visible, .shared-course-main a:visible, .shared-course-main input:visible, .shared-course-main textarea:visible, .shared-course-main select:visible');
  const sizes = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      tag: element.tagName,
      description: `${element.tagName}.${element.className} ${element.textContent || ''}`.trim(),
      inlineAttribution: Boolean(element.closest('.leaflet-control-attribution')),
      width: rect.width,
      height: rect.height,
      fontSize: Number(style.fontSize.replace('px', '')),
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter,
    };
  }));
  if (!expectControls) {
    expect(sizes).toHaveLength(0);
    return;
  }
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.filter(({ width, height, inlineAttribution }) => !inlineAttribution && (width < 44 || height < 44))).toEqual([]);
  expect(sizes.filter(({ tag }) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)).every(({ fontSize }) => fontSize >= 16)).toBe(true);
  expect(sizes.every(({ backgroundImage }) => !backgroundImage.includes('gradient'))).toBe(true);
  expect(sizes.every(({ backdropFilter }) => backdropFilter === 'none')).toBe(true);
}

async function assertVisibleFocus(page: Page) {
  const target = page.locator('.shared-course-main button:visible, .shared-course-main a:visible').first();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  let reachedTarget = false;
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press('Tab');
    reachedTarget = await target.evaluate((element) => document.activeElement === element);
    if (reachedTarget) break;
  }
  expect(reachedTarget).toBe(true);
  await expect.poll(() => target.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle === 'solid'
      && Number.parseFloat(style.outlineWidth) >= 2
      && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);
}

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} shared course state contract`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
      await isolateExternalFonts(page);
      let activeState: SharedState = 'normal';
      let writes = 0;
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const unexpectedResponses: string[] = [];

      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        const expectedFixtureFailure = /^Failed to load resource: the server responded with a status of (404|500)/.test(message.text());
        if (message.type() === 'error' && !expectedFixtureFailure) consoleErrors.push(message.text());
      });
      page.on('response', (response) => {
        const isExpectedShareFailure = response.url().includes('/api/course-share?id=')
          && (response.status() === 404 || response.status() === 500);
        if (response.status() >= 400 && !isExpectedShareFailure) {
          unexpectedResponses.push(`${response.status()} ${response.url()}`);
        }
      });
      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes += 1;
      });
      await page.route('**/api/course-share?id=*', (route) => fulfillShare(route, activeState));

      for (const state of STATES) {
        activeState = state;
        await page.goto('/s/abcd1234', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: COPY[language].heading, exact: true })).toBeVisible();

        if (state === 'normal' || state === 'partial') {
          await expect(page.getByTestId('shared-course-ready')).toContainText('Gyeongbokgung');
          await expect(page.locator('.shared-course-map .leaflet-control-zoom')).toBeVisible();
        }
        if (state === 'partial') {
          await expect(page.getByTestId('shared-course-ready')).toContainText(COPY[language].partial);
        }
        if (state === 'loading') {
          await expect(page.getByTestId('shared-course-loading')).toContainText(COPY[language].loading);
        }
        if (state === 'empty') {
          await expect(page.getByTestId('shared-course-empty')).toContainText(COPY[language].empty);
        }
        if (state === 'error') {
          const error = page.getByTestId('shared-course-error');
          await expect(error).toContainText(COPY[language].error);
          activeState = 'normal';
          await error.getByRole('button', { name: COPY[language].retry }).click();
          await expect(page.getByTestId('shared-course-ready')).toContainText('Gyeongbokgung');
        }
        if (state === 'not-found') {
          await expect(page.getByTestId('shared-course-not-found')).toContainText(COPY[language].notFound);
        }

        await assertGeometry(page, state !== 'loading');
        if (state !== 'loading') await assertVisibleFocus(page);
      }

      expect(writes).toBe(0);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(unexpectedResponses).toEqual([]);
    });
  }
}
