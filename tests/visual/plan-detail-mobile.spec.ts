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
 *   - {projectName} = mobile-375  (#1272 P2: colorScheme 만 다른 mobile-375-dark 는
 *     같은 DOM 을 렌더해 baseline 이 바이트 동일이라 삭제됐다 — playwright.visual.config.ts 주석)
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
 *
 * #1272 P2 (2026-08-10): "테스트 이름과 baseline 이 서로 다른 화면을 말한다" 해소.
 *   - 증상: T1 이름은 `header above the fold` 인데 Linux baseline 에는 공용 헤더가 없고
 *     플랜 제목도 위가 잘려 있었다. CI trace: 문서 scrollTop=169.
 *   - 원인: 제품 결함. SectionTabs 가 마운트 즉시 활성 탭을 scrollIntoView 로 끌어와
 *     — 탭 스트립이 폴드 아래(문서 y≈760~985)라 문서 전체가 170~220px 세로 이동했고,
 *     그 스크롤 도중 프레임이 캡처돼 sticky 헤더까지 잘려 보였다.
 *     → SectionTabs.tsx 에서 마운트 시 세로 스크롤을 없앴다(가로 정렬만).
 *   - 이 스펙 쪽 후속 2건:
 *     (a) T1 은 픽셀과 별개로 "문서 최상단 + 헤더가 클립 안" 을 직접 단정한다.
 *         baseline 만 갱신해서 스크롤된 화면을 정상으로 굳히는 일이 다시 생기지 않게.
 *     (b) T2 는 고정 clip 좌표(=특정 스크롤 상태를 전제) 대신 요약 카드·통계 칩의
 *         실측 좌표로 clip 을 만든다. 프로모 배너 높이·스크롤 위치가 바뀌어도 같은 것을 본다.
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
   * T1: 폴드 위(상단 320px) — 프로모 배너 · 공용 헤더 · 플랜 제목/지역.
   * P93 (모바일 탭 overflow) 같은 회귀가 이 영역에서 발생.
   *
   * 픽셀 비교 전에 위치를 먼저 단정한다(#1272 P2). 이름이 곧 계약이다:
   *   - 플랜을 열었을 때 문서는 최상단이어야 한다 (자동 스크롤 금지).
   *   - 공용 헤더는 캡처하는 320px 안에 온전히 들어와야 한다.
   * 이 두 줄은 OS·폰트와 무관하게 실패하므로, Linux baseline 을 갱신하는 것만으로는
   * 스크롤된 화면이 "정상" 으로 굳지 않는다.
   */
  test('header above the fold renders within viewport', async ({ page }) => {
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    const headerBox = await page.locator('header').first().boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.y).toBeGreaterThanOrEqual(0);
    expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(320);

    await expect(page).toHaveScreenshot('header-fold.png', {
      clip: { x: 0, y: 0, width: 375, height: 320 },
    });
  });

  /**
   * T2: 핵심 안내 카드(Optimize·Stay) + 날짜·장소·거리 통계 칩.
   *
   * clip 을 실측한다. 이전에는 viewport 고정 좌표(y 300~560)였는데, 그 값은
   * "SectionTabs 자동 스크롤로 문서가 169px 내려간 상태" 를 암묵 전제로 골라진 것이라
   * 스크롤 위치나 상단 프로모 배너 높이가 달라지면 다른 부위를 찍는다(#1272 P2).
   * 카드 첫 줄 ~ 통계 마지막 칩을 실제 좌표로 감싸면 위쪽 chrome 높이와 무관하게
   * 언제나 같은 것을 본다. 이 영역이 뷰포트를 벗어나면 clip 이 잘려 실패한다 —
   * 즉 "요약 카드가 폴드 안에 있다" 도 함께 잠긴다.
   *
   * 외부 장소 사진(DayTimeline)은 이 영역에 없다 — 네트워크 상태로 그림이 달라지지 않는다.
   */
  test('Trip summary metrics render correctly in middle region', async ({ page }) => {
    const firstCard = await page.locator('.plan-mobile-mini-panel').first().boundingBox();
    const lastStat = await page.locator('.plan-mobile-stat').last().boundingBox();
    expect(firstCard).not.toBeNull();
    expect(lastStat).not.toBeNull();
    const top = Math.round(firstCard!.y);
    const bottom = Math.round(lastStat!.y + lastStat!.height);
    // 폴드 안이어야 한다 — 벗어나면 clip 이 잘려 비교 자체가 무의미해진다.
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(812);

    await expect(page).toHaveScreenshot('summary-metrics.png', {
      clip: { x: 0, y: top, width: 375, height: bottom - top },
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
