/**
 * 차터 견적 진입 가능성 검사 (2026-08-01).
 *
 * 왜: ⚠️ 계기였던 "견적 시작 14명" 은 주간 자동 테스트 오염분으로 밝혀졌다(2026-08-02).
 * 그래도 아래 결함은 실제였다 —
 * 원인 조사 중, 신규 방문자 화면이 쿠키 배너 + 전체화면 인트로 모달로 덮여 자동화가
 * 180초 동안 견적 첫 입력칸을 누르지 못하는 것을 발견했다. 유입보다 먼저 새는 구멍이었다.
 *
 * 그래서 이 스펙이 지키는 것은 하나다:
 *   **신규 방문자가 오버레이를 걷어내지 않고도 견적 첫 입력에 도달할 수 있다.**
 * 실패 조건이 실제로 존재한다 — 무엇이든 클릭을 가로막으면 첫 입력에서 타임아웃 난다.
 *
 * 🔴 운영 데이터 오염 금지: 이 스펙은 BASE_URL 기본값이 운영이라 그대로 두면 진단이
 *   GA4·PostHog 에 실제 이벤트를 남긴다. 그래서 ①navigation **전에** 수집 요청을 전부
 *   차단하고 ②동의는 Accept 가 아니라 **Dismiss** 로 처리하며 ③빠져나간 수집 요청이
 *   0 인 것을 단언한다. 우리 분석 지표는 손님 것이지 테스트 것이 아니다.
 */
import { test, expect } from './fixtures/analytics-guard';

test('신규 방문자가 오버레이를 치우지 않고 견적 첫 입력에 도달한다', async ({ page }) => {
  await page.goto('/charter');

  // 쿠키 배너는 법적 고지라 그대로 둔다. 여기서 검사하는 것은 "배너가 있어도
  // 견적 입력이 가능한가" — 배너를 먼저 닫아버리면 그 질문을 회피하게 된다.
  const originInput = page.locator('input[placeholder*="airport" i]').first();
  await originInput.waitFor({ state: 'visible', timeout: 30000 });

  // 실제 클릭. 전체화면 모달이 다시 생기면 여기서 pointer interception 으로 실패한다.
  await originInput.click({ timeout: 15000 });
  await originInput.fill('Incheon');

  // 자동완성 후보가 실제로 뜨는지 — 주소 검색이 죽으면(과거 NCP 키 사고) 여기서 걸린다.
  const suggestion = page.locator('button').filter({ hasText: /Incheon International/i }).first();
  await expect(suggestion).toBeVisible({ timeout: 15000 });
  await suggestion.click();

  // 출발지가 확정되면 다음 단계로 갈 수 있어야 한다.
  const next = page.locator('button').filter({ hasText: /^(next|다음|continue)/i }).first();
  await expect(next).toBeEnabled({ timeout: 15000 });
  // 분석 유출 검사는 `analytics-guard` 픽스처가 매 테스트 종료 시 자동으로 한다.
});
