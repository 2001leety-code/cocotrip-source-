import { expect, test } from './fixtures/analytics-guard';
import type { Page } from '@playwright/test';

const localBaseUrl = process.env.BASE_URL || '';
const runsAgainstLocalDev = /localhost|127\.0\.0\.1/.test(localBaseUrl);

async function prepareOfflineQuoteHarness(page: Page) {
  const leakedApiRequests: string[] = [];
  const blockedExternalRequests: string[] = [];

  await page.addInitScript(() => {
    window.localStorage.setItem('cocotrip_lang', 'ko');
    const testWindow = window as typeof window & { __moodQuoteClipboard?: string };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          testWindow.__moodQuoteClipboard = value;
        },
      },
    });
  });

  await page.route('**/api/**', async (route) => {
    leakedApiRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  // Firebase SDK가 로컬 허용 도메인을 묻는 초기 요청도 실제 외부로 보내지 않고 고정 응답한다.
  await page.route('https://www.googleapis.com/identitytoolkit/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizedDomains: ['localhost', '127.0.0.1'] }),
    });
  });
  await page.route(/https:\/\/(securetoken\.googleapis\.com|www\.paypal\.com|www\.paypalobjects\.com)\/.*/, async (route) => {
    blockedExternalRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });

  return { leakedApiRequests, blockedExternalRequests };
}

async function analyzeHarnessSchedule(page: Page) {
  const builder = page.getByTestId('mood-vehicle-quote-builder');
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel('업체 선택')).toHaveValue('mood-default');
  await expect(builder.getByLabel('업체 선택').locator('option')).toHaveCount(2);

  await builder.getByLabel('받은 일정 전체 붙여넣기').fill('2026년 9월 1일 오전 8시부터 오후 8시까지 차량 일정');
  await builder.getByRole('button', { name: '일정 분석' }).click();
  await expect(builder.getByRole('article')).toHaveCount(4);
  await expect(builder.getByLabel('총 이용시간(시간)')).toHaveValue('12');
  await builder.getByRole('button', { name: '시간·장소 확인 완료' }).click();
  return builder;
}

async function verifyEveryRouteAddress(builder: ReturnType<Page['getByTestId']>) {
  const stops = builder.getByRole('article');
  for (let index = 0; index < await stops.count(); index += 1) {
    await stops.nth(index).getByLabel('주소 확인 완료').check();
  }
}

async function assertEffectiveTouchTargets(builder: ReturnType<Page['getByTestId']>) {
  const undersized = await builder.locator('button, input, select, textarea, a[href]').evaluateAll((elements) => (
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      })
      .map((element) => {
        const input = element as HTMLInputElement;
        const target = input.type === 'checkbox' || input.type === 'radio'
          ? element.closest('label') || element
          : element;
        const box = target.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 50) || input.name || element.tagName,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        };
      })
      .filter((item) => item.width < 44 || item.height < 44)
  ));
  expect(undersized).toEqual([]);
}

async function assertSinglePageScroll(page: Page) {
  const nestedVerticalScrollers = await page.getByTestId('mood-vehicle-quote-builder').evaluate((builder) => (
    Array.from(builder.querySelectorAll<HTMLElement>('*'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      })
      .map((element) => element.getAttribute('data-testid') || element.getAttribute('aria-label') || element.tagName)
  ));
  expect(nestedVerticalScrollers).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('MOOD 관리자 업체별 차량 견적서', () => {
  test.skip(!runsAgainstLocalDev, '개발 전용 /mood/dev-ui 하네스에서만 실행합니다.');

  test('390px에서 붙여넣기부터 508,500원 견적과 정확한 전체 복사까지 한 화면 스크롤로 끝낸다', async ({ page }) => {
    const { leakedApiRequests, blockedExternalRequests } = await prepareOfflineQuoteHarness(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mood/dev-ui');

    const builder = await analyzeHarnessSchedule(page);
    const duration = builder.getByLabel('총 이용시간(시간)');
    await duration.fill('9');
    await duration.fill('');
    await duration.fill('6');
    await expect(duration).toHaveValue('6');
    await duration.fill('12');

    await verifyEveryRouteAddress(builder);
    await builder.getByLabel('거리 직접 입력').check();
    await builder.getByLabel('예상 거리(km)').fill('125');
    await builder.getByLabel('예상 통행료(원)').fill('20000');
    await builder.getByLabel('예상 주차비(원)').fill('10000');

    const previewButton = builder.getByRole('button', { name: '견적서 미리보기' });
    await expect(previewButton).toBeEnabled();
    await previewButton.click();

    const preview = builder.getByTestId('mood-vehicle-quote-preview');
    await expect(preview).toContainText('508,500원');
    await expect(preview).toContainText('차량 이용요금 공급가액: 435,000원');
    await expect(preview).toContainText('부가세 10%: 43,500원');
    await expect(page.getByTestId('mood-harness-quote-request')).toContainText('"totalMinutes":720');
    await expect(page.getByTestId('mood-harness-quote-request')).toContainText('"manualDistanceKm":125');

    const exactPreviewText = await preview.locator('pre').textContent();
    expect(exactPreviewText).toContain('부가세·통행료·주차비 포함 최종 예상 금액: 508,500원');
    await preview.getByRole('button', { name: '전체 일정·견적 복사' }).click();
    await expect(preview.getByRole('status')).toHaveText('복사했습니다.');
    const copiedText = await page.evaluate(() => (window as typeof window & { __moodQuoteClipboard?: string }).__moodQuoteClipboard || '');
    expect(copiedText).toBe(exactPreviewText);

    await page.emulateMedia({ media: 'print' });
    const printDocument = preview.locator('[data-mood-quote-print-document]');
    await expect(printDocument).toBeVisible();
    await expect(printDocument).toHaveText(exactPreviewText || '');
    await expect(builder.getByLabel('받은 일정 전체 붙여넣기')).toBeHidden();
    await expect(preview.getByRole('button', { name: '전체 일정·견적 복사' })).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    await assertEffectiveTouchTargets(builder);
    await assertSinglePageScroll(page);
    expect(leakedApiRequests).toEqual([]);
    expect(blockedExternalRequests).toEqual([]);
  });

  test('1280px에서도 업체 전환과 견적 입력이 가로 넘침 없이 동작한다', async ({ page }) => {
    const { leakedApiRequests, blockedExternalRequests } = await prepareOfflineQuoteHarness(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mood/dev-ui');

    const builder = await analyzeHarnessSchedule(page);
    await builder.getByLabel('업체 선택').selectOption('partner-demo');
    await expect(builder.getByLabel('업체 선택')).toHaveValue('partner-demo');
    await builder.getByLabel('업체 선택').selectOption('mood-default');
    await verifyEveryRouteAddress(builder);
    await builder.getByLabel('거리 직접 입력').check();
    await builder.getByLabel('예상 거리(km)').fill('125');
    await builder.getByLabel('예상 통행료(원)').fill('20000');
    await builder.getByLabel('예상 주차비(원)').fill('10000');
    await builder.getByRole('button', { name: '견적서 미리보기' }).click();

    await expect(builder.getByTestId('mood-vehicle-quote-preview')).toContainText('508,500원');
    await assertEffectiveTouchTargets(builder);
    await assertSinglePageScroll(page);
    expect(leakedApiRequests).toEqual([]);
    expect(blockedExternalRequests).toEqual([]);
  });
});
