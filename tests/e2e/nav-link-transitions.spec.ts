// ⚠️ test/expect 는 반드시 공용 analytics-guard 에서 — @playwright/test 에서 직접 가져오면
//    테스트 방문이 실제 GA4·PostHog 로 나가 운영 지표가 오염된다(mistake-lint R-P272).
//    타입만 가져오는 것은 허용된다.
import { type Page } from '@playwright/test';
import { test, expect } from './fixtures/analytics-guard';

// SPA 내부 이동(실제 <Link> 클릭) 상시 감시 — daily-health 에서 운영 대상으로 돈다.
//
// 왜 이 스펙이 있나 (2026-08-01):
// "Link 클릭 시 URL 만 바뀌고 화면이 안 바뀐다"는 보고가 있었으나, 실 브라우저에선
// 재현되지 않았다. 원인은 검사 방법 — **숨겨진 브라우저 탭은 rAF 가 완전히 멈춰서**
// AnimatedRoutes(AnimatePresence mode="wait")의 0.18s exit 트윈이 영원히 안 끝나고,
// 그러면 모든 라우트 전환이 "고장"처럼 보인다. SPA 내비 검사는 반드시 rAF 가 살아있는
// 환경(Playwright·보이는 탭)에서 할 것. 콘솔 .click() 스니펫은 탭이 숨겨져 있으면 거짓 양성.
//
// 뷰포트별 내비게이션 위치가 다르다 (2026-08-02):
//   데스크톱 = 상단 헤더 링크 / 모바일 = 하단 탭바(MobileBottomNav).
// 예전에는 `header a[...]` 를 딱 집어서, Pixel 5·iPhone 프로젝트로 돌리면 그 링크가 없어
// **거짓 실패**가 났다(실측: nav-link-transitions 2건 fail). daily-health 는 `--project='Desktop
// Chrome'` 로만 돌려 초록이었지만, 프로젝트 지정 없이 `npx playwright test` 를 돌리면 빨갛다.
// 🔴 해결은 mobile skip 이 아니다 — 그러면 진짜 모바일 내비 결함을 못 잡는다.
//   대신 **그 뷰포트에서 실제로 보이는 링크**를 고른다. 데스크톱에선 헤더를, 모바일에선
//   하단 탭바를 누르게 되어 세 프로젝트 모두 자기 화면의 진짜 내비를 검사한다.

/** 이 뷰포트에서 실제로 보이는 첫 링크 — 데스크톱 헤더/모바일 하단탭 양쪽을 자연히 커버. */
function visibleLink(page: Page, href: string) {
  return page.locator(`a[href="${href}"]:visible`).first();
}

test.describe('SPA Link navigation', () => {
  test('home → /tours via nav Link', async ({ page }) => {
    await page.goto('/');
    const link = visibleLink(page, '/tours');
    await link.waitFor({ timeout: 10000 });
    await link.click();
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
    // 헤더의 글쓰기 버튼은 `hidden sm:inline-flex` 라 모바일에선 안 보인다.
    // 모바일은 인트로 섹션의 글쓰기 버튼을 쓴다 — 보이는 것을 고르면 양쪽 다 검사된다.
    const link = visibleLink(page, '/community/new');
    await link.waitFor({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/community\/new$/);
    // 작성 페이지는 로그인 여부와 무관하게 h1(composeTitle)을 항상 그린다
    await expect(page.locator('h1').filter({ hasText: 'Share with the community' })).toBeVisible({ timeout: 8000 });
  });

  // 구조화 데이터는 라우트를 떠나면 사라져야 한다 (2026-08-01, 유입 묶음 D).
  // 남으면 다음 페이지의 스키마로 읽혀 "가이드 글이 아닌 페이지에 Article" 같은
  // 거짓 마크업이 구글에 간다. SPA 이동이라 실 브라우저에서만 검증된다.
  test('가이드 상세를 떠나면 Article JSON-LD 가 사라진다', async ({ page }) => {
    await page.goto('/guide');
    const card = page.locator('a[href^="/guide/"]').first();
    await card.waitFor({ timeout: 10000 });
    await card.click();
    await expect(page.locator('script#guide-article')).toHaveCount(1, { timeout: 8000 });

    await page.locator('a[href="/guide"]').first().click();
    await expect(page).toHaveURL(/\/guide$/);
    await expect(page.locator('script#guide-article')).toHaveCount(0, { timeout: 8000 });
    // 목록에도 빵부스러기는 남아 있어야 한다(그 페이지 자신의 것).
    await expect(page.locator('script#guide-breadcrumb')).toHaveCount(1);
  });
});
