import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

type FixtureState = 'normal' | 'empty' | 'error' | 'not-found' | 'permission' | 'partial' | 'truncated' | 'loading';
type FixtureLanguage = 'ko' | 'en' | 'ja' | 'zh';

const VIEWPORTS = [
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1440', width: 1440, height: 1000 },
] as const;
const LANGUAGES: FixtureLanguage[] = ['ko', 'en', 'ja', 'zh'];
const STATES: FixtureState[] = ['normal', 'empty', 'error', 'not-found', 'permission', 'partial', 'truncated', 'loading'];
const NEUTRAL_TILE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f2efe8"/></svg>';

const copy = {
  ko: { title: '서울 2일 실행 일정', theme: '도심과 한강', stop: '경복궁', nextStop: '북촌한옥마을', note: '지하철 조회 결과를 확인하세요.' },
  en: { title: 'Two days in Seoul', theme: 'City and river', stop: 'Gyeongbokgung Palace', nextStop: 'Bukchon Hanok Village', note: 'Check the measured subway leg.' },
  ja: { title: 'ソウル2日間の実行日程', theme: '都心と漢江', stop: '景福宮', nextStop: '北村韓屋村', note: '地下鉄の検索結果を確認してください。' },
  zh: { title: '首尔两日执行行程', theme: '市区与汉江', stop: '景福宫', nextStop: '北村韩屋村', note: '请查看地铁查询结果。' },
} as const;

function expectedDayLabel(language: FixtureLanguage): string {
  if (language === 'ko') return '1일차';
  if (language === 'ja') return '1日目';
  if (language === 'zh') return '第1天';
  return 'Day 1';
}

function planFixture(language: FixtureLanguage, state: FixtureState) {
  const text = copy[language];
  const days = state === 'empty'
    ? []
    : [{
        day: 1,
        date: '2026-09-12',
        city: language === 'ko' ? '서울' : language === 'ja' ? 'ソウル' : language === 'zh' ? '首尔' : 'Seoul',
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
            _userAdded: true,
          },
          {
            start_time: '11:10',
            stay_min: 70,
            category: 'culture',
            display_name: text.nextStop,
            address: '37 Gyedong-gil, Jongno-gu, Seoul',
            lat: 37.5826,
            lng: 126.983,
            transit_from_prev: {
              method: 'subway',
              est_min: 20,
              fare: 1500,
              transfers: 0,
              walk_min: 6,
            },
          },
        ],
      }];

  return {
    id: `fixture-${state}-${language}`,
    isPublic: true,
    status: state === 'error' ? 'error' : 'ready',
    _streaming_in_progress: state === 'partial',
    _streaming_progress: state === 'partial' ? 2 : undefined,
    __truncated: state === 'truncated',
    input: {
      language,
      area: language === 'ko' ? '서울' : language === 'ja' ? 'ソウル' : language === 'zh' ? '首尔' : 'Seoul',
      regions: ['seoul'],
      startDate: '2026-09-12',
      adults: 2,
    },
    itinerary: { tour_title: text.title, days },
  };
}

async function installLanguage(page: Page, language: FixtureLanguage) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('cocotrip_lang', value);
    window.localStorage.setItem('coco_promo_banner_dismissed_v1', 'true');
  }, language);
}

async function fulfillPlan(route: Route, language: FixtureLanguage, state: FixtureState) {
  if (state === 'loading') return new Promise<void>(() => {});
  if (state === 'not-found') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  if (state === 'permission') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, plan: planFixture(language, state) }),
  });
}

