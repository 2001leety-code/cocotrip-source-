import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type Language = 'ko' | 'en' | 'ja' | 'zh';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;

const COPY: Record<Language, string> = {
  ko: '로그인이 필요합니다',
  en: 'Sign in to continue',
  ja: 'ログインしてください',
  zh: '请登录以继续',
};

const CHECKING: Record<Language, string> = {
  ko: '계정을 확인하고 있습니다.',
  en: 'Checking your account.',
  ja: 'アカウントを確認しています。',
  zh: '正在检查您的账户。',
};

async function preparePage(page: Page, language: Language) {
  await page.addInitScript((nextLanguage) => {
    const applyRefinedTheme = () => document.documentElement.classList.add('refined');
    if (document.documentElement) applyRefinedTheme();
    else document.addEventListener('DOMContentLoaded', applyRefinedTheme, { once: true });
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('cocotrip_lang', nextLanguage);
    window.localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  }, language);
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css; charset=utf-8',
    body: '',
  }));
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }));
}

for (const viewport of VIEWPORTS) {
  for (const language of Object.keys(COPY) as Language[]) {
    test(`${viewport.label}px ${language} auth gate is a flat, touch-safe editorial document`, async ({ page }, testInfo) => {
      test.skip(Boolean(testInfo.project.use.isMobile), 'Keyboard focus is covered with desktop input across all target widths.');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await preparePage(page, language);

      const writes: string[] = [];
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];

      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          writes.push(`${request.method()} ${request.url()}`);
        }
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });

      await page.goto('/mypage?__authFixture=signed-out', { waitUntil: 'domcontentloaded' });
      const title = page.getByRole('heading', { level: 1, name: COPY[language], exact: true });
      await expect(title).toBeVisible();
      const titleBox = await title.boundingBox();
      expect(titleBox).not.toBeNull();
      expect(titleBox!.y).toBeGreaterThanOrEqual(0);

      if (viewport.width === 768 && language !== 'en') {
        expect(titleBox!.height).toBeLessThan(64);
      }

      const shell = page.getByTestId('auth-required-shell');
      await expect(shell).toHaveAttribute('data-state', 'signed-out');
      await expect(page.locator('main')).toHaveCount(1);
      const shellBox = await shell.boundingBox();
      expect(shellBox).not.toBeNull();
      expect(shellBox!.y + shellBox!.height).toBeGreaterThanOrEqual(viewport.height - 1);
      const paint = await shell.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
      });
      expect(paint.backgroundImage).toBe('none');
      expect(paint.backgroundColor).not.toBe('rgb(8, 11, 20)');

      const actions = page.locator('.auth-required-action:visible');
      expect(await actions.count()).toBeGreaterThanOrEqual(2);

      for (const action of await actions.all()) {
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        const before = await action.evaluate((element) => getComputedStyle(element).boxShadow);
        await action.focus();
        await expect(action).toBeFocused();
        const focus = await action.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            focusVisible: element.matches(':focus-visible'),
            boxShadow: style.boxShadow,
            transitionProperty: style.transitionProperty,
          };
        });

        expect(focus.focusVisible).toBe(true);
        expect(focus.boxShadow).not.toBe(before);
        expect(focus.boxShadow).toContain('rgb(243, 241, 236)');
        expect(focus.boxShadow).toContain('rgb(83, 38, 214)');
        expect(focus.transitionProperty).not.toMatch(/(^|,\s*)(all|box-shadow)(,|$)/);
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      expect(writes).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }
}

test('keyboard Tab reaches each auth action in document order', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'Keyboard order is covered with desktop input.');
  await page.setViewportSize({ width: 390, height: 844 });
  await preparePage(page, 'en');
  await page.goto('/my-plans', { waitUntil: 'domcontentloaded' });

  const actions = page.locator('.auth-required-action:visible');
  const expected = await actions.evaluateAll((elements) => elements.map((element) => (element.textContent || '').trim()));
  const reached: string[] = [];

  for (let press = 0; press < 30 && reached.length < expected.length; press += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement) || !activeElement.classList.contains('auth-required-action')) return '';
      return (activeElement.textContent || '').trim();
    });
    if (focused && reached.at(-1) !== focused) reached.push(focused);
  }

  expect(reached).toEqual(expected);
});

test('the same signed-out document protects every shared account route', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'Shared route coverage runs once in desktop Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await preparePage(page, 'en');

  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });

  for (const route of ['/mypage', '/my-plans', '/charter-legacy']) {
    await page.goto(`${route}?__authFixture=signed-out`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('auth-required-shell')).toHaveAttribute('data-state', 'signed-out');
    await expect(page.getByRole('heading', { level: 1, name: COPY.en, exact: true })).toBeVisible();
  }

  expect(writes).toEqual([]);
});

test('development fixtures expose loading and error presentation without an auth write', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'Deterministic state coverage runs once in desktop Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await preparePage(page, 'en');

  const writes: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });

  await page.goto('/my-plans?__authFixture=loading', { waitUntil: 'domcontentloaded' });
  const loadingShell = page.getByTestId('auth-required-shell');
  await expect(loadingShell).toHaveAttribute('data-state', 'loading');
  await expect(loadingShell).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status')).toHaveText(CHECKING.en);

  await page.goto('/my-plans?__authFixture=error', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('auth-required-shell')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(writes).toEqual([]);
});

test('forced colors restores a system outline and removes shadows', async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), 'Forced colors is covered with desktop Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ forcedColors: 'active' });
  await preparePage(page, 'en');
  await page.goto('/my-plans', { waitUntil: 'domcontentloaded' });

  const action = page.locator('.auth-required-action:visible').first();
  await action.focus();
  const focus = await action.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineOffset: Number.parseFloat(style.outlineOffset),
      boxShadow: style.boxShadow,
    };
  });

  expect(focus.outlineStyle).not.toBe('none');
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(3);
  expect(focus.outlineOffset).toBeGreaterThanOrEqual(3);
  expect(focus.boxShadow).toBe('none');
});
