/**
 * Common state + global app shell. Not in any CI workflow on purpose — run it
 * against a local production preview:
 *
 *     npm run build
 *     npx vite preview --port 4831 --strictPort
 *     BASE_URL=http://localhost:4831 npx playwright test \
 *       tests/e2e/common-state-shell.spec.ts --project='Desktop Chrome'
 */
// ⚠️ test/expect 는 반드시 공용 analytics-guard 에서 — @playwright/test 에서 직접 가져오면
//    테스트 방문이 실제 GA4·PostHog 로 나가 운영 지표가 오염된다(mistake-lint R-P272).
import { test, expect } from './fixtures/analytics-guard';
import type { Page } from '@playwright/test';

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
];
const ROUTES = ['/', '/planner', '/tours', '/charter', '/community', '/guide'];

const TOUCH_MIN = 44;
const FIELD_MIN = 16;

async function setLang(page: Page, lang: string) {
  await page.addInitScript((l) => {
    window.localStorage.setItem('cocotrip_lang', l as string);
    window.localStorage.setItem('COCO_AI_INTRO_SEEN_v1', '1');
  }, lang);
}

const SHELL =
  'header.ec-root, nav.mobile-bottom-nav, footer.ec-root, [role="dialog"], [role="region"].ec-no-print';

function undersizedControls(page: Page, scope: string) {
  return page.evaluate(
    ([sel, min]) => {
      const roots = Array.from(document.querySelectorAll(sel as string));
      if (!roots.length) return [] as string[];
      const out: string[] = [];
      for (const el of Array.from(
        document.querySelectorAll('a[href], button, [role="button"], input, select, textarea'),
      )) {
        if (!roots.some((r) => r.contains(el))) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        // WCAG 2.5.8 inline exception.
        if (el.tagName === 'A' && el.closest('p')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        if (r.width < (min as number) - 0.5 || r.height < (min as number) - 0.5) {
          const label =
            el.getAttribute('aria-label') ||
            (el.textContent || '').trim().slice(0, 24) ||
            el.tagName.toLowerCase();
          out.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    },
    [scope, TOUCH_MIN] as const,
  );
}

function undersizedFields(page: Page, scope: string) {
  return page.evaluate(
    ([sel, min]) => {
      const roots = Array.from(document.querySelectorAll(sel as string));
      const out: string[] = [];
      const nodes = document.querySelectorAll(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="range"]), select, textarea',
      );
      for (const el of Array.from(nodes)) {
        if (!roots.some((r) => r.contains(el))) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < (min as number) - 0.01) {
          out.push(`${el.tagName.toLowerCase()}[${(el as HTMLInputElement).type || ''}] ${size}px`);
        }
      }
      return out;
    },
    [scope, FIELD_MIN] as const,
  );
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function dialogFocus(page: Page) {
  return page.evaluate((sel) => {
    const dialog = document.querySelector('[role="dialog"]');
    const active = document.activeElement as HTMLElement | null;
    const label = active
      ? active.getAttribute('aria-label') ||
        (active.textContent || '').trim().slice(0, 40) ||
        active.tagName.toLowerCase()
      : 'none';
    if (!dialog) return { count: 0, index: -1, inside: false, label };
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(sel)).filter(
      (el) => el.getClientRects().length > 0,
    );
    return {
      count: items.length,
      index: active ? items.indexOf(active) : -1,
      inside: !!(active && dialog.contains(active) && active !== dialog),
      label,
    };
  }, TABBABLE);
}

function focusDialogEdge(page: Page, edge: 'first' | 'last') {
  return page.evaluate(
    ([sel, pos]) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(sel as string)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (!items.length) return false;
      (pos === 'first' ? items[0] : items[items.length - 1]).focus();
      return true;
    },
    [TABBABLE, edge] as const,
  );
}

function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
}

/* ── 1. The floor, on every representative route × language × width ─────── */

