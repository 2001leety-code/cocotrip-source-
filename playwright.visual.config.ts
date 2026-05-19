import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression config — distinct from `playwright.config.ts` (e2e).
 *
 * Why a separate config:
 *   - testDir scoped to `tests/visual/` so e2e workers don't run snapshot tests
 *   - chromium-only (single engine = stable pixel-baseline; webkit fonts drift)
 *   - retries=0 (re-rendering a flaky test masks real regressions)
 *   - tighter snapshot threshold (1% pixel diff cap) — P93 모바일 탭 overflow
 *     같은 layout 회귀가 sub-percent 만으로도 잡히도록.
 *
 * Baseline OS dependency: snapshot 파일은 generation OS (font rendering)에
 * 묶임. CI = Ubuntu (mcr.microsoft.com/playwright:noble image). 운영자 로컬
 * generation 은 같은 image 안에서 (Docker) 또는 WSL2 ubuntu 환경에서 실행해야
 * pixel-match. Windows native 에서는 baseline 안 만들기. README 참조.
 */
export default defineConfig({
  testDir: './tests/visual',
  timeout: 60000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      // P93 같은 layout overflow 는 sub-percent 픽셀 diff 로 충분히 잡힘.
      // anti-alias / font kerning 미세 차이는 0.5% 이하라 1% cap 안전.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      // CSS transition / framer-motion 도 freeze — 결정론적 capture.
      caret: 'hide',
    },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { open: 'never', outputFolder: 'tests/visual-report' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://cocotripkr.com',
    trace: 'retain-on-failure',
    // Vercel Pro Deployment Protection bypass — playwright.config.ts 와 동일.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : undefined,
  },
  projects: [
    // P93 회귀 viewport (모바일 탭 horizontal overflow). 375 = 가장 좁은 모바일
    // breakpoint — iPhone SE / 일반 Android 소형 기기 커버.
    {
      name: 'mobile-375',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
        colorScheme: 'light',
      },
    },
    // 다크 모드 — color contrast / 가독성 회귀 (P-pattern 후보).
    {
      name: 'mobile-375-dark',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
        colorScheme: 'dark',
      },
    },
  ],
});
