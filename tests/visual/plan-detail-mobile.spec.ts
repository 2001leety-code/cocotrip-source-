/**
 * Visual regression — PlanDetailPage (/my-plans/:planId) mobile + dark mode.
 *
 * 목적: 5/26 P206-P210 cycle 머지 후 PlanDetailPage 시각 회귀 자동 차단.
 * 기존 landing-mobile.spec.ts 가 landing(/) 만 cover — PlanDetailPage 는 사각지대.
 * 5/26 "시각 검증 0" challenge 해소용 첫 PlanDetailPage baseline.
 *
 * 인증 방식: Firebase REST signInWithPassword → idToken 발급 →
 *   localStorage firebase:authUser:<apiKey>:[DEFAULT] inject
 *   (capture-5-plans-screenshots.mjs 의 동일 패턴).
 *
 * Baseline location: tests/visual/plan-detail-mobile.spec.ts-snapshots/
 *   - {projectName} = mobile-375 / mobile-375-dark
 *
 * 첫 baseline 생성: tests/visual/README.md "Baseline 생성" 섹션 참조 (Docker 명령).
 *
 * 운영자 후속:
 *   1. Docker 또는 WSL2 에서 --update-snapshots 로 baseline PNG 생성 후 commit.
 *   2. PDF_GOLDEN_PLAN_ID fixture 가 arrival_guide/departure_guide 포함하는지 확인.
 */
import { test, expect } from '@playwright/test';

// ─── Auth helper ──────────────────────────────────────────────────────────────
/**
 * Firebase REST signInWithPassword → idToken → localStorage inject.
 * env 누락 시 skip (테스트는 unauthenticated state 로 진행 — login redirect 포착).
 */
async function injectFirebaseAuth(page: { addInitScript: Function }) {
  const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY || '';
  const email = process.env.HEALTH_CHECK_EMAIL || '';
  const password = process.env.HEALTH_CHECK_PASSWORD || '';

  if (!apiKey || !email || !password) return; // env 누락 — skip auth inject

  const authRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const auth: Record<string, string> = await authRes.json();
  if (!auth.idToken) return; // auth fail — skip inject

  const session = {
    uid: auth.localId,
    email: auth.email,
    emailVerified: true,
    isAnonymous: false,
    providerData: [{ providerId: 'password', uid: auth.email, email: auth.email }],
    stsTokenManager: {
      refreshToken: auth.refreshToken,
      accessToken: auth.idToken,
      expirationTime: Date.now() + (Number(auth.expiresIn || 3600) * 1000),
    },
    createdAt: String(Date.now()),
    lastLoginAt: String(Date.now()),
    apiKey,
    appName: '[DEFAULT]',
  };

  // Firebase v10+ localStorage fallback key inject.
  await page.addInitScript(({ s, k }: { s: object; k: string }) => {
    try {
      const lsKey = `firebase:authUser:${k}:[DEFAULT]`;
      localStorage.setItem(lsKey, JSON.stringify(s));
    } catch {}
  }, { s: session, k: apiKey });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

const PLAN_ID = process.env.PDF_GOLDEN_PLAN_ID || 'd064bbc6-dbe9-4bed-9e06-8db77f27ab4b';

test.describe('PlanDetailPage — mobile visual regression', () => {
  test.beforeEach(async ({ page }) => {
    // Firebase auth inject 먼저 (page.goto 전에 addInitScript 해야 적용).
    await injectFirebaseAuth(page);

    await page.goto(`/my-plans/${PLAN_ID}`, { waitUntil: 'load' });
    // network idle 대기 — Firestore listener + framer-motion 안정화.
    await page.waitForLoadState('networkidle');
    // framer-motion 초기 animation 잔여 안정화.
    await page.waitForTimeout(800);
  });

  /**
   * T1: Header above-the-fold (상단 320px).
   * PlanDetailPage 의 Header + 플랜 제목 + SectionTabs 상단 영역.
   * P93 (모바일 탭 overflow) 같은 회귀가 이 영역에서 발생.
   */
  test('header above the fold renders within viewport', async ({ page }) => {
    await expect(page).toHaveScreenshot('header-fold.png', {
      clip: { x: 0, y: 0, width: 375, height: 320 },
    });
  });

  /**
   * T2: Day timeline 중간 영역 (300px~700px).
   * DayTimeline / StopCard 가 올바르게 렌더링되는지 확인.
   * 동적 콘텐츠 (광고 슬라이드) 를 피하고 itinerary card 위주 clip.
   */
  test('Day timeline renders correctly in middle region', async ({ page }) => {
    await expect(page).toHaveScreenshot('timeline-mid.png', {
      clip: { x: 0, y: 300, width: 375, height: 400 },
    });
  });

  /**
   * T3: Outro / Wrap-up 영역.
   * OutroSlide + footer 가 잘리지 않고 렌더링되는지 확인.
   * scrollIntoView 로 끌어내린 후 capture.
   */
  test('Wrap-up footer section renders without cutoff', async ({ page }) => {
    // 페이지 끝까지 스크롤해 Outro/Footer 를 viewport 안으로.
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(400); // scroll 완료 대기

    await expect(page).toHaveScreenshot('outro-fold.png', {
      // 현재 viewport 기준 하단 320px — Wrap-up + CTA 버튼 영역.
      clip: { x: 0, y: 812 - 320, width: 375, height: 320 },
    });
  });
});
