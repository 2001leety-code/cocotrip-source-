// ⚠️ test/expect 는 반드시 공용 analytics-guard 에서 — @playwright/test 에서 직접 가져오면
//    테스트 방문이 실제 GA4·PostHog 로 나가 운영 지표가 오염된다(mistake-lint R-P272).
import { test, expect } from './fixtures/analytics-guard';

// `/planner` 정적 본문(색인용) + 편집형 종이 셸 글자색 잠금 — 2026-08-06.
//
// 왜 이 스펙이 있나
//   ① GSC 실측에서 `/planner` 만 `Crawled – currently not indexed` 였다. 구글이 와서
//      보고 나서 색인을 거부한 것으로, 크롤러가 받는 `<main>` 본문이 939자뿐이었다
//      (위저드는 상호작용이라 1단계 껍데기만 프리렌더된다). 같은 조건에서 색인된
//      `/charter` 는 4,980자였다. → `PlannerSeoInfo` 로 정적 본문을 넣었다.
//   ② 과거 모바일만 밝은 셸로 칠하던 시기에 본문과 가격이 흰 배경에 흰 글씨가 됐다.
//      지금은 화면 전체가 공유 편집형 종이 셸을 쓰므로, 뷰포트와 상관없이 본문과
//      `AiPlannerPricingNote` 가 어두운 잉크를 유지해야 한다.
//
// 🔑 **대비를 DOM 으로 재면 이 버그가 안 잡힌다.** 투명 부모를 타고 올라가다 먼 조상의
//    어두운 배경을 집어 19:1 로 통과했다(실제로 그렇게 놓쳤다). 그래서 여기서는 배경을
//    추정하지 않고 **글자색 자체가 라이트 셸에 맞는 어두운 잉크인지**를 직접 잠근다.

/** WCAG 상대휘도 (0=검정, 1=흰색). */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3).map(Number);
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

