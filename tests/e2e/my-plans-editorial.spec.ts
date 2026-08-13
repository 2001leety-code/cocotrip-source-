import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type LibraryState = 'normal' | 'loading' | 'empty' | 'error' | 'partial';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;

const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const STATES: LibraryState[] = ['normal', 'loading', 'empty', 'error', 'partial'];

function relativeLuminance(color: string) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${color}`);
  return channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

const COPY = {
  ko: { title: '내 플랜', ready: '서울 골목과 궁궐 일정', loading: '저장한 일정을 불러오는 중', empty: '아직 플랜이 없어요', error: '일정을 불러오지 못했어요', partial: '일부 일정을 더 불러오지 못했어요', retry: '다시 시도', search: '제목·지역으로 검색', noMatch: '검색 결과가 없어요', clear: '검색 지우기' },
  en: { title: 'My Plans', ready: 'Seoul lanes and palaces', loading: 'Loading your saved plans', empty: 'No plans yet', error: 'Could not load your plans', partial: 'Some plans could not be loaded', retry: 'Try again', search: 'Search by title or area', noMatch: 'No matching plans', clear: 'Clear search' },
  ja: { title: 'マイプラン', ready: 'ソウルの路地と宮殿プラン', loading: '保存したプランを読み込んでいます', empty: 'まだプランがありません', error: 'プランを読み込めませんでした', partial: '一部のプランを追加で読み込めませんでした', retry: '再試行', search: 'タイトル・地域で検索', noMatch: '該当するプランがありません', clear: '検索をクリア' },
  zh: { title: '我的计划', ready: '首尔巷弄与宫殿行程', loading: '正在加载已保存的行程', empty: '还没有行程', error: '无法加载行程', partial: '部分行程未能继续加载', retry: '重试', search: '按标题或地区搜索', noMatch: '没有匹配的行程', clear: '清除搜索' },
} as const;

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
}

async function assertGeometry(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const controls = page.locator('.my-plans-editorial-main :is(button, a, input):visible');
  const sizes = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      tag: element.tagName,
      width: rect.width,
      height: rect.height,
      fontSize: Number(style.fontSize.replace('px', '')),
      backgroundImage: style.backgroundImage,
    };
  }));

  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  expect(sizes.filter(({ tag }) => tag === 'INPUT').every(({ fontSize }) => fontSize >= 16)).toBe(true);
  expect(sizes.every(({ backgroundImage }) => !backgroundImage.includes('gradient'))).toBe(true);
}

async function assertVisibleFocus(page: Page) {
  const target = page.locator('.my-plans-editorial-tab').first();
  await target.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => target.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none'
      && Number.parseFloat(style.outlineWidth) >= 2
      && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);
}

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} saved-plan library states`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
      await isolateExternalFonts(page);
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const responseErrors: string[] = [];
      let writes = 0;

      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes += 1;
      });
      page.on('response', (response) => {
        if (response.url().startsWith('http://127.0.0.1') && response.status() >= 400) {
          responseErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      for (const state of STATES) {
        await page.goto(`/dev/my-plans-editorial?__fixture=${state}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { level: 1, name: COPY[language].title })).toBeVisible();

        if (state === 'normal') {
          await expect(page.getByRole('link', { name: new RegExp(COPY[language].ready) })).toBeVisible();
          await expect(page.getByTestId('my-plans-plan-card')).toHaveCount(2);
        }
        if (state === 'loading') {
          await expect(page.getByTestId('my-plans-list-loading')).toContainText(COPY[language].loading);
          await expect(page.getByTestId('my-plans-list-loading')).toHaveAttribute('aria-busy', 'true');
        }
        if (state === 'empty') {
          await expect(page.getByTestId('my-plans-list-empty')).toContainText(COPY[language].empty);
        }
        if (state === 'error') {
          await expect(page.getByTestId('my-plans-list-error')).toContainText(COPY[language].error);
          await page.getByRole('button', { name: COPY[language].retry }).click();
          await expect(page.getByRole('link', { name: new RegExp(COPY[language].ready) })).toBeVisible();
        }
        if (state === 'partial') {
          await expect(page.getByTestId('my-plans-list-partial')).toContainText(COPY[language].partial);
          await expect(page.getByTestId('my-plans-plan-card')).toHaveCount(2);
          await page.getByRole('button', { name: COPY[language].retry }).click();
          await expect(page.getByTestId('my-plans-list-partial')).toHaveCount(0);
          await expect(page.getByTestId('my-plans-plan-card')).toHaveCount(2);
        }

        await assertGeometry(page);
        await assertVisibleFocus(page);
      }

      expect(writes).toBe(0);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(responseErrors).toEqual([]);
    });
  }
}

test('tabs follow the keyboard contract and keep inverse focus visible', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await installLanguage(page, 'en');
  await isolateExternalFonts(page);
  await page.goto('/dev/my-plans-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });

  const plansTab = page.getByRole('tab', { name: 'My Plans' });
  const bookingsTab = page.getByRole('tab', { name: 'My Bookings' });
  await plansTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(bookingsTab).toBeFocused();
  await expect(bookingsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'My Bookings' })).toBeVisible();

  await page.keyboard.press('Home');
  await expect(plansTab).toBeFocused();
  await expect(plansTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(bookingsTab).toBeFocused();

  const focusStyle = await page.evaluate(() => {
    const panel = document.getElementById('my-plans-bookings-panel');
    if (!panel) return null;
    const probe = document.createElement('button');
    probe.type = 'button';
    probe.textContent = 'Focus probe';
    panel.append(probe);
    probe.focus();
    const probeStyle = getComputedStyle(probe);
    const panelStyle = getComputedStyle(panel);
    const result = {
      backgroundImage: panelStyle.backgroundImage,
      panelColor: panelStyle.backgroundColor,
      outlineColor: probeStyle.outlineColor,
      outlineStyle: probeStyle.outlineStyle,
      outlineWidth: Number.parseFloat(probeStyle.outlineWidth),
    };
    probe.remove();
    return result;
  });

  expect(focusStyle).not.toBeNull();
  expect(focusStyle?.backgroundImage).not.toContain('gradient');
  expect(focusStyle?.outlineStyle).not.toBe('none');
  expect(focusStyle?.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(contrastRatio(focusStyle!.outlineColor, focusStyle!.panelColor)).toBeGreaterThanOrEqual(3);
});

test('search miss can be cleared without a new read', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installLanguage(page, 'en');
  await isolateExternalFonts(page);
  let writes = 0;
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes += 1;
  });

  await page.goto('/dev/my-plans-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });
  await page.getByRole('searchbox', { name: COPY.en.search }).fill('Jeju');
  await expect(page.getByTestId('my-plans-list-no-match')).toContainText(COPY.en.noMatch);
  await page.getByRole('button', { name: COPY.en.clear }).click();
  await expect(page.getByRole('link', { name: new RegExp(COPY.en.ready) })).toBeVisible();
  expect(writes).toBe(0);
});
