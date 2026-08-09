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
    // Vercel bypass — 쿠키 방식 (playwright.config.ts 와 동일, tests/global-setup.ts).
    // extraHTTPHeaders 가 cross-origin 폰트 CORS preflight 깨던 문제 해결(#1006).
    storageState: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? 'tests/.auth/vercel-bypass.json'
      : undefined,
  },
  globalSetup: './tests/global-setup.ts',
  projects: [
    // P93 회귀 viewport (모바일 탭 horizontal overflow). 375 = 가장 좁은 모바일
    // breakpoint — iPhone SE / 일반 Android 소형 기기 커버.
    //
    // #1272 P2 (2026-08-10): `mobile-375-dark`(colorScheme:'dark') 프로젝트를 삭제했다.
    //   이 앱의 테마 스위치는 `<html>` 의 `dark` 클래스 하나뿐이고(tailwind darkMode:["class"]),
    //   src/main.tsx 가 그것을 **무조건** 붙인다. `prefers-color-scheme` 를 읽는 코드는
    //   src/ 전체에 0건이다. `colorScheme` 는 그 미디어 특성만 바꾸므로 두 프로젝트가
    //   같은 DOM·같은 CSS 를 렌더했다 — baseline 4쌍 전부 light/dark SHA1 동일이었고,
    //   CI run 31332692514 의 actual 도 테스트별로 1장씩만 생성됐다(콘텐츠 dedup).
    //   즉 커버리지 0 에 CI 시간·스냅샷만 2배였고, 더 나쁘게는 "다크 시각 회귀 검사 중"
    //   이라는 거짓 안전감을 줬다.
    //   잠금: tests/unit/single-theme-no-fake-dark-1272.test.ts — 위 세 사실이 깨지는 날
    //   (라이트 모드 도입) 그 테스트가 실패해 진짜 테마 커버리지를 강제한다.
    //   다시 넣을 때 지켜야 할 것: `colorScheme` 이 아니라 `dark` 클래스를 토글할 것
    //   (addInitScript). 라이트 모드 활성화 절차는 src/index.css 상단 주석 +
    //   docs/DESIGN-LIGHT-MODE-PATH.md, 다크가 실제로 남아 있는 표면(데스크톱 본문·레거시
    //   페이지)은 docs/DESIGN-EDITORIAL-CONCIERGE.md 의 마이그레이션 표를 볼 것.
    {
      name: 'mobile-375',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
        colorScheme: 'light',
      },
    },
  ],
});
