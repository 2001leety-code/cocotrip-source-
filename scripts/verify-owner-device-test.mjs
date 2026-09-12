import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:5189';
const url = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Synthetic harness must stay local');
const copy = {
  ko: ['이 기기 연결 확인', '이 기기에 시험 알림 보내기', '알림 서비스가 요청을 접수했습니다. 실제 도착 여부는 폰에서 확인해 주세요.'],
  en: ['Check this device', 'Send a test to this device', 'The notification service accepted the request. Check your phone to confirm arrival.'],
  ja: ['この端末の接続を確認', 'この端末にテスト通知を送る', '通知サービスがリクエストを受け付けました。実際の受信はスマホでご確認ください。'],
  zh: ['检查当前设备连接', '向该设备发送测试通知', '通知服务已接受请求，请在手机上确认是否实际收到。'],
};
await mkdir('tests/artifacts/owner-device-test', { recursive: true });
const browser = await chromium.launch({ headless: true });
let cases = 0;
const errors = [];
const forbidden = [];
try {
  for (const width of [390, 1280]) {
    for (const [language, words] of Object.entries(copy)) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== url.origin || requestUrl.pathname.startsWith('/api/')) {
          forbidden.push(requestUrl.origin === url.origin ? 'local-api-request' : 'external-request');
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`${base}/dev/owner-notifications`, { waitUntil: 'networkidle' });
      await page.getByLabel('언어', { exact: true }).selectOption(language);
      const check = page.getByRole('button', { name: words[0], exact: true });
      await check.click();
      const send = page.getByRole('button', { name: words[1], exact: true });
      await send.waitFor({ state: 'visible' });
      for (const button of [check, send]) {
        const bounds = await button.boundingBox();
        assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, 'Minimum touch target');
      }
      await send.focus();
      assert.ok(await send.evaluate(element => document.activeElement === element), 'Keyboard focus');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal overflow');
      if (language === 'ko' || language === 'zh') await page.screenshot({ path: `tests/artifacts/owner-device-test/${language}-${width}-ready.png`, fullPage: true });
      await send.press('Enter');
      await page.getByText(words[2], { exact: true }).waitFor();
      assert.equal(await send.count(), 0, 'No repeat send after acceptance');
      await check.click();
      assert.equal(await send.count(), 0, 'Read check cannot unlock repeat sending');
      if (language === 'ko') {
        for (const scenario of ['disabled', 'not-selected', 'unknown']) {
          await page.getByLabel('가상 시험 알림 상태', { exact: true }).selectOption(scenario);
          await check.click();
          if (scenario === 'unknown') {
            await send.click();
            await page.getByText('발송 결과를 확인하지 못했습니다. 중복 방지를 위해 다시 보내지 않습니다. 폰을 먼저 확인해 주세요.', { exact: true }).waitFor();
          } else await page.getByRole('status').filter({ hasText: scenario === 'disabled' ? '서버 자동 알림 설정' : '서버에 지정된 알림 대상이 아닙니다' }).waitFor();
          assert.equal(await send.count(), 0, 'Blocked state must not expose send');
          cases++;
        }
        await page.screenshot({ path: `tests/artifacts/owner-device-test/ko-${width}-unknown.png`, fullPage: true });
      }
      cases++;
      await context.close();
    }
  }
  assert.deepEqual(forbidden, [], 'No real API/external calls from synthetic harness');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(JSON.stringify({ ok: true, cases, widths: [390, 1280], languages: Object.keys(copy), realSend: false, realDeviceReceipt: false, externalCalls: 0 }));
} finally { await browser.close(); }
