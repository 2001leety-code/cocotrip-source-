import { test, expect } from './fixtures/analytics-guard';
import type { Locator, Page } from '@playwright/test';

type Guard = {
  external: string[];
  api: string[];
  apiStatuses: number[];
  pageErrors: string[];
  release: () => void;
  websocketClosed: number;
  inquiryBodies: Array<Record<string, unknown>>;
  inquiryHeaders: Array<Record<string, string>>;
};

type ApiMode = 'blocked' | 'success' | 'failure' | 'abort' | 'delay';

async function measureTextContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return { rgb: [255, 255, 255], alpha: 0 };
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      return { rgb: parts.slice(0, 3), alpha: parts[3] === undefined ? 1 : parts[3] };
    };
    const blend = (front: { rgb: number[]; alpha: number }, back: number[]) => front.rgb.map((v, i) => v * front.alpha + back[i] * (1 - front.alpha));
    const luminance = (rgb: number[]) => rgb.map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const foreground = parse(getComputedStyle(element).color);
    const layers: Array<{ rgb: number[]; alpha: number }> = [];
    let current: HTMLElement | null = element as HTMLElement;
    while (current) {
      layers.push(parse(getComputedStyle(current).backgroundColor));
      current = current.parentElement;
    }
    let background = [255, 255, 255];
    for (const layer of layers.reverse()) background = blend(layer, background);
    const fgLum = luminance(foreground.rgb);
    const bgLum = luminance(background);
    return {
      foreground: getComputedStyle(element).color,
      background: background.map((v) => Math.round(v)),
      contrast: (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05),
    };
  });
}

