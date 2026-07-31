import { test, expect } from '@playwright/test';

// SPA 내부 이동(실제 <Link> 클릭) 상시 감시 — daily-health 에서 운영 대상으로 돈다.
//
// 왜 이 스펙이 있나 (2026-08-01):
// "Link 클릭 시 URL 만 바뀌고 화면이 안 바뀐다"는 보고가 있었으나, 실 브라우저에선
// 재현되지 않았다. 원인은 검사 방법 — **숨겨진 브라우저 탭은 rAF 가 완전히 멈춰서**
// AnimatedRoutes(AnimatePresence mode="wait")의 0.18s exit 트윈이 영원히 안 끝나고,
// 그러면 모든 라우트 전환이 "고장"처럼 보인다. SPA 내비 검사는 반드시 rAF 가 살아있는
// 환경(Playwright·보이는 탭)에서 할 것. 콘솔 .click() 스니펫은 탭이 숨겨져 있으면 거짓 양성.
//
// 헤더 링크는 데스크탑 전용 (모바일은 하단 네비) — Desktop Chrome 프로젝트로만 실행.

test.describe('SPA Link navigation', () => {
  test('home → /tours via header Link', async ({ page }) => {
    await page.goto('/');
    await page.locator('header a[href="/tours"]').first().click();
    await expect(page).toHaveURL(/\/tours$/);
    await expect(page.locator('h1, h2').filter({ hasText: 'Tours' }).first()).toBeVisible({ timeout: 8000 });
  });

  test('/tours → detail via card Link', async ({ page }) => {
    await page.goto('/tours');
    const detail = page.locator('a[href^="/tours/"]').first();
    await detail.waitFor({ timeout: 10000 });
    const href = await detail.getAttribute('href');
    await detail.click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/[/\\]/g, '\\$&') + '$'));
    // 목록 페이지 고유 헤딩이 사라져야 상세로 전환된 것
    await expect(page.locator('h1, h2').filter({ hasText: 'Tours' })).toHaveCount(0, { timeout: 8000 });
  });

  test('/guide → guide detail via card Link', async ({ page }) => {
    await page.goto('/guide');
    const card = page.locator('a[href^="/guide/"]').first();
    await card.waitFor({ timeout: 10000 });
    await card.click();
    await expect(page).toHaveURL(/\/guide\/.+/);
    await expect(page.locator('.guide-article')).toBeVisible({ timeout: 8000 });
  });

  test('/community → /community/new via Link', async ({ page }) => {
    await page.goto('/community');
    const link = page.locator('a[href="/community/new"]').first();
    await link.waitFor({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/community\/new$/);
    // 작성 페이지는 로그인 여부와 무관하게 h1(composeTitle)을 항상 그린다
    await expect(page.locator('h1').filter({ hasText: 'Share with the community' })).toBeVisible({ timeout: 8000 });
  });
});