test.describe('/planner 색인용 본문', () => {
  test.beforeEach(async ({ page }) => {
    // 첫 방문 안내 모달이 클릭·레이아웃을 가린다.
    await page.addInitScript(() => window.localStorage.setItem('COCO_AI_INTRO_SEEN_v1', '1'));
  });

  test('정적 본문과 FAQ 스키마가 실린다', async ({ page }) => {
    await page.goto('/planner');
    const seo = page.locator('.planner-seo-info');
    await expect(seo).toBeVisible();

    // 색인 거부의 직접 원인이 본문 분량이었다. 939자로 되돌아가면 실패해야 한다.
    // CJK 는 글자당 정보량이 커서 같은 내용도 짧게 나오므로 하한은 넉넉히 잡는다.
    // Long-form sections are intentionally collapsed to keep the transactional
    // page scannable. Crawlers consume the DOM text, not only the currently
    // painted summary, so pin the complete source rather than open-state UI.
    const chars = ((await seo.textContent()) || '').length;
    expect(chars, `본문 ${chars}자 — 색인 거부 당시가 939자였다`).toBeGreaterThan(900);

    // 화면 FAQ 와 구조화 데이터가 같은 배열에서 나오는지(문구 2벌 방지).
    const shown = await seo.locator('dt').count();
    expect(shown).toBeGreaterThan(0);
    const schema = await page.locator('script#planner-faq').textContent();
    expect(schema, 'FAQPage 스키마가 없다').toBeTruthy();
    const parsed = JSON.parse(schema as string);
    expect(parsed['@type']).toBe('FAQPage');
    expect(parsed.mainEntity).toHaveLength(shown);
  });

  test('핵심 장점 세 개만 먼저 보이고 상세 정보는 키보드로 연다', async ({ page }) => {
    await page.goto('/planner');

    const seo = page.locator('.planner-seo-info');
    await expect(seo.locator('.planner-highlights > li')).toHaveCount(3);

    const disclosures = seo.locator('details.planner-disclosure');
    await expect(disclosures).toHaveCount(5);
    await expect(disclosures.locator('summary h2')).toHaveCount(5);
    for (const disclosure of await disclosures.all()) {
      await expect(disclosure).not.toHaveAttribute('open', '');
    }

    await expect(page.locator('.planner-evidence-disclosure summary h2')).toHaveCount(1);

    const firstSummary = disclosures.first().locator('summary');
    await firstSummary.focus();
    await firstSummary.press('Enter');
    await expect(disclosures.first()).toHaveAttribute('open', '');

    const box = await firstSummary.boundingBox();
    expect(box, '상세 정보 버튼의 크기를 잴 수 없다').not.toBeNull();
    expect(box!.height, `상세 정보 버튼 높이가 ${box!.height}px다`).toBeGreaterThanOrEqual(44);
  });

  test('라우트를 떠나면 FAQ 스키마가 지워진다', async ({ page }) => {
    await page.goto('/planner');
    await expect(page.locator('script#planner-faq')).toHaveCount(1);

    // 안 지우면 다음 페이지의 구조화 데이터로 읽힌다.
    // 이 뷰포트에서 실제로 보이는 링크만 누른다(모바일은 하단탭, 데스크톱은 헤더).
    const link = page.locator('a[href="/charter"]:visible, a[href="/tours"]:visible').first();
    const href = await link.getAttribute('href');
    await link.click();
    await page.waitForURL(`**${href}`);
    await expect(page.locator('script#planner-faq')).toHaveCount(0);
    await expect(page.locator('.planner-seo-info')).toHaveCount(0);
  });

  test('모바일: 첫 질문이 첫 화면 안에 있다', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === 'Desktop Chrome',
      '데스크톱은 화면이 넓어 히어로와 위저드가 같이 보인다 — 모바일 한정 제약',
    );
    // 왜 잠그나 (2026-08-06): 6월 광고 유입 109명이 `/planner` 에 도착해 플랜 생성 0,
    // 체류 중앙값 10초로 이탈했다. 오류는 0건 — 못 쓴 게 아니라 안 썼다. 실측하니 첫 질문이
    // y=1369px, 화면 844px → 1.6 화면 아래였다. 마케팅 블록이 다시 위로 올라오면
    // 같은 상태로 되돌아가므로 위치 자체를 제약으로 박는다.
    await page.goto('/planner');
    const q = page.getByText(/Where are you in your trip planning|여행 계획.*어디|旅行の計画|旅行计划/i).first();
    await expect(q).toBeVisible();
    const box = await q.boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box, '첫 질문의 위치를 잴 수 없다').not.toBeNull();
    // boundingBox 는 뷰포트 기준이고 로드 직후 스크롤은 0 이므로 그대로 첫 화면 오프셋이다.
    expect(box!.y, `첫 질문이 y=${Math.round(box!.y)} — 화면(${vh}) 밖이다`).toBeLessThan(vh);
  });

  test('편집형 종이 셸에서 글자가 흰색이 아니다', async ({ page }) => {
    await page.goto('/planner');
    // Legacy `.planner-mobile-ai` was deleted when /planner moved to the
    // shared editorial shell. The page root is now the stable surface marker.
    await expect(page.locator('.ec-planner')).toBeVisible();

    const targets = [
      { sel: '.planner-seo-info li', what: '색인 본문' },
      { sel: '.planner-seo-info h2', what: '색인 본문 제목' },
      { sel: '.ai-planner-pricing-note li', what: '가격 안내' },
    ];
    for (const { sel, what } of targets) {
      const el = page.locator(sel).first();
      await expect(el, `${what} 요소가 없다`).toBeAttached();
      const color = await el.evaluate((n) => getComputedStyle(n).color);
      const lum = luminance(color);
      // 라이트 셸 배경(#fbfaff~#ffffff) 위에서 밝은 글씨는 읽히지 않는다.
      expect(lum, `${what}: color=${color} 가 라이트 배경에 너무 밝다`).toBeLessThan(0.5);
    }
  });
});
