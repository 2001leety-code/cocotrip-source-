/**
 * Shared setup helpers for visual regression specs.
 */

/**
 * 쿠키 동의 배너 사전 차단.
 *
 * CookieBanner.tsx 는 localStorage 'cocotrip_cookie_consent' 가 없으면
 * mount 1500ms 후 fixed-bottom 배너를 띄움 → 스크린샷 타이밍에 따라
 * 하단 clip 영역에 껴들어 pixel diff 유발 (PR #1059 CI 에서 T3
 * outro-fold.png 3691px/4% diff 로 2회 연속 flaky 재현).
 *
 * e2e 쪽 dismissCookieBanner() (버튼 클릭) 는 배너가 뜬 "후" 닫는
 * 반응형이라 여전히 레이스 존재 — visual spec 은 page.goto 전에
 * consent 를 주입해 배너 자체가 렌더되지 않게 하는 쪽이 결정론적.
 *
 * 'dismissed' 값: CookieBanner 의 두 terminal 값(accepted/dismissed) 중
 * 하나. 이 키를 읽는 곳은 CookieBanner 뿐이라 (analytics 게이트 없음)
 * 어느 값이든 배너 미표시 외 부작용 없음.
 *
 * page.goto 보다 먼저 호출해야 함 (addInitScript 는 이후 navigation 부터 적용).
 */
export async function suppressCookieBanner(page: { addInitScript: Function }) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cocotrip_cookie_consent', 'dismissed');
    } catch {}
  });
}

/**
 * 홈 히어로 날씨 칩 비결정성 차단 (UIUX 체크리스트 후속 — #1099 에서 2회 flaky 관측).
 *
 * MobileHome(v1)/MobileHomeV2 는 mount 후 wttr.in 을 fetch 해 성공 시에만
 * 날씨 칩을 렌더 → 응답 타이밍·실측값(기온/설명 텍스트)이 매 run 달라
 * pixel diff 유발. 현재 baseline 은 칩 미노출 상태로 캡처되어 있음.
 *
 * mask 옵션 대신 요청 자체를 abort 하는 이유: 칩은 fetch 실패 시 아예
 * 렌더되지 않는 silent 폴백이라, abort = "칩 없음" 상태가 결정론적으로
 * 고정되고 기존 baseline 재생성이 필요 없음. mask 는 칩이 "가끔만" 존재해
 * 마스크 박스 유무 자체가 diff 가 되는 문제를 못 푼다.
 *
 * page.goto 보다 먼저 호출해야 함 (route 는 등록 이후 요청부터 적용).
 */
export async function stubWeatherUnavailable(page: {
  route: (url: string, handler: (route: { abort: () => Promise<void> }) => Promise<void>) => Promise<void>;
}) {
  await page.route('https://wttr.in/**', async (route) => {
    await route.abort();
  });
}
