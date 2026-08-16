import { test, expect } from './fixtures/analytics-guard';
import type { Page } from '@playwright/test';

const LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXPECTED_ORIGIN = new URL(process.env.BASE_URL || 'https://cocotripkr.com').origin;

/**
 * `/mypage` 모바일 위계 — 첫 실제 여행자 동작까지의 스크롤 (2026-08-16).
 *
 * 데스크톱용 정적 프로필과 줄바꿈된 탭 밀도를 폰에서도 그대로 써서 첫 동작이
 * 폴드 한참 아래에서 시작했다. 여기서 재는 건 그 결과의 **픽셀** 이다 —
 * 클래스·소스 계약은 tests/unit/mypage-editorial-shell.component.test.tsx 가 본다.
 *
 * 8조합 = 360×800 / 390×844 × ko/en/ja/zh. 읽기와 측정, 그리고 탭 전환만 한다.
 */
const MOBILE_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];

const PROFILE_MAX_HEIGHT = 150;
const TABS_MAX_HEIGHT = 52;
const NEXT_TRIP_MAX_TOP = 430;
const STATS_MAX_TOP = 620;
const PAGE_MAX_HEIGHT = 1800;
const LANGUAGE_TOP_SPREAD_MAX = 16;

const TOUCH_MIN = 44;

async function tabsGeometry(page: Page) {
  return page.locator('.mypage-editorial-tabs').evaluate((list: HTMLElement) => {
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('.mypage-editorial-tab'));
    const tops = tabs.map((tab) => Math.round(tab.getBoundingClientRect().top));
    return {
      height: Math.round(list.getBoundingClientRect().height),
      rows: new Set(tops).size,
      count: tabs.length,
    };
  });
}

function documentTop(page: Page, selector: string) {
  return page.locator(selector).evaluate((el: HTMLElement) =>
    Math.round(el.getBoundingClientRect().top + window.scrollY));
}

function watchPage(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const writeRequests: string[] = [];
  const badResponses: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === EXPECTED_ORIGIN && !SAFE_METHODS.has(request.method())) {
      writeRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === EXPECTED_ORIGIN && response.status() >= 400) {
      badResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  return { pageErrors, consoleErrors, writeRequests, badResponses };
}

test.describe('/mypage editorial shell', () => {
  for (const viewport of VIEWPORTS) {
    for (const language of LANGUAGES) {
      test(`${viewport.width}px × ${language} normal`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
        await page.setViewportSize(viewport);
        const signals = watchPage(page);
        await page.addInitScript((nextLanguage) => {
          localStorage.setItem('cocotrip_lang', nextLanguage);
        }, language);

        await page.goto('/dev/mypage-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });

        const shell = page.getByTestId('mypage-editorial-shell');
        const main = page.locator('main.mypage-editorial-main');
        await expect(shell).toBeVisible();
        await expect(shell).toHaveClass(/\bec-root\b/);
        await expect(main).toBeVisible();
        await expect(page.getByRole('tablist')).toBeVisible();
        await expect(page.locator('.mypage-editorial-profile')).toBeVisible();

        const paint = await shell.evaluate((element: HTMLElement) => {
          const style = getComputedStyle(element);
          return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
        });
        expect(paint.backgroundImage).toBe('none');
        expect(paint.backgroundColor).not.toBe('rgb(8, 11, 20)');

        const controls = main.locator('a, button, input, select, textarea');
        const controlCount = await controls.count();
        for (let index = 0; index < controlCount; index += 1) {
          const control = controls.nth(index);
          if (!await control.isVisible()) continue;
          const box = await control.boundingBox();
          expect(box, `control ${index} should have geometry`).not.toBeNull();
          expect(box!.width, `control ${index} width`).toBeGreaterThanOrEqual(44);
          expect(box!.height, `control ${index} height`).toBeGreaterThanOrEqual(44);
        }

        const activeTab = page.getByRole('tab', { selected: true });
        await activeTab.focus();
        const focus = await activeTab.evaluate((element: HTMLElement) => {
          const style = getComputedStyle(element);
          return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
        });
        expect(focus.outlineStyle).not.toBe('none');
        expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);

        for (const tabId of ['bookings', 'courses', 'coupons', 'wishlist', 'reviews', 'history']) {
          await page.locator(`#mypage-tab-${tabId}`).click();
          await expect(page.locator(`#mypage-panel-${tabId}`)).toBeVisible();
        }

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        expect(signals.pageErrors).toEqual([]);
        expect(signals.consoleErrors).toEqual([]);
        expect(signals.writeRequests).toEqual([]);
        expect(signals.badResponses).toEqual([]);
      });
    }
  }

  for (const viewport of MOBILE_VIEWPORTS) {
    for (const language of LANGUAGES) {
      test(`${viewport.width}px × ${language} loading, empty and review error`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
        await page.setViewportSize(viewport);
        const signals = watchPage(page);
        await page.addInitScript((nextLanguage) => {
          localStorage.setItem('cocotrip_lang', nextLanguage);
        }, language);

        await page.goto('/dev/mypage-editorial?__fixture=loading', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('mypage-loading')).toHaveAttribute('aria-busy', 'true');

        await page.goto('/dev/mypage-editorial?__fixture=empty&tab=wishlist', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#mypage-panel-wishlist')).toBeVisible();
        await expect(page.locator('#mypage-panel-wishlist [role="status"], #mypage-panel-wishlist h2')).toBeVisible();
        expect(await tabsGeometry(page)).toMatchObject({ rows: 1 });

        await page.goto('/dev/mypage-editorial?__fixture=review-error&tab=reviews', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#mypage-panel-reviews [aria-live="assertive"]')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        expect(signals.pageErrors).toEqual([]);
        expect(signals.consoleErrors).toEqual([]);
        expect(signals.writeRequests).toEqual([]);
        expect(signals.badResponses).toEqual([]);
      });
    }
  }
});

