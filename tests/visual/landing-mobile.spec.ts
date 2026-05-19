/**
 * Visual regression — landing page (/) mobile + dark mode.
 *
 * Goal: P93 (모바일 탭 overflow) 같은 layout 회귀 + 다크 모드 contrast 회귀를
 * pixel-diff 로 PR 머지 전 차단. 본 spec 은 가장 단순한 첫 번째 baseline —
 * 추가 페이지 (wizard / plan-detail / payment) 는 후속 PR 로 점진 확장.
 *
 * Baseline location: tests/visual/landing-mobile.spec.ts-snapshots/
 *   - {projectName} = mobile-375 / mobile-375-dark
 *   - {testTitle} = "header above the fold remains within viewport"
 *
 * 첫 baseline 생성: README.md "Baseline 생성" 섹션 참조 (Docker 명령).
 */
import { test, expect } from '@playwright/test';

test.describe('Landing page — mobile visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    // Network 정착 + framer-motion 초기 animation 종료 대기.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('header above the fold remains within viewport', async ({ page }) => {
    // viewport 안만 capture — full-page 는 동적 콘텐츠 (광고 / 추천 / 환율
    // 변동 가격) 가 매번 달라서 baseline 안정적이지 않음. above-the-fold
    // 영역이 P93 같은 layout 회귀의 가장 흔한 발생 지점.
    await expect(page).toHaveScreenshot('header-fold.png', {
      clip: { x: 0, y: 0, width: 375, height: 320 },
    });
  });
});
