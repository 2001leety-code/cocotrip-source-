/**
 * /charter 첫 진입 마찰 회귀 (2026-08-01).
 *
 * 배경: ⚠️ 이 스펙을 만든 계기였던 "견적 시작 14명" 은 2026-08-02 확인 결과 주간 자동
 * 테스트 오염분이었다(월요일마다 9세션 = 3언어×3기기). 팝업 겹침은 실제 결함이었다.
 * 첫 진입 화면을 열어보니 쿠키 배너(z-10001)가 인트로 모달(z-9999)의 기본 버튼을 덮고 있었고,
 * 견적을 보러 온 사람 앞에 설명창이 먼저 서 있었다. 그래서 **자동 노출을 없애고** 원하는
 * 사람만 여는 버튼으로 바꿨다.
 *
 * 여기서 지키는 것:
 *   1) 신규 방문자에게 인트로 모달이 **자동으로 뜨지 않는다** — 수락하든 닫든, 데스크탑이든 모바일이든.
 *   2) 이용 방법 버튼으로 열고 닫을 수 있고, 닫아도 버튼이 남아 다시 열 수 있다.
 *
 * 대기는 전부 상태 기반이다(고정 sleep 금지) — 배너가 사라진 시점, 버튼이 보이는 시점처럼
 * "자동 노출이 있었다면 이미 떠 있어야 하는" 지점에서 확인한다.
 *
 * 운영 사이트를 대상으로 돌 수 있으므로 분석 수집 요청은 navigation 전에 전부 차단하고,
 * 빠져나간 요청이 0 인 것까지 확인한다 — 진단 때문에 운영 지표가 오염되면 안 된다.
 *
 * 계측(charter_step 등)은 여기서 검증하지 않는다. dev·preview 에는 GA 측정 ID 가 없어
 * (`VITE_GA_MEASUREMENT_ID` 미설정 → `canSendToGA()` false) 아무것도 전송되지 않는다.
 * 억지로 통과시키면 "전송된 척" 하는 가짜 증거가 된다. 동의 상태별 계측은 유닛 테스트
 * `tests/unit/charter-funnel-consent.test.ts` 가 검증한다.
 */
import { test, expect } from './fixtures/analytics-guard';
import { type Page } from '@playwright/test';

const INTRO_DIALOG = '[role="dialog"][aria-labelledby="charter-intro-title"]';
const HOW_IT_WORKS = '[data-testid="charter-how-it-works"]';

/** 분석 수집으로 나가는 호스트. */
/** 쿠키 배너 버튼을 누르고 배너가 사라질 때까지 기다린다(상태 기반). */
async function resolveConsent(page: Page, choice: 'Accept' | 'Dismiss') {
  const btn = page.locator('button').filter({ hasText: new RegExp(`^${choice}$`) }).first();
  await btn.waitFor({ state: 'visible', timeout: 20000 });
  await btn.click();
  await expect(btn).toBeHidden({ timeout: 10000 });
}

test.describe('/charter 첫 진입', () => {
  for (const choice of ['Accept', 'Dismiss'] as const) {
    test(`신규 방문 + 쿠키 ${choice} → 인트로 모달이 자동으로 뜨지 않는다`, async ({ page }) => {
      await page.goto('/charter');

      // 동의를 정하기 전 — 예전 구현이 자동으로 띄우던 첫 지점.
      await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);

      await resolveConsent(page, choice);
      // 동의 확정 직후 — 직전 구현이 여기서 350ms 뒤 모달을 띄웠다.
      await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);

      // 페이지가 자리잡은 뒤에도 없어야 한다(지연 타이머 재도입 방지).
      await expect(page.locator(HOW_IT_WORKS)).toBeVisible({ timeout: 20000 });
      await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);

    });
  }

  test('이미 수락해 둔 재방문에서도 자동으로 뜨지 않는다', async ({ page }) => {
    await page.goto('/charter');
    await resolveConsent(page, 'Accept');
    await page.reload();

    await expect(page.locator(HOW_IT_WORKS)).toBeVisible({ timeout: 20000 });
    await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);
  });

  test('이용 방법 버튼으로 열고 닫을 수 있다 (닫아도 버튼은 남는다)', async ({ page }) => {
    await page.goto('/charter');
    await resolveConsent(page, 'Dismiss');

    const trigger = page.locator(HOW_IT_WORKS);
    await expect(trigger).toBeVisible({ timeout: 20000 });
    await trigger.click();
    await expect(page.locator(INTRO_DIALOG)).toBeVisible({ timeout: 10000 });

    await page.locator(`${INTRO_DIALOG} button[aria-label="Close"]`).click();
    await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);
    // 닫은 뒤에도 다시 열 수 있어야 한다 — 트리거가 사라지면 영영 못 연다.
    await expect(trigger).toBeVisible();

  });
});

/**
 * 모바일 밝은 셸(`.cocotrip-mobile-charter`)은 index.css 가 그 안의 `text-white*` 를
 * 짙은 남색으로 `!important` 덮어쓴다. 다이얼로그는 배경이 짙은 남색이라 셸 안에 있으면
 * 글자가 배경과 같은 색이 되어 사실상 안 보인다 — 그래서 body 로 포털한다.
 * 문자열이 아니라 **계산된 색**으로 확인한다.
 */
test.describe('모바일 안내창 가독성', () => {
  test('열린 다이얼로그의 제목이 셸 색상 덮어쓰기를 타지 않는다', async ({ page }) => {
    // 다른 검사와 같은 규칙 — 기본 baseURL 이 운영이라 차단기 없이 돌면 진단이 실제 지표에 섞인다.
    await page.goto('/charter');
    await resolveConsent(page, 'Dismiss');

    await page.locator(HOW_IT_WORKS).click();
    const title = page.locator('#charter-intro-title');
    await expect(title).toBeVisible({ timeout: 10000 });

    // 셸 밖(body 직속)에 있어야 한다.
    const inShell = await title.evaluate((el) => !!el.closest('.cocotrip-mobile-charter'));
    expect(inShell, '다이얼로그가 모바일 셸 안에 있으면 글자색이 덮어써진다').toBe(false);

    // 덮어쓰기 색(#15143d = rgb(21,20,61))이 아니어야 한다.
    const color = await title.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toBe('rgb(21, 20, 61)');

  });
});
