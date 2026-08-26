import { expect, test } from './fixtures/analytics-guard';
import type { Page } from '@playwright/test';

const localBaseUrl = process.env.BASE_URL || '';
const runsAgainstLocalDev = /localhost|127\.0\.0\.1/.test(localBaseUrl);

async function blockUnexpectedApiTraffic(page: Page) {
  const leakedApiRequests: string[] = [];
  await page.route('https://www.googleapis.com/identitytoolkit/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizedDomains: ['localhost', '127.0.0.1'] }),
    });
  });
  await page.route('**/api/**', async (route) => {
    leakedApiRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  return leakedApiRequests;
}

async function assertVisibleControlsAreTappable(page: Page) {
  const undersized = await page.getByRole('dialog').locator('button, input, select, textarea, summary, a[href]').evaluateAll((elements) => (
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        };
      })
      .filter((item) => item.width < 44 || item.height < 44)
  ));
  expect(undersized).toEqual([]);
}

test.describe('MOOD 예약 변경 경로 편집', () => {
  test.skip(!runsAgainstLocalDev, '개발 전용 /mood/dev-ui 하네스에서만 실행합니다.');

  test('390px 모바일에서 순서를 바꾸고 운영자 제안→MOOD 확인으로 한 번만 확정한다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const leakedApiRequests = await blockUnexpectedApiTraffic(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mood/dev-ui');
    await page.getByRole('button', { name: '예약 변경' }).click();
    await expect(page.getByText(/동선 64km/)).toBeVisible();
    await assertVisibleControlsAreTappable(page);

    const rows = page.getByTestId('mood-route-stop');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0).getByRole('textbox')).toHaveValue('서울역');
    await expect(rows.nth(1).locator('input[id$="-address"]')).toHaveValue('성수동');
    await expect(rows.nth(2).locator('input[id$="-address"]')).toHaveValue('잠실');
    await expect(rows.nth(4).getByRole('textbox')).toHaveValue('서울시청');

    await page.getByLabel(/변경 이유/).fill('촬영 순서 변경');
    const dndStatus = page.locator('[role="status"][aria-live="assertive"]');
    const keyboardHandle = rows.nth(1).getByRole('button', { name: /순서 이동/ });
    await keyboardHandle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await expect(dndStatus).toContainText('잠실 위치로 이동합니다');
    await page.keyboard.press('Space');

    await expect(rows.nth(1).getByRole('textbox')).toHaveValue('잠실');
    await expect(rows.nth(2).getByRole('textbox')).toHaveValue('성수동');
    await expect(page.getByRole('button', { name: '변경 내용과 금액 미리보기' })).toBeEnabled();
    await page.getByRole('button', { name: '변경 내용과 금액 미리보기' }).click();

    await expect(page.getByText(/동선 71km/)).toBeVisible();
    await expect(page.getByText(/예상 통행료 9,000원/)).toBeVisible();
    await expect(page.getByText('서버 금액 확인 완료')).toBeVisible();
    await expect(page.getByRole('button', { name: '111,000원 · MOOD 확인 요청' })).toBeEnabled();
    await page.getByRole('button', { name: '111,000원 · MOOD 확인 요청' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText('"action":"propose"');
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText(`"quoteId":"${'b'.repeat(64)}"`);
    await page.getByRole('button', { name: 'MOOD 승인자 보기' }).click();
    await page.getByRole('button', { name: '예약 변경' }).click();
    await expect(page.getByRole('heading', { name: '예약 변경 금액 확인' })).toBeVisible();
    await expect(page.getByText('기존 금액')).toBeVisible();
    await expect(page.getByText('제안 금액')).toBeVisible();
    await assertVisibleControlsAreTappable(page);
    await page.getByRole('button', { name: '111,000원 변경 내용 확인' }).click();
    await page.getByRole('button', { name: '111,000원 최종 확인' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText('"action":"approve"');
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText(`"quoteId":"${'b'.repeat(64)}"`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(leakedApiRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('PC와 모션 감소 환경에서도 44px 조작 크기, 6시간 단위 입력, 정적인 눌림 효과를 지킨다', async ({ page }) => {
    const leakedApiRequests = await blockUnexpectedApiTraffic(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mood/dev-ui');
    await page.getByRole('button', { name: '예약 변경' }).click();
    await assertVisibleControlsAreTappable(page);

    const duration = page.getByLabel('이용 시간');
    await duration.fill('');
    await duration.fill('6');
    await expect(duration).toHaveValue('6');
    await page.getByLabel(/변경 이유/).fill('총 예약시간 변경');
    await page.getByRole('button', { name: '변경 내용과 금액 미리보기' }).click();
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText('"durationHours":6');

    const proposalButton = page.getByRole('button', { name: '140,000원 · MOOD 확인 요청' });
    const motion = await proposalButton.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { transitionDuration: style.transitionDuration, transform: style.transform };
    });
    expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.00001);
    expect(motion.transform).toBe('none');

    await proposalButton.click();
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText('"durationHours":6');
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText('"action":"propose"');
    await page.getByRole('button', { name: 'MOOD 승인자 보기' }).click();
    await page.getByRole('button', { name: '예약 변경' }).click();
    await page.getByRole('button', { name: '140,000원 변경 내용 확인' }).click();
    await page.getByRole('button', { name: '140,000원 최종 확인' }).click();
    await expect(page.getByTestId('mood-harness-change-payload')).toContainText('"action":"approve"');
    expect(leakedApiRequests).toEqual([]);
  });
});