async function installNetworkGuard(page: Page, apiMode: ApiMode = 'blocked'): Promise<Guard> {
  let releaseDelay = () => {};
  const delayGate = apiMode === 'delay' ? new Promise<void>((resolve) => { releaseDelay = resolve; }) : null;
  const guard: Guard = {
    external: [], api: [], apiStatuses: [], pageErrors: [], release: () => releaseDelay(), websocketClosed: 0,
    inquiryBodies: [], inquiryHeaders: [],
  };
  page.on('pageerror', (error) => guard.pageErrors.push(error.message));
  await page.routeWebSocket('**/*', (webSocket) => {
    guard.websocketClosed += 1;
    webSocket.close();
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const loopback = url.origin === 'http://127.0.0.1:4177';
    if (!loopback) {
      guard.external.push(request.url());
      await route.abort();
      return;
    }
    if (url.pathname.startsWith('/api/')) guard.api.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === '/api/inquiry-submit') {
      try { guard.inquiryBodies.push(request.postDataJSON() as Record<string, unknown>); } catch { /* request body assertion stays optional on malformed input */ }
      guard.inquiryHeaders.push(request.headers());
      if (apiMode === 'abort') {
        await route.abort();
        return;
      }
      if (delayGate) await delayGate;
      const status = apiMode === 'success' ? 200 : 500;
      guard.apiStatuses.push(status);
      const body = status === 200
        ? { success: true, inquiryId: 'INQ-LOCAL-TEST', status: 'NEW' }
        : { success: false, code: 'INTERNAL_ERROR', error: 'local test failure' };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    if (url.pathname === '/api/flight-status' && apiMode === 'failure') {
      guard.apiStatuses.push(500);
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    guard.apiStatuses.push(response.status());
    await route.fulfill({ response });
  });
  return guard;
}

async function dismissCookieBanner(page: Page) {
  const dismiss = page.getByRole('button', { name: /^Dismiss$/i });
  if (await dismiss.count()) {
    await dismiss.first().click();
    await expect(dismiss.first()).toBeHidden();
  }
}

async function next(page: Page) {
  const button = page.getByRole('button', { name: /^(Next|Continue|다음|続行|下一步)$/i }).first();
  await expect(button).toBeEnabled();
  await button.click();
}

async function reachStep6(page: Page, vehicle: 'staria_9' | 'bus', advance = true) {
  await page.goto('/charter');
  await dismissCookieBanner(page);
  await page.locator('[data-origin-code="ICN"]').click();
  await next(page);
  await page.locator('[data-service="airport_transfer"]').click();
  await next(page);
  await page.locator('[data-testid="charter-destination-card"]').first().click();
  await next(page);
  const vehicleButton = vehicle === 'bus'
    ? page.getByRole('button', { name: /Charter Bus|대형버스|大型バス|大巴/i })
    : page.getByRole('button', { name: /9.*pax|9인승|9名|9人/i });
  if (vehicle === 'bus') await vehicleButton.click();
  await next(page);
  const date = page.locator('input[type="date"]').first();
  await date.fill('2099-06-15');
  const time = page.locator('input[type="time"]').first();
  await time.fill('10:00');
  await page.getByPlaceholder('HONG').fill('HONG');
  await page.getByPlaceholder('GILDONG').fill('GILDONG');
  const phoneInput = page.locator('input[placeholder*="1234"]');
  await phoneInput.fill('10 1234 5678');
  await page.locator('input[placeholder="you@email.com"]').fill('guest@example.test');
  await page.getByPlaceholder(/^e\.g\. L7 Myeongdong/i).fill('Incheon Airport');
  await page.getByPlaceholder(/KE5760|OZ521/i).fill('KE123');
  await page.getByRole('button', { name: /T1/i }).click();
  const terms = page.getByRole('checkbox').first();
  await terms.check();
  if (!advance) return;
  if (vehicle === 'bus') {
    await next(page);
    return;
  }
  await next(page);
}

test('guest reaches a real charter quote with no external requests', async ({ page }) => {
  const guard = await installNetworkGuard(page);
  await reachStep6(page, 'staria_9');
  await expect(page.getByRole('heading', { name: /Final Quote/i })).toBeVisible();
  await expect(page.getByText('₩124,800', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('$89', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'tmp/charter-local/staria-quote.png', fullPage: true });
  expect(guard.external, 'all non-loopback requests must be blocked').toEqual([]);
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toEqual([]);
  expect(guard.apiStatuses.every((status) => status === 418), 'all local API calls are server-blocked').toBe(true);
  expect(guard.pageErrors).toEqual([]);
});

test('bus inquiry validates, submits once, and surfaces server failure', async ({ page }) => {
  const guard = await installNetworkGuard(page, 'failure');
  await reachStep6(page, 'bus');
  await expect(page.getByRole('heading', { name: /Consultation Request/i })).toBeVisible();
  const submit = page.getByRole('button', { name: /Submit Inquiry/i });
  await expect(submit).toBeDisabled();
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('Local Guest');
  await inputs.nth(1).fill('guest@example.test');
  await page.locator('form input[type="date"]').fill('2099-06-15');
  await page.locator('form textarea').fill('Bus inquiry local test');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/Submission failed/i)).toBeVisible();
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toHaveLength(1);
  expect(guard.apiStatuses.filter((status) => status === 500)).toHaveLength(1);
  expect(guard.external, 'all non-loopback requests must be blocked').toEqual([]);
  expect(guard.pageErrors).toEqual([]);
  await page.screenshot({ path: 'tmp/charter-local/bus-inquiry-error.png', fullPage: true });
});

