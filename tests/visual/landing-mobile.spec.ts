/**
 * Visual regression — landing page (/) mobile + dark mode.
 *
 * Goal: P93 (모바일 탭 overflow) 같은 layout 회귀 + 다크 모드 contrast 회귀를
 * pixel-diff 로 PR 머지 전 차단. 본 spec 은 가장 단순한 첫 번째 baseline —
 * 추가 페이지 (wizard / plan-detail / payment) 는 후속 PR 로 점진 확장.
 *
 * Baseline location: tests/visual/landing-mobile.spec.ts-snapshots/
 *   - {projectName} = mobile-375  (#1272 P2: colorScheme 만 다른 mobile-375-dark 는
 *     같은 DOM 을 렌더해 baseline 이 바이트 동일이라 삭제됐다 — playwright.visual.config.ts 주석)
 *   - {testTitle} = "header above the fold remains within viewport"
 *
 * 첫 baseline 생성: README.md "Baseline 생성" 섹션 참조 (Docker 명령).
 */
import { test, expect } from '../e2e/fixtures/analytics-guard';
import { suppressCookieBanner, stubWeatherUnavailable } from './helpers';

test.describe('Landing page — mobile visual regression', () => {
  test.beforeEach(async ({ page }) => {
    // 쿠키 배너 사전 차단 (helpers.ts) — 현재 clip 은 상단 320px 라 직접
    // 영향 없지만, 대기 중 배너 1500ms 타이머를 넘겨 이후 clip 확장 시
    // 같은 flaky 재발 — 선제 차단.
    await suppressCookieBanner(page);

    // 날씨 칩 비결정성 차단 — wttr.in 응답이 빠른 run 에서만 칩이 렌더되어
    // baseline(칩 없음)과 diff (#1099 CI 2회 관측). goto 전에 등록.
    await stubWeatherUnavailable(page);

    // P233/P244 패턴 (plan-detail-mobile.spec.ts 와 동일): networkidle 은 SPA 에서
    // chronic flaky — analytics beacon / Sentry / 폰트·이미지 로딩이 "500ms 무요청"
    // 조건을 못 만들면 waitForLoadState 가 그대로 timeout (본 spec 의 로드 타임아웃
    // flake 원인). 아래 3단계 명시적 신호로 교체:
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // 1) hero headline 렌더 = lazy chunk (MobileHomeV2/MobileHome) 로드 +
    //    React 초기 렌더 완료 신호. 두 홈 변형 모두 h1 존재.
    await page.waitForSelector('h1', { state: 'visible', timeout: 20000 });

    // 2) clip (상단 320px) 에 걸리는 이미지 (로고·카테고리 아이콘) 디코드 완료.
    //    below-fold lazy 이미지는 로드가 시작조차 안 될 수 있어 clip 교차분만 검사.
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images).filter((img) => {
        const r = img.getBoundingClientRect();
        return r.bottom > 0 && r.top < 320 && r.width > 0;
      });
      return imgs.every((img) => img.complete && img.naturalWidth > 0);
    }, { timeout: 20000 });

    // 3) 웹폰트 적용 완료 — 폰트 swap 전 capture 는 kerning pixel diff.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // React 리렌더 정착 여유 (framer-motion 은 config animations:'disabled' 처리).
    await page.waitForTimeout(500);
  });

  test('header above the fold remains within viewport', async ({ page }) => {
    // Native screen fonts intentionally change glyph widths after the PDF-only
    // Noto split. Keep real layout checks alongside the reviewed Linux snapshot:
    // the image clip alone cannot prove that the complete headline is readable.
    const layout = await page.evaluate(() => {
      const header = document.querySelector('header');
      const heading = document.querySelector('h1');
      if (!header || !heading) return null;
      const headerRect = header.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      // Measure text fragments rather than the h1 box: a wide box may contain
      // harmless blank space, while a later line can be clipped below the image.
      const textRects: DOMRect[] = [];
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!(text.textContent || '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        textRects.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0));
      }
      const headingClips: { tag: string; horizontal: boolean; vertical: boolean }[] = [];
      // A glyph can extend beyond its line box with overflow:visible and remain
      // fully readable. Detect actual clipping at the h1 itself and its parents,
      // not scrollHeight > clientHeight alone (observed with native Linux fonts).
      for (let ancestor: HTMLElement | null = heading;
        ancestor && ancestor !== document.body && ancestor !== document.documentElement;
        ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'contents') continue;
        const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
        const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
        if (!clipsX && !clipsY) continue;
        const rect = ancestor.getBoundingClientRect();
        const scaleX = ancestor.offsetWidth > 0 ? rect.width / ancestor.offsetWidth : 1;
        const scaleY = ancestor.offsetHeight > 0 ? rect.height / ancestor.offsetHeight : 1;
        // Overflow clips at the padding box, not the outer border. Account for
        // ordinary axis-aligned scaling, but never treat viewport height as a
        // clipping ancestor: the document can legitimately scroll vertically.
        const left = rect.left + ancestor.clientLeft * scaleX;
        const top = rect.top + ancestor.clientTop * scaleY;
        const right = left + ancestor.clientWidth * scaleX;
        const bottom = top + ancestor.clientHeight * scaleY;
        const horizontal = clipsX && textRects.some((text) => text.left < left - 1 || text.right > right + 1);
        const vertical = clipsY && textRects.some((text) => text.top < top - 1 || text.bottom > bottom + 1);
        if (horizontal || vertical) headingClips.push({ tag: ancestor.tagName, horizontal, vertical });
      }
      return {
        // On mobile, innerWidth can grow with overflowing content and hide it.
        viewport: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        headerLeft: headerRect.left, headerRight: headerRect.right,
        headingLeft: headingRect.left, headingRight: headingRect.right,
        hasHeadingText: textRects.length > 0,
        headingClips,
      };
    });
    expect(layout, 'header and complete headline must exist').not.toBeNull();
    if (!layout) throw new Error('LANDING_LAYOUT_MISSING');
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.headerLeft).toBeGreaterThanOrEqual(-1);
    expect(layout.headerRight).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.headingLeft).toBeGreaterThanOrEqual(-1);
    expect(layout.headingRight).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.hasHeadingText, 'complete headline must contain visible text fragments').toBe(true);
    expect(layout.headingClips, 'headline text must fit its own and each hidden/clip ancestor padding box').toEqual([]);

    // viewport 안만 capture — full-page 는 동적 콘텐츠 (광고 / 추천 / 환율
    // 변동 가격) 가 매번 달라서 baseline 안정적이지 않음. above-the-fold
    // 영역이 P93 같은 layout 회귀의 가장 흔한 발생 지점.
    await expect(page).toHaveScreenshot('header-fold.png', {
      clip: { x: 0, y: 0, width: 375, height: 320 },
    });
  });
});