test.describe('/mypage 모바일 위계 — 첫 여행자 동작까지의 스크롤', () => {
  for (const viewport of MOBILE_VIEWPORTS) {
    for (const language of LANGUAGES) {
      test(`${viewport.width}×${viewport.height} × ${language}`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
        await page.setViewportSize(viewport);
        const signals = watchPage(page);
        await page.addInitScript((nextLanguage) => {
          localStorage.setItem('cocotrip_lang', nextLanguage);
        }, language);

        await page.goto('/dev/mypage-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('mypage-editorial-shell')).toBeVisible();
        // 웹폰트가 붙기 전에 재면 y 좌표가 몇 px 씩 흔들린다.
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        const profileHeight = await page.locator('.mypage-editorial-profile').evaluate(
          (el: HTMLElement) => Math.round(el.getBoundingClientRect().height));
        expect(
          profileHeight,
          `프로필 카드 ${profileHeight}px > ${PROFILE_MAX_HEIGHT}px 예산`,
        ).toBeLessThanOrEqual(PROFILE_MAX_HEIGHT);

        const tabs = await tabsGeometry(page);
        expect(tabs.count, '탭 7개를 못 찾았다').toBe(7);
        expect(tabs.rows, `탭이 ${tabs.rows}줄로 줄바꿈됐다`).toBe(1);
        expect(tabs.height, `탭 줄 ${tabs.height}px > ${TABS_MAX_HEIGHT}px`).toBeLessThanOrEqual(TABS_MAX_HEIGHT);

        const nextTripTop = await documentTop(page, '.mypage-editorial-nexttrip');
        expect(
          nextTripTop,
          `첫 동작 top=${nextTripTop}px > ${NEXT_TRIP_MAX_TOP}px 예산`,
        ).toBeLessThanOrEqual(NEXT_TRIP_MAX_TOP);

        const statsTop = await documentTop(page, '.mypage-editorial-stats');
        expect(statsTop, `집계 top=${statsTop}px > ${STATS_MAX_TOP}px 예산`).toBeLessThanOrEqual(STATS_MAX_TOP);

        const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(pageHeight, `개요 총 길이 ${pageHeight}px > ${PAGE_MAX_HEIGHT}px`).toBeLessThanOrEqual(PAGE_MAX_HEIGHT);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `가로 넘침 ${overflow}px`).toBeLessThanOrEqual(1);

        const undersized = await page.locator('main.mypage-editorial-main').evaluate((main: HTMLElement, min: number) =>
          Array.from(main.querySelectorAll<HTMLElement>('a, button, input, select, textarea'))
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              };
            })
            .filter((box) => box.w < min || box.h < min), TOUCH_MIN);
        expect(undersized, `44px 미만 조작: ${JSON.stringify(undersized)}`).toEqual([]);

        expect(signals.pageErrors).toEqual([]);
        expect(signals.consoleErrors).toEqual([]);
        expect(signals.writeRequests).toEqual([]);
        expect(signals.badResponses).toEqual([]);
      });
    }

    test(`${viewport.width}×${viewport.height} language top spread`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
      await page.setViewportSize(viewport);
      const tops: Record<string, number> = {};
      const heights: Record<string, number> = {};

      for (const language of LANGUAGES) {
        // addInitScript accumulates across iterations on the same page, so a stale
        // script from an earlier locale can win the race and silently re-set the
        // language. Write directly on the page's own origin and reload instead.
        await page.goto('/dev/mypage-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });
        await page.evaluate((nextLanguage) => {
          localStorage.setItem('cocotrip_lang', nextLanguage);
        }, language);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('mypage-editorial-shell')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        tops[language] = await documentTop(page, '.mypage-editorial-nexttrip');
        heights[language] = (await tabsGeometry(page)).height;
      }

      const values = Object.values(tops);
      const spread = Math.max(...values) - Math.min(...values);
      expect(spread, `언어별 첫 동작 상단 편차 ${spread}px — ${JSON.stringify(tops)}`)
        .toBeLessThanOrEqual(LANGUAGE_TOP_SPREAD_MAX);
      expect(new Set(Object.values(heights)).size, `언어별 탭 줄 높이가 다르다 — ${JSON.stringify(heights)}`).toBe(1);
    });
  }

  test('360px deep-linked tab stays horizontally in view', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/dev/mypage-editorial?__fixture=normal&tab=reviews', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#mypage-panel-reviews')).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const visibility = await page.locator('.mypage-editorial-tabs').evaluate((list: HTMLElement) => {
      const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active) return null;
      const listRect = list.getBoundingClientRect();
      const tabRect = active.getBoundingClientRect();
      return {
        id: active.id,
        leftGap: Math.round(tabRect.left - listRect.left),
        rightGap: Math.round(listRect.right - tabRect.right),
      };
    });
    expect(visibility).not.toBeNull();
    expect(visibility!.id).toBe('mypage-tab-reviews');
    expect(visibility!.leftGap, `활성 탭이 왼쪽으로 잘렸다 — ${JSON.stringify(visibility)}`).toBeGreaterThanOrEqual(0);
    expect(visibility!.rightGap, `활성 탭이 오른쪽으로 잘렸다 — ${JSON.stringify(visibility)}`).toBeGreaterThanOrEqual(0);
  });

  test('360px long display name clips instead of expanding the compact profile', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/dev/mypage-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('mypage-editorial-shell')).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const LONG_NAME = '김코코트립여행자 Alexandra Constantinescu-Papadopoulos 田中太郎안녕하세요';
    await page.locator('.mypage-editorial-name').evaluate((el: HTMLElement, name: string) => {
      el.textContent = name;
    }, LONG_NAME);

    const clip = await page.locator('.mypage-editorial-name').evaluate((el: HTMLElement) => {
      const style = getComputedStyle(el);
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    expect(
      clip.scrollWidth,
      `이름이 실제로 안 잘림 — scrollWidth=${clip.scrollWidth} clientWidth=${clip.clientWidth}`,
    ).toBeGreaterThan(clip.clientWidth);
    expect(clip.overflow).toBe('hidden');
    expect(clip.textOverflow).toBe('ellipsis');
    expect(clip.whiteSpace).toBe('nowrap');

    const profileHeight = await page.locator('.mypage-editorial-profile').evaluate(
      (el: HTMLElement) => Math.round(el.getBoundingClientRect().height));
    expect(
      profileHeight,
      `긴 이름 주입 후 프로필 카드 ${profileHeight}px > ${PROFILE_MAX_HEIGHT}px 예산`,
    ).toBeLessThanOrEqual(PROFILE_MAX_HEIGHT);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `가로 넘침 ${overflow}px`).toBeLessThanOrEqual(1);
  });

  test('desktop keeps the back link and tier benefits, phones do not', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'viewport is set by this matrix');

    await page.goto('/dev/mypage-editorial?__fixture=normal', { waitUntil: 'domcontentloaded' });

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator('.mypage-editorial-back')).toBeVisible();
    await expect(page.locator('.mypage-editorial-benefits')).toBeVisible();

    for (const viewport of MOBILE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.mypage-editorial-back')).toBeHidden();
      await expect(page.locator('.mypage-editorial-benefits')).toBeHidden();
    }
  });
});
