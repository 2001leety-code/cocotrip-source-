// Smoke test for i18n coverage on key pages.
// For each non-English locale (ko/ja/zh), visit core pages and assert that
// representative UI elements render in the target language. The test is
// positive (translations resolved) rather than negative (no English visible),
// because brand names + proper nouns legitimately stay English.
//
// Run locally:   BASE_URL=http://localhost:5173 npx playwright test i18n-locale
// Run on prod:   npx playwright test i18n-locale  (uses default https://cocotripkr.com)

import { test, expect } from '@playwright/test';

type Locale = 'ko' | 'ja' | 'zh';

const STORAGE_KEY = 'cocotrip_lang';

// Representative strings the user *must* see when locale is set.
// Keys mirror src/i18n/locales/<locale>.json paths so updates stay traceable.
const EXPECTATIONS: Record<Locale, { homeNav: string[]; aboutHeading: string; charterTitle: string }> = {
  ko: {
    homeNav: ['홈', '투어', '전세차량', 'AI 플래너'],
    aboutHeading: 'COCOTRIP 소개',
    charterTitle: '전세 차량',
  },
  ja: {
    homeNav: ['ホーム', 'ツアー', 'チャーター車両', 'AIプランナー'],
    aboutHeading: 'COCOTRIPについて',
    charterTitle: 'チャーター車両',
  },
  zh: {
    homeNav: ['首页', '旅游', '包车', 'AI 规划师'],
    aboutHeading: '关于 COCOTRIP',
    charterTitle: '包车',
  },
};

for (const locale of ['ko', 'ja', 'zh'] as Locale[]) {
  test.describe(`i18n: ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      // Set locale before any page load so detectInitialLanguage picks it up.
      await page.addInitScript(({ key, value }) => {
        try { window.localStorage.setItem(key, value); } catch {}
      }, { key: STORAGE_KEY, value: locale });
    });

    test('home navigation renders translated labels', async ({ page }) => {
      await page.goto('/');
      // Mobile bottom nav uses these labels — at least one should appear visibly.
      // We check for the union to allow the layout to differ between mobile/desktop.
      const expected = EXPECTATIONS[locale].homeNav;
      const bodyText = await page.locator('body').innerText();
      const hits = expected.filter((label) => bodyText.includes(label));
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    test('/about page heading is translated', async ({ page }) => {
      await page.goto('/about');
      const expected = EXPECTATIONS[locale].aboutHeading;
      // Don't assert exact heading text (responsive layouts may add suffixes);
      // assert the translated brand-line appears somewhere on the page.
      await expect(page.locator('body')).toContainText(expected);
    });

    test('/charter page title is translated', async ({ page }) => {
      await page.goto('/charter');
      const expected = EXPECTATIONS[locale].charterTitle;
      await expect(page.locator('body')).toContainText(expected);
    });
  });
}
