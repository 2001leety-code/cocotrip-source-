/**
 * 차터 견적 퍼널 실주행 프로브 (2026-08-01).
 *
 * 왜: GA4 30일 실측에서 `charter_quote_start` 14명 → `charter_quote_complete` **0명**.
 * 계측은 정상(마운트 1회 / step6+유효견적 1회)이라 숫자가 진짜다. 즉 견적을 보러 온
 * 사람이 전원 중간에 떨어진다 — 유입보다 먼저 새는 구멍이다.
 *
 * 이 스펙은 "어디서 막히나"를 눈으로 찍기 위한 진단용이라 단계마다 화면 상태를 덤프한다.
 * 통과/실패보다 **로그**가 산출물이다.
 */
import { test, expect } from '@playwright/test';

test('차터 위저드 6단계 주행 — 어디서 막히는지', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => errors.push(`REQFAIL ${r.url().slice(0, 120)}`));

  const dump = async (label: string) => {
    const state = await page.evaluate(() => {
      const vis = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const btns = [...document.querySelectorAll('button')].filter(vis).map((b) => ({
        t: (b.textContent || '').trim().slice(0, 40),
        disabled: (b as HTMLButtonElement).disabled,
      })).filter((b) => b.t);
      const inputs = [...document.querySelectorAll('input')].filter(vis).map((i) => ({
        ph: (i as HTMLInputElement).placeholder?.slice(0, 40) || '',
        val: (i as HTMLInputElement).value?.slice(0, 30) || '',
        type: (i as HTMLInputElement).type,
      }));
      const stepChips = [...document.querySelectorAll('li,[role="tab"]')].filter(vis)
        .map((l) => (l.textContent || '').trim().slice(0, 24)).filter(Boolean).slice(0, 10);
      return { btns, inputs, stepChips, h: document.body.innerText.slice(0, 400) };
    });
    console.log(`\n===== ${label} =====`);
    console.log('steps:', JSON.stringify(state.stepChips));
    console.log('inputs:', JSON.stringify(state.inputs));
    console.log('buttons:', JSON.stringify(state.btns));
    console.log('text:', state.h.replace(/\n+/g, ' | ').slice(0, 350));
  };

  await page.goto('/charter', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // 🔴 첫 진입 실측(2026-08-01): 쿠키배너(z-10001) + 차터 인트로 모달(z-9999, inset-0) 이
  //   겹쳐서 입력칸 클릭이 180초간 불가능했다. 아래 "치우기" 단계가 몇 번 필요한지 자체가 데이터다.
  await dump('초기 진입 (오버레이 치우기 전)');

  const dismissals: string[] = [];
  for (const [label, loc] of [
    ['쿠키 Accept', page.locator('button').filter({ hasText: /^Accept$/ }).first()],
    ['인트로 모달 닫기', page.locator('[role="dialog"] button').last()],
    ['프로모 닫기', page.locator('button[aria-label*="Close promotion" i]').first()],
  ] as const) {
    if (await loc.count() && await loc.isVisible().catch(() => false)) {
      await loc.click({ force: true }).catch(() => {});
      dismissals.push(label);
      await page.waitForTimeout(800);
    }
  }
  console.log('\n>>> 견적 시작 전에 치워야 했던 방해물:', dismissals.length, JSON.stringify(dismissals));
  await dump('오버레이 치운 뒤');

  // 출발지 입력 (자동완성 후보가 뜨는지)
  const originInput = page.locator('input[placeholder*="airport" i], input[type="text"]').first();
  if (await originInput.count()) {
    await originInput.click();
    await originInput.fill('Incheon');
    await page.waitForTimeout(2500);
    await dump('출발지 "Incheon" 입력 후 (자동완성 후보?)');
    // 후보는 <button> 으로 렌더된다(li/role=option 아님).
    const option = page.locator('button').filter({ hasText: /Incheon International/i }).first();
    if (await option.count()) {
      await option.click();
      await page.waitForTimeout(2000);
      await dump('출발지 선택 후');
    } else {
      console.log('!! 자동완성 후보가 안 뜸 — 여기서 진행 불가');
    }
  } else {
    console.log('!! 출발지 입력칸 자체를 못 찾음');
  }

  // 이후 단계 전진. Next 가 비활성이면 "그 단계에서 뭘 더 골라야 하는지" 를 찾아
  // 첫 번째 선택지를 눌러보고 다시 시도한다 — 실제 사용자가 하는 행동에 가깝게.
  for (let i = 0; i < 12; i++) {
    const next = page.locator('button').filter({ hasText: /^(next|다음|continue)/i }).first();
    if (!(await next.count())) { console.log(`(${i}) next 버튼 없음 — 중단`); break; }
    if (await next.isDisabled()) {
      // 위저드 본문(STEP n/6 카드) 안의 미선택 옵션을 하나 고른다.
      const opt = page.locator('main button, section button').filter({ hasText: /.{3,}/ }).nth(i % 6);
      const label = await opt.textContent().catch(() => '');
      if (await opt.count() && await opt.isEnabled().catch(() => false)) {
        await opt.click({ force: true }).catch(() => {});
        console.log(`(${i}) next 비활성 → 옵션 클릭 시도: ${(label || '').trim().slice(0, 40)}`);
        await page.waitForTimeout(1200);
        continue;
      }
      console.log(`(${i}) next 비활성 + 고를 옵션 없음 — 여기서 진짜 막힘`);
      await dump(`막힌 단계 ${i}`);
      break;
    }
    await next.click();
    await page.waitForTimeout(2500);
    const step = await page.evaluate(() => (document.body.innerText.match(/STEP\s*(\d)\s*\/\s*6/i) || [])[1] || '?');
    console.log(`(${i}) next 클릭 → 현재 STEP ${step}`);
    if (step === '6') { await dump('STEP 6 도달 — 최종 견적 화면'); break; }
  }

  console.log('\n===== 콘솔 에러/실패 요청 =====');
  console.log(errors.length ? errors.slice(0, 15).join('\n') : '(없음)');

  expect(true).toBe(true); // 진단용 — 항상 통과, 로그가 산출물
});
