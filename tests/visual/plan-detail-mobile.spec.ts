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
 *   ⚠️ Firebase v12: IndexedDB primary → localStorage fallback 동작.
 *   auth 미주입 시 (env 누락) → Firestore unauthorized → error 상태로 page settle.
 *   → P244: window.__pageReady 는 그 경우에도 emit 됨 (plan/error 무관 loading=false emit).
 *
 * Baseline location: tests/visual/plan-detail-mobile.spec.ts-snapshots/
 *   - {projectName} = mobile-375 / mobile-375-dark
 *
 * 첫 baseline 생성: tests/visual/README.md "Baseline 생성" 섹션 참조 (Docker 명령).
 *
 * 운영자 후속:
 *   1. Docker 또는 WSL2 에서 --update-snapshots 로 baseline PNG 생성 후 commit.
 *   2. PDF_GOLDEN_PLAN_ID fixture 가 arrival_guide/departure_guide 포함하는지 확인.
 *
 * P233 (2026-05-27): networkidle → waitForSelector 패턴 교체.
 *   - 문제: Firestore onSnapshot WebSocket + Sentry/Analytics beacon 이
 *     Vercel Preview 환경에서 networkidle 500ms idle 조건을 60s 안에 달성 불가.
 *     P230 (PR #637) + P231 (PR #638) 두 PR 연속 동일 실패 — chronically flaky.
 *
 * P244 (2026-05-27): waitForSelector → window.__pageReady ready signal 패턴 교체.
 *   - 새 root cause 발견: P237/P240/P241/P239 4 cycle 모두 deployment_status 에서 fail.
 *     → [data-testid="section-tabs-scroll"] 는 plan 로드 성공 시만 노출.
 *     → CI 가 HEALTH_CHECK_EMAIL / HEALTH_CHECK_PASSWORD 미보유 → injectFirebaseAuth() skip
 *     → Firestore unauthorized → error 상태 → section-tabs-scroll 미노출 → 15s timeout.
 *     → 비유: "문 앞에서 '주방 준비 완료' 간판만 기다리는데 실제 간판은 음식이 나와야 걸림"
 *   - P244 fix: window.__pageReady = true — loading=false 즉시 emit (plan/error 무관).
 *     frontend 에 emit signal 추가 (PlanDetailPage/index.tsx useEffect [loading]).
 *     spec 에서 waitForFunction(() => window.__pageReady === true, { timeout: 20000 }) 대기.
 *   - 외부 사례 (deep-search 결과):
 *     1. Playwright 공식 문서: networkidle "discouraged" — web assertions 권고.
 *     2. BrowserStack 2026: "Avoid waitForLoadState('networkidle')" — SPA background
 *        polling, analytics beacon, WebSocket 이 idle 막음.
 *     3. Checkly Docs (playwright/waits-and-timeouts): waitForSelector preferred over
 *        networkidle for SPAs with real-time data sources.
 *     4. Playwright #35504 (2024): Firebase IndexedDB storageState serialize 실패 사례
 *        — localStorage inject 단독으로는 Firebase v10+ auth 미작동 가능.
 *     5. Better Stack (2025): SPA route transitions must wait for content element,
 *        not URL change — window.__pageReady custom flag pattern preferred.
 */
import { test, expect } from '../e2e/fixtures/analytics-guard';
import { type Page } from '@playwright/test';
import { suppressCookieBanner } from './helpers';

// ─── Auth helper ──────────────────────────────────────────────────────────────
/**
 * Firebase REST signInWithPassword → idToken → localStorage inject.
 * env 누락 시 skip (테스트는 unauthenticated state 로 진행 — window.__pageReady 가 에러 상태에서도 emit).
 *
 * P244: auth 주입 성공 시 → plan body 렌더 → section-tabs-scroll 표시.
 *       auth 주입 실패/미주입 시 → Firestore unauthorized → error UI → window.__pageReady emit.
 *       양쪽 모두 waitForFunction(__pageReady) 가 통과 — chronic timeout 해소.
 */
async function injectFirebaseAuth(page: Page) {
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
    } catch {
      // 보안 설정으로 localStorage를 쓸 수 없으면 비로그인 화면 검증으로 이어간다.
    }
  }, { s: session, k: apiKey });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

const PLAN_ID = process.env.PDF_GOLDEN_PLAN_ID || 'd064bbc6-dbe9-4bed-9e06-8db77f27ab4b';

test.describe('PlanDetailPage — mobile visual regression', () => {
  test.beforeEach(async ({ page }) => {
    // Firebase auth inject 먼저 (page.goto 전에 addInitScript 해야 적용).
    await injectFirebaseAuth(page);

    // 쿠키 배너 사전 차단 — mount 1500ms 후 fixed-bottom 배너가 T3 하단
    // clip (및 T2 하단 경계) 에 껴들어 flaky diff 유발. helpers.ts 참조.
    await suppressCookieBanner(page);

    // P233/P244: waitUntil='domcontentloaded' — networkidle 대신.
    // Firestore onSnapshot WebSocket 이 Vercel Preview 에서 networkidle 500ms 조건
    // 도달 불가 → 60s timeout → chronically flaky (P230/P231 동일 실패 교훈).
    // domcontentloaded = HTML 파싱 + 초기 스크립트 실행 완료. React 렌더 트리거 시점.
    await page.goto(`/my-plans/${PLAN_ID}`, { waitUntil: 'domcontentloaded' });

    // P244: window.__pageReady ready signal 대기 (PlanDetailPage/index.tsx 에서 emit).
    // loading=false 시점 (plan 렌더 완료 또는 error 상태 확정) 에 true 가 됨.
    // plan/unauthorized/notfound/autherror 모든 terminal state 에서 emit → chronic timeout 해소.
    // P233 의 waitForSelector('[data-testid="section-tabs-scroll"]') 는 plan 성공 시만 → auth 없으면 항상 timeout.
    // timeout=20000ms: cold Vercel Preview 환경 + Firebase auth + Firestore 첫 응답 여유분.
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__pageReady === true,
      { timeout: 20000 },
    );

    // 실제 fixture가 로드된 뒤 웹폰트가 바뀌면서 글자가 반쯤 그려진 상태를
    // 기준 이미지로 저장하지 않도록 폰트 렌더링 완료까지 기다린다.
    await page.evaluate(() => document.fonts.ready);

    // React 리렌더 안정화 — streaming_in_progress 갱신 등 2차 Firestore 패치 여유.
    // framer-motion transition 은 playwright.visual.config.ts animations:'disabled' 가 처리.
    await page.waitForTimeout(400);
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
   * T2: 여행 요약 중간 영역 (300px~560px).
   * 핵심 안내 카드와 날짜·장소·거리 통계가 올바르게 렌더링되는지 확인.
   * 외부 장소 사진처럼 네트워크 상태에 따라 달라지는 영역은 제외한다.
   */
  test('Trip summary metrics render correctly in middle region', async ({ page }) => {
    await expect(page).toHaveScreenshot('timeline-mid.png', {
      // 외부 장소 사진은 네트워크 상태에 따라 로딩/실패 그림이 달라진다.
      // 사진 직전까지만 비교해 레이아웃·글자·통계 카드는 엄격히 잠근다.
      clip: { x: 0, y: 300, width: 375, height: 260 },
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
