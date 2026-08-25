import { expect, test } from './fixtures/analytics-guard';

const localBaseUrl = process.env.BASE_URL || '';
const runsAgainstLocalDev = /localhost|127\.0\.0\.1/.test(localBaseUrl);

test.describe('MOOD 예약 변경 경로 편집', () => {
  test.skip(!runsAgainstLocalDev, '개발 전용 /mood/dev-ui 하네스에서만 실행합니다.');

  test('모바일에서 드래그·키보드 재정렬 뒤 새 순서로 거리와 금액을 다시 계산한다', async ({ page }) => {
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
    await expect(rows.nth(1).getByRole('textbox')).toHaveValue('성수동');
    await expect(rows.nth(2).getByRole('textbox')).toHaveValue('잠실');
    await expect(rows.nth(4).getByRole('textbox')).toHaveValue('서울시청');

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

    const sourceHandle = rows.nth(2).getByRole('button', { name: /순서 이동/ });
    const targetRow = rows.nth(1);
    await sourceHandle.scrollIntoViewIfNeeded();
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetRow.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (!sourceBox || !targetBox) throw new Error('드래그 좌표를 계산하지 못했습니다.');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(rows.nth(1).getByRole('textbox')).toHaveValue('성수동');
    await expect(rows.nth(2).getByRole('textbox')).toHaveValue('잠실');
    await expect(page.getByRole('button', { name: '동선 계산을 기다려 주세요' })).toBeDisabled();
    await expect(page.getByText(/동선 64km/)).toBeVisible();
    await expect(page.getByText(/예상 통행료 8,000원/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
  });
});