test('bus inquiry accepts the documented 200 response', async ({ page }) => {
  const guard = await installNetworkGuard(page, 'success');
  await reachStep6(page, 'bus');
  const submit = page.getByRole('button', { name: /Submit Inquiry/i });
  await page.locator('form input').nth(0).fill('Local Guest');
  await page.locator('form input').nth(1).fill('guest@example.test');
  await page.locator('form input[type="date"]').fill('2099-06-15');
  await page.locator('form textarea').fill('Bus inquiry local test');
  await submit.click();
  const successMessage = page.getByText(/We will respond shortly/i);
  await expect(successMessage).toBeVisible();
  await expect.poll(() => successMessage.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(209, 250, 229)');
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toHaveLength(1);
  expect(guard.apiStatuses).toContain(200);
  expect(guard.inquiryBodies[0]).toEqual(expect.objectContaining({
    name: 'Local Guest',
    email: 'guest@example.test',
    eventDate: '2099-06-15',
    pax: 2,
    vehicle: 'bus',
    details: 'Bus inquiry local test',
    wizardSnapshot: expect.objectContaining({ origin: 'ICN', service: 'airport_transfer' }),
  }));
  expect(guard.inquiryHeaders[0]).not.toHaveProperty('authorization');
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
});

test('mobile bus inquiry accepts the documented 200 response', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const guard = await installNetworkGuard(page, 'success');
  await reachStep6(page, 'bus');
  const submit = page.locator('form button[type="submit"]');
  await page.locator('form input').nth(0).fill('Local Guest');
  await page.locator('form input').nth(1).fill('guest@example.test');
  await page.locator('form input[type="date"]').fill('2099-06-15');
  await page.locator('form textarea').fill('Bus inquiry mobile local test');
  await expect(submit).toBeEnabled();
  await submit.click();
  const successMessage = page.getByText(/We will respond shortly/i);
  await expect(successMessage).toBeVisible();
  const contrast = await measureTextContrast(successMessage);
  console.log(`mobile success contrast ${JSON.stringify(contrast)}`);
  expect(contrast.contrast).toBeGreaterThanOrEqual(4.5);
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toHaveLength(1);
  expect(guard.apiStatuses).toContain(200);
  expect(guard.inquiryHeaders[0]).not.toHaveProperty('authorization');
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
  await successMessage.locator('..').screenshot({ path: 'tmp/charter-local/bus-inquiry-mobile-success.png' });
  await page.screenshot({ path: 'tmp/charter-local/bus-inquiry-mobile.png', fullPage: true });
});

test('duplicate inquiry click stays one request while the response is pending', async ({ page }) => {
  const guard = await installNetworkGuard(page, 'delay');
  await reachStep6(page, 'bus');
  const submit = page.locator('form button[type="submit"]');
  await page.locator('form input').nth(0).fill('Local Guest');
  await page.locator('form input').nth(1).fill('guest@example.test');
  await page.locator('form input[type="date"]').fill('2099-06-15');
  await page.locator('form textarea').fill('Bus inquiry local test');
  await submit.click();
  await expect(submit).toBeDisabled();
  await submit.click({ force: true });
  guard.release();
  await expect(page.getByText(/Submission failed/i)).toBeVisible();
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toHaveLength(1);
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
});

test('aborted inquiry request surfaces the client error state', async ({ page }) => {
  const guard = await installNetworkGuard(page, 'abort');
  await reachStep6(page, 'bus');
  const submit = page.getByRole('button', { name: /Submit Inquiry/i });
  await page.locator('form input').nth(0).fill('Local Guest');
  await page.locator('form input').nth(1).fill('guest@example.test');
  await page.locator('form input[type="date"]').fill('2099-06-15');
  await page.locator('form textarea').fill('Bus inquiry local test');
  await submit.click();
  await expect(page.getByText(/Submission failed/i)).toBeVisible();
  expect(guard.inquiryBodies).toHaveLength(1);
  expect(guard.apiStatuses.every((status) => status === 418)).toBe(true);
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
});

test('flight lookup failure is shown without leaving the loopback server', async ({ page }) => {
  const guard = await installNetworkGuard(page, 'failure');
  await reachStep6(page, 'staria_9', false);
  const lookup = page.getByRole('button', { name: /look up|arrival|도착|フライト|航班/i });
  await lookup.click();
  await expect(page.getByText(/Lookup service is temporarily unavailable|조회 서비스가 일시적으로/i)).toBeVisible();
  expect(guard.api.some((item) => item.includes('/api/flight-status'))).toBe(true);
  expect(guard.apiStatuses).toContain(500);
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
});

test('required inquiry fields stay disabled until complete', async ({ page }) => {
  const guard = await installNetworkGuard(page);
  await reachStep6(page, 'bus');
  const submit = page.getByRole('button', { name: /Submit Inquiry/i });
  await expect(submit).toBeDisabled();
  const name = page.locator('form input').nth(0);
  const email = page.locator('form input').nth(1);
  const date = page.locator('form input[type="date"]');
  const details = page.locator('form textarea');
  await name.fill('Local Guest');
  await email.fill('guest@example.test');
  await date.fill('2099-06-15');
  await details.fill('Bus inquiry local test');
  await expect(submit).toBeEnabled();
  await name.fill('A');
  await expect(submit).toBeDisabled();
  await name.fill('Local Guest');
  await email.fill('not-an-email');
  await expect(submit).toBeDisabled();
  await email.fill('guest@example.test');
  await date.fill('');
  await expect(submit).toBeDisabled();
  await date.fill('2099-06-15');
  await details.fill('');
  await expect(submit).toBeDisabled();
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toEqual([]);
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
});