for (const vp of VIEWPORTS) {
  test.describe(`shell floor @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const lang of LANGS) {
      test(`${lang} — 44px targets, 16px fields, no sideways overflow`, async ({ page }) => {
        await setLang(page, lang);

        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const badResponses: string[] = [];
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          consoleErrors.push(`${m.text()} @ ${m.location()?.url || '(no url)'}`);
        });
        page.on('pageerror', (e) => pageErrors.push(e.message));
        page.on('response', (r) => {
          const url = new URL(r.url());
          const own = url.host === new URL(page.url() || 'http://localhost').host;
          if (own && r.status() >= 400) badResponses.push(`${r.status()} ${url.pathname}`);
        });

        const problems: string[] = [];
        for (const route of ROUTES) {
          await page.goto(route, { waitUntil: 'networkidle' });

          const controls = await undersizedControls(page, SHELL);
          if (controls.length) problems.push(`${route} shell: ${controls.join(' | ')}`);

          const fields = await undersizedFields(page, SHELL);
          if (fields.length) problems.push(`${route} shell fields: ${fields.join(' | ')}`);

          const overflow = await horizontalOverflow(page);
          if (overflow > 1) problems.push(`${route} overflow: ${overflow}px`);
        }

        expect(problems, problems.join('\n')).toEqual([]);
        expect(pageErrors, pageErrors.join('\n')).toEqual([]);
        expect(badResponses, badResponses.join('\n')).toEqual([]);
        const origin = new URL(page.url()).origin;
        const own = consoleErrors.filter((e) => e.includes(`@ ${origin}`));
        expect(own, own.join('\n')).toEqual([]);
      });
    }
  });
}

/* ── 2. Route loading announces itself ──────────────────────────────────── */

test.describe('route fallback', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('lazy 라우트 청크가 뜨는 동안 announce 되는 상태가 보인다', async ({ page }) => {
    await setLang(page, 'en');
    await page.goto('/', { waitUntil: 'networkidle' });

    let hold = false;
    await page.route('**/assets/*.js', async (route) => {
      if (hold) await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    hold = true;

    await page.getByRole('link', { name: /Tours/i }).first().click();

    const busy = page.locator('[role="status"][aria-busy="true"]').first();
    await expect(busy).toBeVisible();
    await expect(busy).toContainText(/loading the page/i);
    hold = false;
    await expect(page).toHaveURL(/\/tours/);
  });
});

/* ── 3. Empty and error carry a title, a body and one real action ───────── */

test.describe('empty · error', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('없는 글은 빈 상태 — 목록으로 돌아가는 44px CTA 를 준다', async ({ page }) => {
    await setLang(page, 'en');
    await page.goto('/guide/this-guide-does-not-exist', { waitUntil: 'networkidle' });

    const cta = page.getByRole('link', { name: /guide/i }).filter({ hasNot: page.locator('img') }).last();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(TOUCH_MIN - 0.5);
    await expect(page.locator('[aria-live="assertive"]')).toHaveCount(0);
  });

  test('청크가 거절되면 오류 상태 + 실제 재시도 버튼이 나온다', async ({ page }) => {
    await setLang(page, 'en');
    await page.route('**/assets/*.js', async (route) => {
      const url = route.request().url();
      if (/guide|content/i.test(url)) return route.abort();
      return route.continue();
    });
    await page.goto('/guide', { waitUntil: 'networkidle' });
    const first = page.locator('a[href^="/guide/"]').first();
    if (await first.count()) {
      await first.click();
      const alert = page.locator('[role="status"][aria-live="assertive"]');
      await expect(alert).toBeVisible({ timeout: 15000 });
      const retry = alert.getByRole('button').first();
      await expect(retry).toBeVisible();
      const box = await retry.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(TOUCH_MIN - 0.5);
    }
  });
});

/* ── 4. The shell's global overlay ──────────────────────────────────────── */

test.describe('global modal shell (mobile menu)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('dialog 로 선언되고, 포커스가 들어갔다 트리거로 돌아오고, 스크롤 잠금이 풀린다', async ({ page }) => {
    await setLang(page, 'ko');
    await page.goto('/', { waitUntil: 'networkidle' });

    const trigger = page.locator('header button[aria-expanded]').last();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-label', /탐색/);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('dialog');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    expect(await page.evaluate(() => document.documentElement.dataset.menuOpen)).toBeUndefined();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))).toBe('false');

    const controls = await undersizedControls(page, SHELL);
    expect(controls, controls.join(' | ')).toEqual([]);
  });

  test('Tab·Shift+Tab 이 dialog 를 못 벗어난다 — 마지막→첫, 첫→마지막', async ({ page }) => {
    await setLang(page, 'en');
    await page.goto('/', { waitUntil: 'networkidle' });

    const trigger = page.locator('header button[aria-expanded]').last();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const opened = await dialogFocus(page);
    expect(opened.count, 'dialog has no tabbable controls').toBeGreaterThan(1);

    expect(await focusDialogEdge(page, 'last')).toBe(true);
    expect((await dialogFocus(page)).index).toBe(opened.count - 1);
    await page.keyboard.press('Tab');
    const forward = await dialogFocus(page);
    expect(forward.inside, `Tab left the dialog → "${forward.label}"`).toBe(true);
    expect(forward.index, 'Tab past the last control must land on the first').toBe(0);

    expect(await focusDialogEdge(page, 'first')).toBe(true);
    expect((await dialogFocus(page)).index).toBe(0);
    await page.keyboard.press('Shift+Tab');
    const backward = await dialogFocus(page);
    expect(backward.inside, `Shift+Tab left the dialog → "${backward.label}"`).toBe(true);
    expect(backward.index, 'Shift+Tab before the first control must land on the last').toBe(
      opened.count - 1,
    );

    const escapes: string[] = [];
    for (let i = 0; i < opened.count + 3; i++) {
      await page.keyboard.press('Tab');
      const s = await dialogFocus(page);
      if (!s.inside) escapes.push(`Tab #${i + 1} → "${s.label}"`);
    }
    for (let i = 0; i < opened.count + 3; i++) {
      await page.keyboard.press('Shift+Tab');
      const s = await dialogFocus(page);
      if (!s.inside) escapes.push(`Shift+Tab #${i + 1} → "${s.label}"`);
    }
    expect(escapes, escapes.join('\n')).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    expect(await page.evaluate(() => document.documentElement.dataset.menuOpen)).toBeUndefined();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))).toBe(
      'false',
    );
  });
});
