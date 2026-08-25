import { expect, test } from './fixtures/analytics-guard';

const localBaseUrl = process.env.BASE_URL || '';
const runsAgainstLocalDev = /localhost|127\.0\.0\.1/.test(localBaseUrl);

test.describe('MOOD 예약 변경 경로 편집', () => {
  test.skip(!runsAgainstLocalDev, '개발 전용 /mood/dev-ui 하네스에서만 실행합니다.');

  test('모바일에서 버튼·키보드 재정렬 뒤 새 순서로 거리와 금액을 다시 계산한다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mood/dev-ui');
    await page.getByRole('button', { name: '예약 변경' }).click();
    await expect(page.getByText(/동선 64km/)).toBeVisible();

    const rows = page.getByTestId('mood-route-stop');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0).getByRole('textbox')).toHaveValue('서울역');
    await expect(rows.nth(1).locator('input[id$="-address"]')).toHaveValue('성수동');
    await expect(rows.nth(2).locator('input[id$="-address"]')).toHaveValue('잠실');
    await expect(rows.nth(4).getByRole('textbox')).toHaveValue('서울시청');

    await rows.nth(1).getByRole('button', { name: /시간 편집/ }).click();
    await rows.nth(1).getByLabel('도착 시각').fill('10:30');
    await rows.nth(1).getByRole('button', { name: '2시간' }).click();
    await expect(rows.nth(1).getByLabel('재출발(픽업) 시각')).toHaveValue('12:30');
    await expect(rows.nth(1).getByText(/대기 2시간/).first()).toBeVisible();
    await expect(page.getByLabel('이용 시간')).toHaveValue('4');

    await rows.nth(0).getByRole('button', { name: /시간 편집/ }).click();
    await expect(rows.nth(1).getByLabel('도착 시각')).toHaveCount(0);
    await rows.nth(0).getByLabel('출발 시각').fill('09:30');
    await expect(page.getByLabel('시작 시각')).toHaveValue('09:30');
    await rows.nth(0).getByRole('button', { name: /시간 접기/ }).click();

    await page.getByRole('button', { name: '전체 일정 복사' }).click();
    await expect(page.getByText(/전체 일정을 복사했습니다|전체 일정을 입력칸에 열었습니다/)).toBeVisible();

    const dndStatus = page.locator('[role="status"][aria-live="assertive"]');
    const keyboardHandle = rows.nth(1).getByRole('button', { name: /순서 이동/ });
    await expect(keyboardHandle).toHaveAttribute('aria-describedby', /DndDescribedBy-\d+ mood-route-reorder-help/);
    await keyboardHandle.focus();
    await page.keyboard.press('Space');
    await expect(keyboardHandle).toHaveAttribute('aria-pressed', 'true');
    await expect(dndStatus).toContainText('성수동 위치로 이동합니다');
    await page.keyboard.press('ArrowDown');
    await expect(dndStatus).toContainText('잠실 위치로 이동합니다');
    await page.keyboard.press('Space');

    await expect(rows.nth(1).getByRole('textbox')).toHaveValue('잠실');
    await expect(rows.nth(2).getByRole('textbox')).toHaveValue('성수동');
    await expect(page.getByRole('button', { name: '동선 계산을 기다려 주세요' })).toBeDisabled();
    await expect(page.getByText(/동선 71km/)).toBeVisible();
    await expect(page.getByText(/예상 통행료 9,000원/)).toBeVisible();

    await rows.nth(2).getByRole('button', { name: /시간 편집/ }).click();
    const moveUpButton = rows.nth(2).getByRole('button', { name: '위로 이동' });
    await expect(moveUpButton).toBeVisible();
    await expect(moveUpButton).toBeEnabled();
    await moveUpButton.click();

    await expect(rows.nth(1).locator('input[id$="-address"]')).toHaveValue('성수동');
    await expect(rows.nth(2).locator('input[id$="-address"]')).toHaveValue('잠실');
    await expect(page.getByRole('button', { name: '동선 계산을 기다려 주세요' })).toBeDisabled();
    await expect(page.getByText(/동선 64km/)).toBeVisible();
    await expect(page.getByText(/예상 통행료 8,000원/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
  });
});