test('repro: clearing previously entered charter fields must disable Step 5 Next', async ({ page }) => {
  const guard = await installNetworkGuard(page);
  await reachStep6(page, 'bus', false);
  const nextButton = page.getByRole('button', { name: /^(Next|Continue|다음|続行|下一步)$/i }).first();
  const lastName = page.getByPlaceholder('HONG');
  const firstName = page.getByPlaceholder('GILDONG');
  const flight = page.getByPlaceholder(/KE5760|OZ521/i);
  await lastName.fill('');
  console.log(JSON.stringify({
    phase: 'last-name-clear',
    nameFields: [await lastName.inputValue(), await firstName.inputValue()],
    flight: await flight.inputValue(),
    nextEnabled: await nextButton.isEnabled(),
  }));
  await expect.soft(nextButton).toBeDisabled({ timeout: 3000 });
  await lastName.fill('HONG');
  await expect.soft(nextButton).toBeEnabled({ timeout: 3000 });

  await firstName.fill('');
  console.log(JSON.stringify({
    phase: 'first-name-clear',
    nameFields: [await lastName.inputValue(), await firstName.inputValue()],
    flight: await flight.inputValue(),
    nextEnabled: await nextButton.isEnabled(),
  }));
  await expect.soft(nextButton).toBeDisabled({ timeout: 3000 });
  await firstName.fill('GILDONG');
  await expect.soft(nextButton).toBeEnabled({ timeout: 3000 });

  await lastName.fill('');
  await firstName.fill('');
  console.log(JSON.stringify({
    phase: 'both-name-clear',
    nameFields: [await lastName.inputValue(), await firstName.inputValue()],
    flight: await flight.inputValue(),
    nextEnabled: await nextButton.isEnabled(),
  }));
  await page.screenshot({ path: 'tmp/charter-local/charter-name-clear-repro.png', fullPage: true });
  await expect.soft(nextButton).toBeDisabled({ timeout: 3000 });

  await lastName.fill('HONG');
  await firstName.fill('GILDONG');
  await expect.soft(nextButton).toBeEnabled({ timeout: 3000 });

  await flight.fill('');
  console.log(JSON.stringify({
    phase: 'flight-clear',
    nameFields: [await lastName.inputValue(), await firstName.inputValue()],
    flight: await flight.inputValue(),
    nextEnabled: await nextButton.isEnabled(),
  }));
  await page.screenshot({ path: 'tmp/charter-local/charter-flight-clear-repro.png', fullPage: true });
  await expect.soft(nextButton).toBeDisabled({ timeout: 3000 });

  await flight.fill('KE123');
  await expect.soft(nextButton).toBeEnabled({ timeout: 3000 });
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toEqual([]);
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
});

test('repro: clearing Step 5 fields stays blocked at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const guard = await installNetworkGuard(page);
  await reachStep6(page, 'bus', false);
  const nextButton = page.getByRole('button', { name: /^(Next|Continue|다음|続行|下一步)$/i }).first();
  const lastName = page.getByPlaceholder('HONG');
  const firstName = page.getByPlaceholder('GILDONG');
  const flight = page.getByPlaceholder(/KE5760|OZ521/i);

  await lastName.fill('');
  await firstName.fill('');
  await expect(nextButton).toBeDisabled();
  await lastName.fill('HONG');
  await firstName.fill('GILDONG');
  await expect(nextButton).toBeEnabled();
  await flight.fill('');
  await expect(nextButton).toBeDisabled();
  await flight.fill('KE123');
  await expect(nextButton).toBeEnabled();
  expect(guard.api.filter((item) => item.includes('/api/inquiry-submit'))).toEqual([]);
  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
  await page.screenshot({ path: 'tmp/charter-local/charter-input-clear-mobile.png', fullPage: true });
});