for (const viewport of VIEWPORTS) {
  for (const language of LANGUAGES) {
    test(`${viewport.label}px ${language} renders every plan-detail state`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installLanguage(page, language);
      let activeState: FixtureState = 'normal';
      await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: '',
      }));
      await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204 }));
      await page.route('**://*.basemaps.cartocdn.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: NEUTRAL_TILE,
      }));
      await page.route('**/api/get-plan?**', (route) => fulfillPlan(route, language, activeState));
      await page.route('**/local-plans/editorial-owner.json', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(planFixture(language, 'normal')),
      }));
      await page.route('**/api/reviews', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reviews: [] }),
      }));

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailures: string[] = [];
      const unexpectedOwnOriginResponses: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          const source = message.location().url;
          consoleErrors.push(source ? `${message.text()} [${source}]` : message.text());
        }
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('requestfailed', (request) => {
        const pageOrigin = page.url().startsWith('http') ? new URL(page.url()).origin : '';
        if (pageOrigin && new URL(request.url()).origin === pageOrigin) {
          requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
        }
      });
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.origin !== new URL(page.url()).origin || response.status() < 400) return;
        const expectedPlanState = url.pathname === '/api/get-plan'
          && ((activeState === 'not-found' && response.status() === 404)
            || (activeState === 'permission' && response.status() === 403));
        if (!expectedPlanState) unexpectedOwnOriginResponses.push(`${response.status()} ${url.pathname}`);
      });

      for (const state of STATES) {
        activeState = state;
        const consoleStart = consoleErrors.length;
        await page.goto(`/my-plans/fixture-${state}-${viewport.label}-${language}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        const expectedStateTestId = state === 'normal' || state === 'truncated'
          ? 'plan-document-ready'
          : `plan-detail-${state}`;
        await expect(page.getByTestId(expectedStateTestId)).toBeVisible();

        if (['empty', 'error', 'not-found', 'permission'].includes(state)) {
          await expect(page.getByTestId(`plan-detail-${state}`).locator('.ec-card .ec-root')).toHaveCount(0);
        }

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);

        if (state === 'truncated') {
          await expect(page.getByTestId('plan-document-status-partial')).toBeVisible();
        }

        if (state === 'normal') {
          await expect(page.getByTestId('plan-document-masthead')).toContainText(copy[language].title);
          await expect(page.getByTestId('plan-document-masthead')).not.toContainText(/AI itinerary|AI 일정|AI 旅程|AI 行程/);
          const tabs = page.getByTestId('section-tabs-scroll').getByRole('tab');
          const tabHeights = await tabs.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
          expect(tabHeights.length).toBeGreaterThan(1);
          expect(tabHeights.every((height) => height >= 44)).toBe(true);

          const dayTab = page.getByTestId('section-tabs-scroll').getByRole('tab').nth(1);
          await expect(dayTab).toHaveText(expectedDayLabel(language));
          await dayTab.click();
          const routeMap = page.getByTestId('day-route-map');
          await expect(routeMap).toBeVisible();
          await expect(routeMap).toContainText(copy[language].nextStop);
          const routeControlHeights = await routeMap.locator('[data-route-map-control], .leaflet-control-zoom a').evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
          expect(routeControlHeights.length).toBeGreaterThan(0);
          expect(routeControlHeights.every((height) => height >= 44)).toBe(true);

          const firstStop = page.getByRole('button', { name: new RegExp(copy[language].stop) }).first();
          await expect(firstStop).toBeVisible();
          await firstStop.click();
          await expect(firstStop).toHaveAttribute('aria-expanded', 'true');

          const dayOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(dayOverflow).toBeLessThanOrEqual(1);

          const tabCount = await tabs.count();
          await tabs.nth(tabCount - 2).click();
          const preTripSlide = page.getByTestId('plan-pre-trip-slide');
          await expect(preTripSlide).toBeVisible();
          const preTripHeadingStyle = await preTripSlide.locator('h2').evaluate((heading) => {
            const style = window.getComputedStyle(heading);
            return { color: style.color, backgroundImage: style.backgroundImage };
          });
          expect(preTripHeadingStyle).toEqual({ color: 'rgb(20, 20, 26)', backgroundImage: 'none' });

          await tabs.nth(tabCount - 1).click();
          const outroSlide = page.getByTestId('plan-outro-slide');
          await expect(outroSlide).toBeVisible();
          const outroHeadingStyle = await outroSlide.locator('h2').evaluate((heading) => {
            const style = window.getComputedStyle(heading);
            return { color: style.color, backgroundImage: style.backgroundImage };
          });
          expect(outroHeadingStyle).toEqual({ color: 'rgb(20, 20, 26)', backgroundImage: 'none' });
          const outroActionHeights = await outroSlide.locator(':scope > div.mt-8 button, :scope > div.mt-8 a').evaluateAll(
            (actions) => actions.map((action) => action.getBoundingClientRect().height),
          );
          expect(outroActionHeights.length).toBeGreaterThanOrEqual(3);
          expect(outroActionHeights.every((height) => height >= 44)).toBe(true);

          const hostname = new URL(page.url()).hostname;
          if (hostname === '127.0.0.1' || hostname === 'localhost') {
            await page.goto('/my-plans/editorial-owner?localPlan=editorial-owner', { waitUntil: 'domcontentloaded' });
            await expect(page.getByTestId('plan-document-ready')).toBeVisible();
            await page.getByTestId('section-tabs-scroll').getByRole('tab').nth(1).click();

            const editToggle = page.getByTestId('plan-edit-toggle');
            await expect(editToggle).toBeVisible();
            expect((await editToggle.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
            await editToggle.click();

            if (viewport.width < 640) {
              const mobileControls = page.getByTestId('plan-stop-mobile-edit-controls').first();
              const userAdded = page.getByTestId('plan-stop-user-added').first();
              const ownerFirstStop = page.getByRole('button', { name: new RegExp(copy[language].stop) }).first();
              await expect(mobileControls).toBeVisible();
              await expect(userAdded).toBeVisible();
              const controlsBox = await mobileControls.boundingBox();
              const userAddedBox = await userAdded.boundingBox();
              const stopBox = await ownerFirstStop.boundingBox();
              expect(controlsBox).not.toBeNull();
              expect(userAddedBox).not.toBeNull();
              expect(stopBox).not.toBeNull();
              expect((controlsBox?.y || 0) + (controlsBox?.height || 0)).toBeLessThanOrEqual((userAddedBox?.y || 0) + 1);
              expect((userAddedBox?.y || 0) + (userAddedBox?.height || 0)).toBeLessThanOrEqual((stopBox?.y || 0) + 1);
            }

            await page.getByTestId('plan-add-stop').click();

            const modal = page.getByTestId('plan-add-stop-modal');
            await expect(modal).toBeVisible();
            const fieldMetrics = await modal.locator('input').evaluateAll((fields) => fields.map((field) => {
              const style = window.getComputedStyle(field);
              return {
                fontSize: Number.parseFloat(style.fontSize),
                height: field.getBoundingClientRect().height,
              };
            }));
            expect(fieldMetrics.length).toBe(4);
            expect(fieldMetrics.every(({ fontSize, height }) => fontSize >= 16 && height >= 44)).toBe(true);

            const modalButtonHeights = await modal.locator('button:visible').evaluateAll(
              (buttons) => buttons.map((button) => button.getBoundingClientRect().height),
            );
            expect(modalButtonHeights.length).toBeGreaterThan(1);
            expect(modalButtonHeights.every((height) => height >= 44)).toBe(true);
            await expect(page.getByTestId('plan-add-stop-scrim')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.45)');
            await page.keyboard.press('Escape');
            await expect(modal).toBeHidden();
          }
        }

        const stateConsoleErrors = consoleErrors.slice(consoleStart);
        const expectedStatus = state === 'not-found' ? 404 : state === 'permission' ? 403 : null;
        const unexpectedConsoleErrors = stateConsoleErrors.filter((message) => (
          expectedStatus === null || !message.includes(`status of ${expectedStatus}`)
        ));
        expect(unexpectedConsoleErrors).toEqual([]);
      }

      expect(pageErrors).toEqual([]);
      expect(requestFailures).toEqual([]);
      expect(unexpectedOwnOriginResponses).toEqual([]);
    });
  }
}
