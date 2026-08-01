// Smoke test for i18n coverage on key pages.
// For each non-English locale (ko/ja/zh), visit core pages and assert that
// representative UI elements render in the target language. The test is
// positive (translations resolved) rather than negative (no English visible),
// because brand names + proper nouns legitimately stay English.
//
// Run locally:   BASE_URL=http://localhost:5173 npx playwright test i18n-locale
// Run on prod:   npx playwright test i18n-locale  (uses default https://cocotripkr.com)
//
// PR #435 (2026-05-16): page.goto() now uses { waitUntil: 'domcontentloaded' }
// instead of the default 'load'. Prior failures showed "Target page, context
// or browser has been closed" on /charter or /about across all 3 retries —
// classic symptom of the per-test 60s timeout firing inside page.goto() while
// Vercel preview's late-loaded images/iframes finished. 'load' waits for ALL
// subresources; we only need DOM ready (the toContainText assertion has its
// own 10s expect timeout, so it'll naturally wait for the body to be ready).
// Side benefits: less flaky on cold-start previews, ~3-5s faster per test.

import { test, expect } from './fixtures/analytics-guard';

type Locale = 'ko' | 'ja' | 'zh';

const STORAGE_KEY = 'cocotrip_lang';

// Representative strings the user *must* see when locale is set.
// Keys mirror src/i18n/locales/<locale>.json paths so updates stay traceable.
//
// charterTitle uses regex with optional whitespace because the actual UI
// renders "전세차량 예약" (no space) while nav uses "전세 차량" (with space).
// We accept either form so the test isn't brittle to typography choices.
// 2026-07-13: charterTitle 을 /charter 실제 히어로(charterWizard.heroTitleWizard) 기준으로 수정 —
//   ko "한국 프라이빗 차량·밴 전세", ja "韓国プライベート車・バンチャーター".
//   기존 정규식(전세차량/チャーター車両)은 하단 내비의 '전세차량' 라벨이 우연히 매칭시켜 통과하던 것
//   (PR#1097 내비 개편에서 차터 탭 제거 → 모바일 뷰포트에서 표면화). homeNav 기대값도 새 내비
//   (홈·투어·AI플래너·예약·프로필)에 맞춤 — '전세차량' 제거.
const EXPECTATIONS: Record<Locale, { homeNav: string[]; aboutHeading: string; charterTitle: RegExp }> = {
  ko: {
    homeNav: ['홈', '투어', 'AI 플래너'],
    aboutHeading: 'COCOTRIP 소개',
    charterTitle: /차량·밴 전세|전세\s*차량/,
  },
  ja: {
    homeNav: ['ホーム', 'ツアー', 'AIプランナー'],
    aboutHeading: 'COCOTRIPについて',
    charterTitle: /チャーター/,
  },
  zh: {
    // nav.planner zh 실값 = 'AI规划师'(공백 없음) — 데스크톱 헤더 매칭용으로 정확히.
    homeNav: ['首页', '旅游', 'AI规划师'],
    aboutHeading: '关于 COCOTRIP',
    charterTitle: /包车/,
  },
};

// Use domcontentloaded so page.goto returns before all resources finish
// loading. The test's own expect.toContainText (10s default timeout) waits
// for the body to render translated strings — we don't need to block goto
// on iframes/lazy images/late ad scripts. See PR #435.
const GOTO_OPTS = { waitUntil: 'domcontentloaded' as const, timeout: 30_000 };

for (const locale of ['ko', 'ja', 'zh'] as Locale[]) {
  test.describe(`i18n: ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      // Set locale before any page load so detectInitialLanguage picks it up.
      await page.addInitScript(({ key, value }) => {
        try { window.localStorage.setItem(key, value); } catch {}
      }, { key: STORAGE_KEY, value: locale });
    });

    test('home navigation renders translated labels', async ({ page }) => {
      await page.goto('/', GOTO_OPTS);
      // Mobile bottom nav uses these labels — at least one should appear visibly.
      // We check for the union to allow the layout to differ between mobile/desktop.
      const expected = EXPECTATIONS[locale].homeNav;
      // Wait for any one of the expected labels to be present — gives the SPA
      // time to hydrate i18n. innerText after a static read would race with
      // React's first paint on slow cold-start previews.
      await expect(page.locator('body')).toContainText(expected[0], { timeout: 15_000 });
      const bodyText = await page.locator('body').innerText();
      const hits = expected.filter((label) => bodyText.includes(label));
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    test('/about page heading is translated', async ({ page }) => {
      await page.goto('/about', GOTO_OPTS);
      const expected = EXPECTATIONS[locale].aboutHeading;
      // Don't assert exact heading text (responsive layouts may add suffixes);
      // assert the translated brand-line appears somewhere on the page.
      await expect(page.locator('body')).toContainText(expected, { timeout: 15_000 });
    });

    test('/charter page title is translated', async ({ page }) => {
      await page.goto('/charter', GOTO_OPTS);
      const expected = EXPECTATIONS[locale].charterTitle;
      await expect(page.locator('body')).toContainText(expected, { timeout: 15_000 });
    });
  });
}
