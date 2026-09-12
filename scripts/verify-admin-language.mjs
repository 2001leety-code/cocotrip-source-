import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5189');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Local synthetic preview only');
const artifacts = 'tests/artifacts/admin-language';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const forbidden = [];
let cases = 0;
try {
  for (const [width, savedCustomer, browserLocale] of [
    [390, 'en', 'ko-KR'], [1280, 'en', 'en-US'], [390, 'ja', 'en-US'], [1280, 'zh', 'ko-KR'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: browserLocale, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin || url.pathname.startsWith('/api/')) {
        forbidden.push(url.origin === base.origin ? 'local-api-request' : 'external-request');
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    // Set a real, pre-existing customer preference once, not a mocked useLanguage.
    await page.goto(new URL('/robots.txt', base).href);
    await page.evaluate(value => localStorage.setItem('cocotrip_lang', value), savedCustomer);
    await page.goto(new URL('/admin/preview-ai-center', base).href, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'AI 운영센터', exact: true }).waitFor();
    for (const name of ['지금 해야 할 일', '통합 예약 흐름', '회사 메일 · WhatsApp', '웹 채팅', '정기 점검', '예약·문의 자동 알림']) {
      assert.ok(await page.getByRole('heading', { name, exact: true }).isVisible(), `Korean section: ${name}`);
    }
    assert.equal(await page.locator('html').getAttribute('lang'), 'ko');
    assert.equal(await page.evaluate(() => localStorage.getItem('cocotrip_lang')), savedCustomer);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    await page.locator('#ops-settings > summary').click();
    const languageSelect = page.getByRole('combobox', { name: '화면 언어', exact: true });
    assert.equal(await languageSelect.inputValue(), 'ko');
    const bounds = await languageSelect.boundingBox();
    assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, 'Language touch target');
    await languageSelect.focus();
    assert.ok(await languageSelect.evaluate(element => element === document.activeElement), 'Keyboard focus');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${artifacts}/ko-${width}-${savedCustomer}.png`, fullPage: true });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'AI 운영센터', exact: true }).waitFor();
    cases++;

    if (width === 390 && savedCustomer === 'en') {
      await page.locator('#ops-settings > summary').click();
      await languageSelect.selectOption('en');
      assert.equal(await page.evaluate(() => localStorage.getItem('cocotrip_admin_lang')), 'en');
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'Explicit admin preference persists');
      await page.locator('#ops-settings > summary').click();
      await page.locator('#ops-settings select').selectOption('ko');
      await page.getByRole('heading', { name: 'AI 운영센터', exact: true }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'cocotrip_lang', newValue: 'ja' })));
      assert.equal(await page.locator('html').getAttribute('lang'), 'ko', 'Customer tab cannot change admin language');
      await page.getByRole('link', { name: '관리자 홈으로', exact: true }).click();
      await page.getByRole('heading', { name: '관리자 로그인', exact: true }).waitFor();
      await page.screenshot({ path: `${artifacts}/login-390.png`, fullPage: true });
      assert.equal(await page.evaluate(() => localStorage.getItem('cocotrip_lang')), 'en');
      // Customer SPA restoration is covered by admin-language-scope.test.tsx;
      // this browser check stays on the changed admin screens.
      cases += 2;
    }
    await context.close();
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(forbidden, [], 'No API, customer data, or external requests');
  console.log(JSON.stringify({ ok: true, cases, widths: [390, 1280], existingCustomerLanguages: ['en', 'ja', 'zh'], externalCalls: 0, realLogin: false, realSend: false }));
} finally { await browser.close(); }
