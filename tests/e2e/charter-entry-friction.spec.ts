/**
 * /charter 첫 진입 마찰 + 단계 계측 회귀 (2026-08-01).
 *
 * 배경(실측): GA4 30일 `charter_quote_start` 14명 → `charter_quote_complete` 0명.
 * 첫 진입 화면을 실제로 열어보니 쿠키 배너(z-10001)가 인트로 모달(z-9999)의 기본 버튼을
 * 덮고 있었다. 돈이 들어오는 페이지의 첫인상이 "겹친 팝업 두 개"였던 셈이다.
 *
 * 여기서 지키는 것: **동의를 정하기 전에는 인트로 모달이 자동으로 뜨지 않는다**(겹침 자체가 안 생긴다).
 *
 * 같이 넣은 `charter_step` 계측은 여기서 검증하지 않는다 — dev 에는 GA 측정 ID 가 없어
 * (`VITE_GA_MEASUREMENT_ID` 미설정 → `canSendToGA()` false) 아무것도 전송되지 않는다.
 * 로컬에서 억지로 통과시키면 "전송된 척" 하는 가짜 증거가 된다. 배포 후 GA4 에서 실제
 * `charter_step` 이벤트를 조회해 확인한다.
 */
import { test, expect } from '@playwright/test';

test.describe('/charter 첫 진입', () => {
  test('쿠키 동의 전에는 인트로 모달이 안 뜬다 (겹침 방지)', async ({ page }) => {
    await page.goto('/charter');
    await page.locator('button').filter({ hasText: /^Accept$/ }).first().waitFor({ timeout: 15000 });
    // 모달 자동 노출 타이머(350ms)보다 넉넉히 기다려도 떠 있으면 안 된다.
    await page.waitForTimeout(2500);
    await expect(page.locator('[role="dialog"][aria-labelledby="charter-intro-title"]')).toHaveCount(0);
  });

  test('동의를 정하면 그때 인트로 모달이 뜬다', async ({ page }) => {
    await page.goto('/charter');
    const accept = page.locator('button').filter({ hasText: /^Accept$/ }).first();
    await accept.waitFor({ timeout: 15000 });
    await accept.click();
    await expect(page.locator('[role="dialog"][aria-labelledby="charter-intro-title"]'))
      .toBeVisible({ timeout: 8000 });
  });
});
