// ⚠️ test/expect 는 반드시 공용 analytics-guard 에서 — @playwright/test 에서 직접 가져오면
//    테스트 방문이 실제 GA4·PostHog 로 나가 운영 지표가 오염된다(mistake-lint R-P272).
import { test, expect } from './fixtures/analytics-guard';

/**
 * `/tours` 공개 목록 — 실제 렌더 geometry 회귀 잠금 (2026-08-11).
 *
 * #1279/#1280 이후 프로덕션에 남아 있던 P3 4건을 **브라우저가 실제로 그린 결과**로 잰다.
 * 클래스 문자열은 tests/unit/tours-catalog-editorial.component.test.tsx 가 보고,
 * 여기서는 픽셀만 본다 — jsdom 은 레이아웃을 계산하지 않아 44px 도 2줄도 증명하지 못한다.
 *
 *   P3-1 카드 제목이 잘리지 않고(최대 2줄) 카드끼리 제목 높이가 같다
 *   P3-2 조작 가능한 칩·버튼이 전부 44px 이상
 *   P3-3 공개 필터에 Popular/인기/人気/热门 칩이 0개
 *   P3-4 ko/ja/zh 카드에 NIGHT/NATURE/HISTORY/MULTI-CITY/Fuel/Tolls/Parking 영어 누출 0
 *
 * 12조합 = 390 / 768 / 1440 × ko / en / ja / zh.
 * 결제·예약은 누르지 않는다 — 읽기와 측정만 한다.
 */

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
type Lang = (typeof LANGS)[number];

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

/** 터치 최소치. `--ec-touch-min` (docs/DESIGN-EDITORIAL-CONCIERGE.md §3) 과 같은 값. */
const TOUCH_MIN = 44;

/** 공개 필터에 있으면 안 되는 칩 라벨. 정확 일치 — en 의 'Popular Destinations' 섹션 제목은 대상이 아니다. */
const POPULAR_CHIP = ['Popular', '인기', '人気', '热门'];

/** ko/ja/zh 카드에 남으면 안 되는 영어 원문. en 에서는 정상 문구다. */
const ENGLISH_LEAK: RegExp[] = [
  /\bNIGHT\b/,
  /\bNATURE\b/,
  /\bHISTORY\b/,
  /MULTI-?\s?CITY/i,
  /\bFuel\b/,
  /\bTolls\b/,
  /\bParking\b/,
  /\bTips\b/,
];

/** 이 페이지가 책임지는 조작 컨트롤. 공용 헤더/하단 네비는 shared-navigation 단계 소관이라 제외. */
const CONTROL_SELECTOR = [
  '[data-testid="tours-region-rail"] button',
  '[data-testid="tours-filter-panel"] button',
  '[data-testid="tours-filter-panel"] select',
  '[data-testid="tours-filter-panel"] input',
  '[data-testid="tours-grid"] button',
  '[data-testid="tours-inquire-cta"]',
  '[data-testid="tours-hotel-cta"]',
].join(', ');

