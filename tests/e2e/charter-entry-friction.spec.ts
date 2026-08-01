/**
 * /charter 첫 진입 마찰 회귀 (2026-08-01).
 *
 * 배경(실측): GA4 30일 `charter_quote_start` 14명 → `charter_quote_complete` 0명.
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
import { test, expect, type Page } from '@playwright/test';

const INTRO_DIALOG = '[role="dialog"][aria-labelledby="charter-intro-title"]';
const HOW_IT_WORKS = '[data-testid="charter-how-it-works"]';

/** 분석 수집으로 나가는 호스트. */
const ANALYTICS_HOSTS = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'posthog.com',
];

const isAnalytics = (url: string) => ANALYTICS_HOSTS.some((h) => url.includes(h));

/** 수집 요청을 navigation 전에 끊고, 빠져나간 것을 담을 배열을 돌려준다. */
async function blockAnalytics(page: Page): Promise<string[]> {
  const escaped: string[] = [];
  // 🔴 `**/*` 로 전부 가로채면 dev 의 모듈 요청 수백 건까지 프록시를 타서 페이지가
  // 뜨지 않는다(실측 — 쿠키 배너조차 20초 안에 안 나왔다). 수집 호스트만 겨냥한다.
  for (const host of ANALYTICS_HOSTS) {
    await page.route(`**${host}/**`, (route) => route.abort());
  }
  page.on('requestfinished', (r) => { if (isAnalytics(r.url())) escaped.push(r.url()); });
  return escaped;
}

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
      const escaped = await blockAnalytics(page);
      await page.goto('/charter');

      // 동의를 정하기 전 — 예전 구현이 자동으로 띄우던 첫 지점.
      await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);

      await resolveConsent(page, choice);
      // 동의 확정 직후 — 직전 구현이 여기서 350ms 뒤 모달을 띄웠다.
      await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);

      // 페이지가 자리잡은 뒤에도 없어야 한다(지연 타이머 재도입 방지).
      await expect(page.locator(HOW_IT_WORKS)).toBeVisible({ timeout: 20000 });
      await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);

      expect(escaped, `분석 수집 요청이 빠져나감: ${escaped.join(', ')}`).toHaveLength(0);
    });
  }

  test('이미 수락해 둔 재방문에서도 자동으로 뜨지 않는다', async ({ page }) => {
    const escaped = await blockAnalytics(page);
    await page.goto('/charter');
    await resolveConsent(page, 'Accept');
    await page.reload();

    await expect(page.locator(HOW_IT_WORKS)).toBeVisible({ timeout: 20000 });
    await expect(page.locator(INTRO_DIALOG)).toHaveCount(0);
    expect(escaped, `분석 수집 요청이 빠져나감: ${escaped.join(', ')}`).toHaveLength(0);
  });

  test('이용 방법 버튼으로 열고 닫을 수 있다 (닫아도 버튼은 남는다)', async ({ page }) => {
    const escaped = await blockAnalytics(page);
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

    expect(escaped, `분석 수집 요청이 빠져나감: ${escaped.join(', ')}`).toHaveLength(0);
  });
});
