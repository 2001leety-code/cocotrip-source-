// ⚠️ test/expect 는 반드시 공용 analytics-guard 에서 — @playwright/test 에서 직접 가져오면
//    테스트 방문이 실제 GA4·PostHog 로 나가 운영 지표가 오염된다(mistake-lint R-P272).
import { test, expect } from './fixtures/analytics-guard';

// #1276 P2 회귀 잠금 (운영 검증 2026-08-11, PROD-VERIFY-1276-FINDINGS):
// `/tours` 신뢰 배지 레일에서 24/7 → "Weekdays 10am–6pm" 로 문구를 정정하며 폭이 늘어나,
// en 390px 첫 화면에서 지원시간 배지가 42%만 보였다(ko 92%/zh 82%/ja 74% 도 부분 잘림).
// 배지 컨테이너를 flex-nowrap+overflow-x-auto(가로 스크롤 필요) 에서 모바일 한정
// flex-wrap 으로 바꿔 셋째 배지가 안 맞으면 다음 줄로 내려가게 했다 — 문구·순서·색상은 그대로.
//
// 이 스펙은 순수 DOM geometry 로 회귀를 잠근다(class 문자열이 아니라 실제 렌더 위치).
// 768/1440 은 원래도 배지가 한 줄에 다 들어가 flex-wrap 이 트리거되지 않아야 한다(기존 레이아웃 유지).

const LANGS = ['en', 'ko', 'ja', 'zh'] as const;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

test.describe('/tours 신뢰 배지 레일 — 지원시간 배지 첫 화면 가시성', () => {
  for (const vp of VIEWPORTS) {
    for (const lang of LANGS) {
      test(`${vp.width}px × ${lang}: 지원시간 배지가 뷰포트 안에서 완전히 보인다`, async ({ page }, testInfo) => {
        // 뷰포트를 테스트별로 직접 지정하므로 기기 프로젝트 3개에서 중복 실행할 필요가 없다.
        test.skip(testInfo.project.name !== 'Desktop Chrome', '뷰포트 직접 지정 — 한 프로젝트에서만 실행');

        await page.setViewportSize({ width: vp.width, height: vp.height });

        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(String(err)));

        await page.addInitScript((l) => {
          window.localStorage.setItem('cocotrip_lang', l);
        }, lang);
        await page.goto('/tours', { waitUntil: 'domcontentloaded' });

        const supportBadge = page.getByTestId('tours-trust-badge-2');
        await expect(supportBadge).toBeVisible();

        const box = await supportBadge.boundingBox();
        expect(box, '지원시간 배지 위치를 잴 수 없다').not.toBeNull();
        expect(
          box!.x,
          `지원시간 배지 left=${box!.x} — 뷰포트(${vp.width}) 왼쪽 밖`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          box!.x + box!.width,
          `지원시간 배지 right=${box!.x + box!.width} — 뷰포트(${vp.width}) 오른쪽 밖 (요구사항: 첫 화면에서 잘리지 않음)`,
        ).toBeLessThanOrEqual(vp.width + 1);

        // 페이지 자체 가로 넘침 0
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