test.describe('/tours 공개 목록 — 편집형 정리 (제목·터치·필터·현지화)', () => {
  for (const vp of VIEWPORTS) {
    for (const lang of LANGS) {
      test(`${vp.width}px × ${lang}`, async ({ page }, testInfo) => {
        // 뷰포트를 테스트별로 직접 지정하므로 기기 프로젝트 3개에서 중복 실행할 필요가 없다.
        test.skip(testInfo.project.name !== 'Desktop Chrome', '뷰포트 직접 지정 — 한 프로젝트에서만 실행');

        await page.setViewportSize({ width: vp.width, height: vp.height });

        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(String(err)));

        await page.addInitScript((l) => {
          window.localStorage.setItem('cocotrip_lang', l);
        }, lang);
        await page.goto('/tours', { waitUntil: 'domcontentloaded' });

        const grid = page.getByTestId('tours-grid');
        await expect(grid).toBeVisible();
        await expect(page.getByTestId('tours-filter-panel')).toBeVisible();

        // ── 전체 문서형 셸: 이전 refined 다크 목록으로 되돌아가지 않는다 ───────────
        const shell = page.getByTestId('tours-editorial-shell');
        await expect(shell).toBeVisible();
        await expect(shell).toHaveClass(/\bec-root\b/);
        await expect(shell).toHaveClass(/\btours-catalog-editorial\b/);
        await expect(page.locator('main').getByTestId('tours-grid')).toBeVisible();

        const shellPaint = await shell.evaluate((element) => {
          const style = getComputedStyle(element);
          return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
        });
        expect(shellPaint.backgroundImage, '페이지 장식용 gradient가 다시 들어왔다').toBe('none');
        expect(shellPaint.backgroundColor, '이전 다크 배경이 다시 들어왔다').not.toBe('rgb(10, 4, 18)');

        const semanticGroups = page.getByTestId('tours-filter-panel').locator('fieldset');
        expect(await semanticGroups.count(), '제목 없는 필터 묶음이 남았다').toBeGreaterThanOrEqual(4);
        expect(await page.getByTestId('tours-filter-panel').locator('legend').count()).toBe(
          await semanticGroups.count(),
        );

        const destinationHeading = page.locator('#tours-destinations-title');
        await expect(destinationHeading).toBeVisible();
        expect((await destinationHeading.innerText()).trim()).not.toMatch(/Popular Destinations|인기 목적지|人気の目的地|热门目的地/);
        expect(await page.locator('.tour-catalog-card-link button').count()).toBe(0);
        const wishlistIconColor = await grid.locator('.tour-catalog-card-wishlist svg').first().evaluate(
          (element) => getComputedStyle(element).color,
        );
        expect(wishlistIconColor, '흰 카드 위에서 위시리스트 하트가 사라진다').not.toMatch(/255,\s*255,\s*255/);

        const firstCardLink = grid.locator('.tour-catalog-card-link').first();
        await firstCardLink.focus();
        const cardFocusPaint = await firstCardLink.evaluate((element) => {
          const cardStyle = getComputedStyle(element.closest('.tour-catalog-card') as HTMLElement);
          const linkStyle = getComputedStyle(element);
          return { cardShadow: cardStyle.boxShadow, linkShadow: linkStyle.boxShadow };
        });
        expect(
          cardFocusPaint.cardShadow !== 'none' || cardFocusPaint.linkShadow !== 'none',
          '투어 카드 링크의 키보드 초점 표시가 카드 경계에서 잘린다',
        ).toBe(true);

        const imageCount = grid.locator('.tour-catalog-card-image-count').first();
        if (await imageCount.count()) {
          await expect(imageCount).toHaveAttribute('aria-label', /\D+\d+|\d+\D+/);
        }
        expect(await grid.locator('.tour-catalog-card-facts dt .sr-only').first().count()).toBe(1);

        const firstDestination = page.getByTestId('tours-region-rail').locator('button').first();
        await firstDestination.focus();
        const focusPaint = await firstDestination.evaluate((element) => {
          const style = getComputedStyle(element);
          return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
        });
        expect(
          focusPaint.outlineStyle !== 'none' || focusPaint.boxShadow !== 'none',
          '키보드 초점 표시가 보이지 않는다',
        ).toBe(true);

        // ── P3-1 제목: 2줄 안에 다 들어가고, 카드끼리 제목 높이가 같다 ────────────────
        const titles = await grid.locator('h3').evaluateAll((els) =>
          els.map((el) => ({
            text: (el.textContent || '').trim(),
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            lineHeight: parseFloat(getComputedStyle(el).lineHeight) || 0,
            clamp: getComputedStyle(el).webkitLineClamp,
          })),
        );
        expect(titles.length, '카드 제목을 하나도 못 찾았다').toBeGreaterThan(0);

        for (const t of titles) {
          expect(t.clamp, `"${t.text}" line-clamp=${t.clamp} — 2줄이 아니다`).toBe('2');
          expect(
            t.scrollHeight,
            `"${t.text}" 제목이 잘렸다 (scrollHeight=${t.scrollHeight} > clientHeight=${t.clientHeight})`,
          ).toBeLessThanOrEqual(t.clientHeight + 1);
          expect(
            t.clientHeight,
            `"${t.text}" 제목 영역이 2줄보다 낮다 (${t.clientHeight} < ${t.lineHeight * 2})`,
          ).toBeGreaterThanOrEqual(t.lineHeight * 2 - 1);
        }

        const heights = [...new Set(titles.map((t) => Math.round(t.clientHeight)))];
        expect(
          heights,
          `카드마다 제목 높이가 다르다(${heights.join('/')}) — 그리드 정렬이 제목 길이에 흔들린다`,
        ).toHaveLength(1);

        // ── P3-2 터치 영역 ────────────────────────────────────────────────────────
        const small = await page.locator(CONTROL_SELECTOR).evaluateAll(
          (els, min) =>
            els
              .map((el) => {
                const r = el.getBoundingClientRect();
                return {
                  label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                };
              })
              // 화면에 안 그려진 것(숨김·조건부)은 터치 대상이 아니다.
              .filter((c) => c.w > 0 && c.h > 0)
              .filter((c) => c.h < min || c.w < min),
          TOUCH_MIN,
        );
        expect(
          small,
          `44px 미만 컨트롤: ${small.map((c) => `${c.label}(${c.w}×${c.h})`).join(', ')}`,
        ).toEqual([]);

        // ── P3-3 근거 없는 Popular 칩 0 + AI-CURATED / Best Value 0 ───────────────
        const chipLabels = await page
          .locator('button.tour-chip')
          .evaluateAll((els) => els.map((el) => (el.textContent || '').trim()));
        expect(chipLabels.length, '필터 칩을 하나도 못 찾았다').toBeGreaterThan(0);
        for (const banned of POPULAR_CHIP) {
          expect(chipLabels, `공개 필터에 '${banned}' 칩이 있다`).not.toContain(banned);
        }

        const bodyText = await page.locator('body').innerText();
        expect(bodyText, 'AI-CURATED 공개 노출').not.toMatch(/AI-?\s?CURATED/i);
        expect(bodyText, 'Best Value 공개 노출').not.toMatch(/BEST\s?VALUE/i);

        // ── P3-4 현지화: ko/ja/zh 카드에 영어 원문 0 ───────────────────────────────
        const gridText = await grid.innerText();
        if (lang !== 'en') {
          for (const leak of ENGLISH_LEAK) {
            expect(gridText, `${lang} 카드에 영어 누출: ${leak}`).not.toMatch(leak);
          }
        }

        // 정당한 태그는 계속 보인다 — 진실성 청소가 상품 정보를 지우면 안 된다.
        const legitTag: Record<Lang, RegExp> = {
          ko: /역사·문화|자연|다도시|야경/,
          en: /HISTORY|NATURE|MULTI-CITY|NIGHT/,
          ja: /歴史・文化|自然|複数都市|夜景/,
          zh: /历史文化|自然|多城市|夜景/,
        };
        expect(gridText, `${lang}: 정당한 태그 배지가 하나도 없다`).toMatch(legitTag[lang]);

        // 가격 의미 불변 — 카드에 USD 표시가 그대로 있다.
        expect(gridText, '카드 가격 표시가 사라졌다').toMatch(/\$\s?\d/);
        expect(gridText).toContain('USD');

        // ── 가로 넘침 0 + JS 예외 0 ───────────────────────────────────────────────
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(
          scrollWidth,
          `document.scrollWidth=${scrollWidth} > viewport ${vp.width} — 페이지 가로 넘침`,
        ).toBeLessThanOrEqual(vp.width + 1);

        expect(pageErrors, `JS 예외 발생: ${pageErrors.join(', ')}`).toHaveLength(0);
      });
    }
  }
});
