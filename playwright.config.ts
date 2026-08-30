import { defineConfig, devices } from '@playwright/test';
import { resolvePlaywrightBaseUrl } from './tests/playwright-base-url';

// Note: previously imported `dotenv` for local .env loading, but the package
// was never declared in package.json — CI failed with ERR_MODULE_NOT_FOUND
// the first time pr-i18n-smoke ran (PRs #63-#66). For local .env support,
// run with `--env-file` (Node 20.6+) or prepend env vars on the command line.

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 2026-05-13 PR #409: CI workers 1 → 3 — pr-i18n-smoke timeout 영구 해소.
  // PR #397/#401/#406 모두 smoke 10-15분 timeout. 원인: serial 실행 (workers=1)
  // × 3 viewports (Desktop Chrome / Pixel 5 / iPhone 14 Pro) × 9 tests
  // (3 locales × 3 navigation tests) = 27 test invocations.
  // 캐시 hit + cold start 포함 한 viewport 당 ~4-5분 → 3 viewport 직렬 12-15분.
  // workers=3 으로 viewport 별 병렬 → ~4-5분 (서버 부하 분산). retries=2 이미 설정 = 안전.
  // GitHub Actions runner = 2-core 4GB — 3 worker 부하 감내 가능 (Playwright 가벼움).
  workers: process.env.CI ? 3 : undefined,
  reporter: [
    ['html', { open: 'never', outputFolder: 'tests/report' }],
    ['list'],
  ],
  use: {
    baseURL: resolvePlaywrightBaseUrl(),
    // Service worker fetch는 Playwright route를 우회할 수 있으므로 테스트에서는 막는다.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Vercel Deployment Protection bypass — 쿠키 방식 (tests/global-setup.ts).
    // 기존 extraHTTPHeaders 는 cross-origin(gstatic 폰트) 요청에도 헤더를 붙여
    // CORS preflight 가 거부 → 폰트 로드 실패로 visual/wizard spec fail (#1006).
    // globalSetup 이 1회 쿠키를 받아 storageState 로 저장, same-origin 만 인증.
    // secret = GH repo secret `VERCEL_AUTOMATION_BYPASS_SECRET`.
    // Docs: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection
    storageState: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? 'tests/.auth/vercel-bypass.json'
      : undefined,
  },
  globalSetup: './tests/global-setup.ts',
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Pixel 5', use: { ...devices['Pixel 5'] } },
    { name: 'iPhone 14 Pro', use: { ...devices['iPhone 14 Pro'] } },
  ],
});
