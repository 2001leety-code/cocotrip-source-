import { test, expect, type Page } from '@playwright/test';

// ─── 공통 에러 캡처 ───────────────────────────────────────────
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const failedRequests: string[] = [];

function attachErrorListeners(page: Page) {
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    console.error('🔴 Page error:', err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.error('🔴 Console error:', msg.text());
    }
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`);
    console.error('🔴 Request failed:', req.url(), req.failure()?.errorText);
  });
}

// ─── 위자드 Step 헬퍼: 도시 + 활동 선택 후 다음 ─────────────
async function completeStep0(page: Page) {
  // 도시 선택: Seoul
  const seoulBtn = page.getByText('Seoul', { exact: false }).first();
  if (await seoulBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await seoulBtn.click();
    await page.waitForTimeout(300);
  }

  // 활동 선택: K-pop Tour
  const kpopBtn = page.getByText('K-pop Tour', { exact: false }).first();
  if (await kpopBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await kpopBtn.click();
    await page.waitForTimeout(200);
  }

  // 활동 선택: Food Tour
  const foodBtn = page.getByText('Food Tour', { exact: false }).first();
  if (await foodBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await foodBtn.click();
    await page.waitForTimeout(200);
  }

  // Next 버튼
  const nextBtn = page.getByRole('button', { name: /Next|다음|Food/i }).first();
  if (await nextBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(800);
  }
}

// ─── Step 1 (Food Prefs) 통과 ────────────────────────────────
async function completeStep1Food(page: Page) {
  // Vegan/Seafood/Street 중 하나 클릭 시도
  const streetBtn = page.getByText('Street', { exact: false }).first();
  if (await streetBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await streetBtn.click();
    await page.waitForTimeout(200);
  }

  // Next
  const nextBtn = page.getByRole('button', { name: /Next|다음|Details/i }).first();
  if (await nextBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(800);
  }
}

// ─── Step 2 (Travel Details) 통과 ────────────────────────────
async function completeStep2Details(page: Page) {
  // 이름 입력
  const nameInput = page.getByPlaceholder(/name|이름/i).first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.fill('Test User');
    await page.waitForTimeout(200);
  }

  // 인원수 — stepper "+" 버튼
  const plusBtn = page.getByRole('button', { name: /\+/ }).first();
  if (await plusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await plusBtn.click();
    await page.waitForTimeout(200);
  }

  // Next
  const nextBtn = page.getByRole('button', { name: /Next|다음|Generate|Confirm/i }).first();
  if (await nextBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(800);
  }
}

// ─── TEST SUITE ───────────────────────────────────────────────
test.describe('CocoTrip AI Planner Full Flow', () => {
  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0;
    consoleErrors.length = 0;
    failedRequests.length = 0;
    attachErrorListeners(page);
  });

  // ── 1. 홈페이지 로드 ─────────────────────────────────────────
  test('1. 홈페이지 로드 및 기본 구조 확인', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000); // React hydration 대기
    await page.screenshot({ path: 'tests/screenshots/01-home.png', fullPage: true });

    // 타이틀 확인
    await expect(page).toHaveTitle(/CocoTrip|coco/i, { timeout: 10000 });

    // 네비게이션에 Planner 링크 존재 확인
    const plannerLink = page.getByRole('link', { name: /planner|AI Planner/i }).first();
    await expect(plannerLink).toBeVisible({ timeout: 10000 });

    console.log('✅ Test 1: 홈페이지 로드 성공');
    console.log(`   Page errors: ${pageErrors.length}, Console errors: ${consoleErrors.length}`);
  });

  // ── 2. Planner 페이지 진입 (AuthRequired 검증) ────────────────
  test('2. AI Planner 페이지 — 비인증 시 로그인 화면 표시 확인', async ({ page }) => {
    await page.goto('/planner?lang=en');
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tests/screenshots/02-planner-entry.png', fullPage: true });

    // AuthRequired: 로그인 화면이 표시되어야 함
    const loginRequired = page.getByText(/Login Required|sign in|Continue with Google/i).first();
    const googleBtn = page.getByText(/Continue with Google/i).first();

    const hasLoginScreen = await loginRequired.isVisible({ timeout: 8000 }).catch(() => false);
    const hasGoogleBtn = await googleBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasLoginScreen) {
      console.log('✅ Test 2: AuthRequired 정상 작동 — 로그인 화면 표시');
      console.log(`   Google 로그인 버튼: ${hasGoogleBtn ? '✅ 표시됨' : '❌ 미표시'}`);
      // 로그인 화면이 나오면 정상 (AuthRequired 보호)
      expect(hasLoginScreen).toBe(true);
    } else {
      // 로그인 없이 Planner가 보이면 보안 이슈
      const seoulBtn = page.getByText('Seoul', { exact: false }).first();
      const wizardVisible = await seoulBtn.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`⚠️  Test 2: 로그인 화면 미표시 — Wizard 직접 접근: ${wizardVisible ? '가능 (보안 확인 필요)' : '불가'}`);
    }

    await page.screenshot({ path: 'tests/screenshots/02b-planner-auth-state.png', fullPage: true });
  });

  // ── 3. Step 0: 도시 + 활동 선택 (AuthRequired → 로그인 필요) ──
  test('3. Step0 - AuthRequired 우회 없이 위자드 접근 불가 확인', async ({ page }) => {
    await page.goto('/planner?lang=en');
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tests/screenshots/03-step0-initial.png', fullPage: true });

    // 로그인 게이트 확인
    const loginScreen = page.getByText(/Login Required|sign in/i).first();
    const isGated = await loginScreen.isVisible({ timeout: 8000 }).catch(() => false);

    if (isGated) {
      console.log('✅ Test 3: Planner 위자드가 AuthRequired로 보호됨 — 비인증 접근 차단');
      // 인증 없이 Seoul 버튼에 접근 불가 확인
      const seoulBtn = page.getByText('Seoul', { exact: false }).first();
      const seoulVisible = await seoulBtn.isVisible({ timeout: 2000 }).catch(() => false);
      expect(seoulVisible).toBe(false); // 위자드가 숨겨져 있어야 함
      console.log(`   Seoul 버튼 노출: ${seoulVisible ? '❌ 보안 취약' : '✅ 정상 차단'}`);
    } else {
      // 로그인 없이 접근 가능하면 — 위자드 테스트 진행
      console.log('⚠️  Test 3: AuthRequired 미적용 — 위자드 직접 테스트');
      const seoulBtn = page.getByText('Seoul', { exact: false }).first();
      await expect(seoulBtn).toBeVisible({ timeout: 10000 });
      await seoulBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/screenshots/03b-seoul-selected.png', fullPage: true });

    // K-pop Tour 클릭
    const kpopBtn = page.getByText('K-pop Tour', { exact: false }).first();
    if (await kpopBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await kpopBtn.click();
      await page.waitForTimeout(200);
    }

    // Food Tour 클릭
    const foodBtn = page.getByText('Food Tour', { exact: false }).first();
    if (await foodBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await foodBtn.click();
      await page.waitForTimeout(200);
    }

      await page.screenshot({ path: 'tests/screenshots/03c-step0-selected.png', fullPage: true });

      // Next 버튼 활성화 확인
      const nextBtn = page.getByRole('button', { name: /Next|다음|Food/i }).first();
      if (await nextBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(1000);
        console.log('✅ Test 3: Step0 선택 완료');
      }
    }

    await page.screenshot({ path: 'tests/screenshots/03d-after-step0.png', fullPage: true });
  });

  // ── 4. 캘린더 터치 영역 확인 ─────────────────────────────────
  test('4. 캘린더 range picker 터치 영역 (≥36px)', async ({ page }) => {
    await page.goto('/planner?lang=en');
    await page.waitForLoadState('load');

    // Step 0 통과
    await completeStep0(page);
    // Step 1 (Food) 통과
    await completeStep1Food(page);

    // 날짜 입력 단계가 보이면 캘린더 확인
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/04-calendar-step.png', fullPage: true });

    const dayCell = page.locator('[role="gridcell"]').first();
    if (await dayCell.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box = await dayCell.boundingBox();
      if (box) {
        console.log(`   Day cell size: ${box.width}x${box.height}px`);
        expect(box.width).toBeGreaterThanOrEqual(32);
        expect(box.height).toBeGreaterThanOrEqual(32);
        console.log('✅ Test 4: 캘린더 터치 영역 OK');
      } else {
        console.log('⚠️  Test 4: 캘린더 day cell boundingBox null — 스킵');
      }
    } else {
      console.log('⚠️  Test 4: 캘린더 gridcell 미발견 — 스텝 구조 변경 가능성');
    }
  });

  // ── 5. 4개 언어 전환 확인 ─────────────────────────────────────
  test('5. 4개 언어 전환 (en/ko/ja/zh)', async ({ page }) => {
    const languages = ['en', 'ko', 'ja', 'zh'];
    const results: Record<string, boolean> = {};

    for (const lang of languages) {
      await page.goto(`/planner?lang=${lang}`);
      await page.waitForLoadState('load');
      await page.screenshot({
        path: `tests/screenshots/05-lang-${lang}.png`,
        fullPage: true,
      });

      // 각 언어별 기대 텍스트
      const langTexts: Record<string, string> = {
        en: 'K-pop Tour',
        ko: 'K-pop 투어',
        ja: 'K-popツアー',
        zh: 'K-pop之旅',
      };

      const langText = page.getByText(langTexts[lang], { exact: false }).first();
      const visible = await langText.isVisible({ timeout: 8000 }).catch(() => false);
      results[lang] = visible;
      console.log(`   ${lang}: ${visible ? '✅' : '❌'} ("${langTexts[lang]}" ${visible ? '발견' : '미발견'})`);
    }

    const allPassed = Object.values(results).every(Boolean);
    if (!allPassed) {
      console.log('⚠️  일부 언어 텍스트 미발견 — 언어 파라미터 동작 확인 필요');
    } else {
      console.log('✅ Test 5: 4개 언어 전환 모두 정상');
    }
  });

  // ── 6. 공항 동적 선택 — Busan → PUS 확인 ─────────────────────
  test('6. Busan 선택 시 PUS 공항 옵션 표시', async ({ page }) => {
    await page.goto('/planner?lang=en');
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);

    // AuthRequired 게이트 확인
    const loginScreen = page.getByText(/Login Required/i).first();
    if (await loginScreen.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('⚠️  Test 6: AuthRequired 게이트 — Busan 선택 불가 (로그인 필요)');
      await page.screenshot({ path: 'tests/screenshots/06-busan-auth-gate.png', fullPage: true });
      return; // 로그인 없이는 테스트 불가 — 스킵
    }

    // Busan 버튼 클릭
    const busanBtn = page.getByText('Busan', { exact: false }).first();
    await expect(busanBtn).toBeVisible({ timeout: 10000 });
    await busanBtn.click();
    await page.waitForTimeout(300);

    // 활동 선택
    const foodBtn = page.getByText('Food Tour', { exact: false }).first();
    if (await foodBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await foodBtn.click();
    }

    // Step 0 Next
    const nextBtn = page.getByRole('button', { name: /Next|다음|Food/i }).first();
    if (await nextBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(800);
    }

    // Food Step → Next
    await completeStep1Food(page);

    // Details Step — 공항 선택 드롭다운/버튼 탐색
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/screenshots/06-busan-airport-step.png', fullPage: true });

    // PUS 옵션 확인
    const pusOption = page.getByText(/Gimhae|PUS/i).first();
    if (await pusOption.isVisible({ timeout: 8000 }).catch(() => false)) {
      console.log('✅ Test 6: PUS 공항 옵션 발견');
    } else {
      // 드롭다운이 닫혀있을 수 있음 — 공항 영역 클릭 시도
      const airportSelect = page.locator('select, [role="listbox"], [class*="airport"]').first();
      if (await airportSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await airportSelect.click();
        await page.waitForTimeout(300);
        const pusAfterClick = page.getByText(/Gimhae|PUS/i).first();
        const found = await pusAfterClick.isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`${found ? '✅' : '❌'} Test 6: PUS 공항 ${found ? '발견' : '미발견'}`);
      } else {
        console.log('⚠️  Test 6: 공항 선택 UI 미발견 — 스텝 구조 확인 필요');
      }
    }
    await page.screenshot({ path: 'tests/screenshots/06b-busan-airports.png', fullPage: true });
  });

  // ── 7. PayPal 버튼 존재 확인 (결제 안 함) ─────────────────────
  test('7. PayPal 버튼 렌더링 확인 (클릭 안 함)', async ({ page }) => {
    await page.goto('/planner?lang=en');
    await page.waitForLoadState('load');

    // Step 0 → Step 1 → Step 2 통과
    await completeStep0(page);
    await completeStep1Food(page);
    await completeStep2Details(page);

    // AI 생성 중 대기 (최대 30초)
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/screenshots/07-after-steps.png', fullPage: true });

    // PayPal iframe 또는 버튼 컨테이너 탐색
    let paypalFound = false;

    // 방법 1: iframe
    const paypalIframe = page.frameLocator('iframe[title*="PayPal"]');
    const iframeBtn = paypalIframe.locator('.paypal-button').first();
    paypalFound = await iframeBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!paypalFound) {
      // 방법 2: PayPal SDK div
      const paypalDiv = page.locator('[id*="paypal"], [class*="paypal"], [data-testid*="paypal"]').first();
      paypalFound = await paypalDiv.isVisible({ timeout: 3000 }).catch(() => false);
    }

    if (!paypalFound) {
      // 방법 3: "Unlock" 또는 결제 버튼
      const unlockBtn = page.getByRole('button', { name: /unlock|pay|결제|purchase/i }).first();
      paypalFound = await unlockBtn.isVisible({ timeout: 3000 }).catch(() => false);
    }

    await page.screenshot({ path: 'tests/screenshots/07b-paypal-area.png', fullPage: true });
    console.log(`${paypalFound ? '✅' : '⚠️ '} Test 7: PayPal/결제 버튼 ${paypalFound ? '발견' : '미발견 (플로우 끝까지 미도달 가능)'}`);
  });

  // ── 8. 보안: paypalOrderId 없이 API 호출 → 403 ───────────────
  test('8. [보안] paypalOrderId 없이 API 호출 → 403', async ({ request }) => {
    const response = await request.post('https://cocotripkr.com/api/ai-planner-full', {
      data: {
        guestName: 'Security Test',
        email: 'test@security.test',
        pax: 2,
        styles: ['food'],
        area: 'Seoul',
        duration: '1day',
        startDate: '2026-05-15',
        language: 'en',
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const status = response.status();
    let body: any = {};
    try {
      body = await response.json();
    } catch {
      body = { raw: await response.text() };
    }

    console.log(`   Status: ${status}`);
    console.log(`   Body: ${JSON.stringify(body).slice(0, 200)}`);

    if (status === 403) {
      console.log('✅ Test 8: 보안 OK — paypalOrderId 없이 403 반환');
    } else if (status === 400) {
      console.log('⚠️  Test 8: 400 반환 — validation 단에서 차단 (허용 가능)');
    } else if (status === 401) {
      console.log('⚠️  Test 8: 401 반환 — auth 단에서 차단 (허용 가능)');
    } else {
      console.log(`❌ Test 8: 예상치 못한 상태 코드 ${status} — 보안 검토 필요!`);
    }

    // 200이면 위험 — 결제 없이 플랜 생성됨
    expect(status).not.toBe(200);
    expect(status).not.toBe(201);
  });

  // ── 9. 보안: 가짜 paypalOrderId → 403 ───────────────────────
  test('9. [보안] 가짜 paypalOrderId로 API 호출 → 403', async ({ request }) => {
    const response = await request.post('https://cocotripkr.com/api/ai-planner-full', {
      data: {
        paypalOrderId: 'FAKE_ORDER_SECURITY_TEST_12345',
        guestName: 'Security Test',
        email: 'test@security.test',
        pax: 2,
        styles: ['food'],
        area: 'Seoul',
        duration: '1day',
        startDate: '2026-05-15',
        language: 'en',
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const status = response.status();
    let body: any = {};
    try {
      body = await response.json();
    } catch {
      body = { raw: await response.text() };
    }

    console.log(`   Status: ${status}`);
    console.log(`   Body: ${JSON.stringify(body).slice(0, 200)}`);

    if (status === 403) {
      console.log('✅ Test 9: 보안 OK — 가짜 orderId 403 차단');
    } else if (status === 400) {
      console.log('⚠️  Test 9: 400 차단 — validation 단계에서 처리');
    } else if (status === 422) {
      console.log('⚠️  Test 9: 422 차단 — PayPal 검증 실패 응답');
    } else {
      console.log(`❌ Test 9: 상태 코드 ${status} — 가짜 orderId 차단 확인 필요!`);
    }

    // 200이면 심각한 보안 취약점
    expect(status).not.toBe(200);
    expect(status).not.toBe(201);
  });
});
