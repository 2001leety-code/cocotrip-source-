import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type AssistantState = 'signed-out' | 'ready' | 'loading' | 'auth-error';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const STATES: AssistantState[] = ['signed-out', 'ready', 'loading', 'auth-error'];
const LOGIN_TEXT: Record<Language, { title: string; google: string }> = {
  ko: { title: '로그인 후 이용 가능합니다', google: '구글로 시작하기' },
  en: { title: 'Sign in to chat', google: 'Continue with Google' },
  ja: { title: 'ログインして利用', google: 'Googleで続ける' },
  zh: { title: '登录后使用', google: '使用Google登录' },
};

async function installLanguage(page: Page, language: Language) {
  await page.addInitScript((value) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('cocotrip_lang', value);
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

async function assertGeometry(page: Page) {
  const metrics = await page.locator('.assistant-editorial-page').evaluate((root) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const elements = [...root.querySelectorAll('*')].filter(visible);
    const controls = elements.filter((element) => element.matches('button, a, input, textarea, select'));
    const controlSizes = controls.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        width: rect.width,
        height: rect.height,
        fontSize: Number.parseFloat(style.fontSize),
      };
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      gradients: elements.filter((element) => getComputedStyle(element).backgroundImage.includes('gradient')).length,
      glass: elements.filter((element) => {
        const style = getComputedStyle(element);
        const webkitStyle = style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
        const standardValue = style.backdropFilter || 'none';
        const webkitValue = webkitStyle.webkitBackdropFilter || 'none';
        return standardValue !== 'none' || webkitValue !== 'none';
      }).length,
      controlSizes,
    };
  });

  expect(metrics.overflow).toBeLessThanOrEqual(1);
  expect(metrics.gradients).toBe(0);
  expect(metrics.glass).toBe(0);
  expect(metrics.controlSizes.length).toBeGreaterThan(0);
  expect(metrics.controlSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  expect(metrics.controlSizes
    .filter(({ tag }) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag))
    .every(({ fontSize }) => fontSize >= 16)).toBe(true);
}

async function assertVisibleFocus(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.focus();
  await expect.poll(() => target.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible')
      && style.outlineStyle !== 'none'
      && Number.parseFloat(style.outlineWidth) >= 2
      && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);
}

test('signed-out assistant keeps the real read-only entry path intact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installLanguage(page, 'en');
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

  await page.goto('/assistant', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('assistant-editorial-shell')).toHaveAttribute('data-state', 'signed-out');
  await expect(page).toHaveTitle('Assistant | CocoTrip');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Assistant');
  await expect(page.getByRole('heading', { level: 2, name: LOGIN_TEXT.en.title })).toBeVisible();
  await expect(page.getByRole('button', { name: LOGIN_TEXT.en.google })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await assertGeometry(page);

  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('390px ready chat keeps long conversations internally scrolled to the latest message', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installLanguage(page, 'en');
  await page.goto('/assistant?__fixture=ready', { waitUntil: 'domcontentloaded' });

  const messageLog = page.getByRole('log');
  const composer = page.getByRole('textbox');
  await composer.fill('draft question');
  await page.getByRole('group', { name: 'Quick questions' }).getByRole('button').first().click();
  await expect(composer).toHaveValue('draft question');
  const timestamp = messageLog.locator('.assistant-editorial-message-time').first();
  await expect(timestamp).toBeVisible();
  await expect(timestamp).toHaveJSProperty('tagName', 'SPAN');

  await messageLog.locator('.assistant-editorial-message-row').first().evaluate((element) => {
    (element as HTMLElement).style.minHeight = '1800px';
  });

  await expect.poll(() => messageLog.evaluate((element) => (
    element.scrollHeight > element.clientHeight
  ))).toBe(true);

  await messageLog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.locator('.assistant-editorial-language').nth(1).click();

  await expect.poll(() => messageLog.evaluate((element) => (
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
  ))).toBeLessThanOrEqual(2);
});

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} assistant shell states stay safe and usable`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
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

      for (const state of STATES) {
        await page.goto(`/assistant?__fixture=${state}`, { waitUntil: 'domcontentloaded' });
        const shell = page.getByTestId('assistant-editorial-shell');
        await expect(shell).toHaveAttribute('data-state', state);
        await expect(page.locator('html')).toHaveAttribute('lang', language);

        if (state === 'signed-out') {
          await expect(page.getByRole('heading', { level: 2, name: LOGIN_TEXT[language].title })).toBeVisible();
          await expect(page.getByRole('button', { name: LOGIN_TEXT[language].google })).toBeVisible();
          await expect(page.getByRole('textbox')).toHaveCount(0);
          await assertVisibleFocus(page, '.assistant-editorial-google');
        }
        if (state === 'ready') {
          await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
          await expect(page.getByRole('textbox')).toBeEnabled();
          await expect(page.locator('.assistant-editorial-quick-question')).not.toHaveCount(0);
          await assertVisibleFocus(page, '.assistant-editorial-input');
        }
        if (state === 'loading') {
          await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');
          await expect(page.getByRole('status')).toBeVisible();
          const textbox = page.getByRole('textbox');
          await expect(textbox).not.toHaveAttribute('disabled');
          await expect(textbox).toHaveAttribute('readonly', '');
          await expect(textbox).toHaveAttribute('aria-disabled', 'true');
          await textbox.focus();
          await expect(textbox).toBeFocused();
        }
        if (state === 'auth-error') await expect(page.getByRole('alert')).toBeVisible();

        await assertVisibleFocus(page, '.assistant-editorial-back');
        await assertVisibleFocus(page, '.assistant-editorial-language[aria-pressed="true"]');
        await assertGeometry(page);
      }

      expect(writes).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }
}
