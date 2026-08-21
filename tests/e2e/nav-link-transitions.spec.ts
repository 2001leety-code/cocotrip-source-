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
// 예전에는 헤더 링크를 딱 집어서, Pixel 5·iPhone 프로젝트로 돌리면 그 링크가 없어
// **거짓 실패**가 났다(실측: nav-link-transitions 2건 fail). daily-health 는 `--project='Desktop
// Chrome'` 로만 돌려 초록이었지만, 프로젝트 지정 없이 `npx playwright test` 를 돌리면 빨갛다.
// 🔴 해결은 mobile skip 이 아니다 — 그러면 진짜 모바일 내비 결함을 못 잡는다.
//   대신 **그 뷰포트에서 실제로 보이는 링크**를 고른다. 데스크톱에선 헤더를, 모바일에선
//   하단 탭바를 누르게 되어 세 프로젝트 모두 자기 화면의 진짜 내비를 검사한다.
//
// ───────────────────────────────────────────────────────────────────────────────
// 🔴 도착 판정은 **경로 + 구조(testid)** 로만 한다 (2026-08-21, daily-health 5연속 빨강).
//
//   이 스펙은 화면 문구로 도착을 판정하다가 8/12~8/21 야간 검사를 5번 연속 죽였다.
//   문구는 4개 언어 × 마케팅 수정마다 바뀌므로 테스트 계약이 될 수 없고, 스타일
//   클래스도 마찬가지다(디자인 개편에서 이름이 갈린다). 실제로 깨진 셋:
//     (1) `/tours` 도착을 h1/h2 속 영어 단어 "Tours" 로 판정 → 에디토리얼 개편에서
//         h1 이 `tl.pageTitle`("Choose the way you travel Korea" 등)로 바뀌며 영구 실패.
//     (2) 가이드 본문을 `.guide-article` 로 판정 → 본문 클래스가 `.ec-prose` 로
//         갈아끼워지며 영구 실패(그 CSS 블록은 죽은 채 index.css 에 남아 있었다).
//     (3) 투어 상세 전환을 "'Tours' 헤딩 0개" 로 판정 → (1) 때문에 그 헤딩은 **목록
//         화면에도 원래 0개**라 내비가 완전히 죽어도 초록. 거짓 초록 = 검사 없음보다 나쁨.
//
//   그래서 규칙 둘:
//     · 도착·이탈은 `getByTestId` 로 짚는다(경로는 URL 로 따로 확인).
//     · **"사라졌다"(toHaveCount(0)) 는 같은 testid 의 "보인다"를 클릭 전에 확인한 뒤에만**
//       쓴다. 안 그러면 (3)처럼 공허하게 통과한다.
//   이 두 규칙은 `tests/unit/nav-smoke-selectors-guard.test.ts` 가 소스에서 잠근다.
// ───────────────────────────────────────────────────────────────────────────────

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
    // 카탈로그 셸 + 카드 그리드가 그려져야 "목록 화면이 실제로 왔다"는 뜻이다.
    await expect(page.getByTestId('tours-editorial-shell')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('tours-grid')).toBeVisible({ timeout: 8000 });
  });

  test('/tours → detail via card Link', async ({ page }) => {
    await page.goto('/tours');
    // 클릭 전에 목록 셸이 **있다**는 것을 먼저 확인한다 — 이게 있어야 아래
    // "목록 셸이 사라졌다" 단언이 공허하지 않다(2026-08-21 사고의 핵심).
    await expect(page.getByTestId('tours-editorial-shell')).toBeVisible({ timeout: 10000 });
    const detail = page.locator('a[href^="/tours/"]').first();
    await detail.waitFor({ timeout: 10000 });
    const href = await detail.getAttribute('href');
    await detail.click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/[/\\]/g, '\\$&') + '$'));
    await expect(page.getByTestId('tour-detail-shell')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('tour-detail-heading')).toBeVisible({ timeout: 8000 });
    // 목록 셸이 언마운트돼야 전환이 실제로 일어난 것(URL 만 바뀐 게 아니다).
    await expect(page.getByTestId('tours-editorial-shell')).toHaveCount(0, { timeout: 8000 });
  });

  test('/guide → guide detail via card Link', async ({ page }) => {
    await page.goto('/guide');
    const card = page.locator('a[href^="/guide/"]').first();
    await card.waitFor({ timeout: 10000 });
    await card.click();
    await expect(page).toHaveURL(/\/guide\/.+/);
    // 본문 <article> 은 status==='ready' 일 때만 그려진다 —
    // 이게 보이면 글이 실제로 도착해 렌더된 것이다(로딩·404·에러 화면과 구분된다).
    await expect(page.getByTestId('guide-article')).toBeVisible({ timeout: 8000 });
  });

  test('/community → /community/new via Link', async ({ page }) => {
    await page.goto('/community');
    // 헤더의 글쓰기 버튼은 `hidden sm:inline-flex` 라 모바일에선 안 보인다.
    // 모바일은 인트로 섹션의 글쓰기 버튼을 쓴다 — 보이는 것을 고르면 양쪽 다 검사된다.
    const link = visibleLink(page, '/community/new');
    await link.waitFor({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/community\/new$/);
    // 작성 페이지 머리글은 로그인 여부와 무관하게 항상 그려진다(본문만 갈린다).
    await expect(page.getByTestId('community-compose-heading')).toBeVisible({ timeout: 8000 });
  });

  // 구조화 데이터는 라우트를 떠나면 사라져야 한다 (2026-08-01, 유입 묶음 D).
  // 남으면 다음 페이지의 스키마로 읽혀 "가이드 글이 아닌 페이지에 Article" 같은
  // 거짓 마크업이 구글에 간다. SPA 이동이라 실 브라우저에서만 검증된다.
  //
  // 여기 `script#guide-article` 은 JSON-LD 태그의 id(useJsonLd 가 붙인다)로,
  // 위 본문 testid 와는 다른 것이다. 이 검사는 소멸 전에 존재(count 1)를 먼저
  // 확인하므로 공허하지 않다.
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
