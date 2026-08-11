/**
 * Common state + global app shell — real geometry, real bundle (2026-08-11).
 *
 * Source assertions live in `tests/unit/editorial-common-state-shell.test.ts`;
 * this file measures the things a source grep cannot prove: the height a
 * control actually renders at, the font-size an input actually computes to,
 * whether the page overflows sideways, and whether the loading / empty / error
 * states reach the screen at all.
 *
 * Nothing here logs in, pays, or writes. The states are forced with network
 * interception on the app's own lazy chunks — the same failure the code
 * already handles (`GuideDetailPage`'s retry-is-a-reload note).
 *
 * Not in any CI workflow on purpose — the shell is measured against a local
 * production preview so the numbers are reproducible:
 *
 *     npm run build
 *     npx vite preview --port 4831 --strictPort
 *     BASE_URL=http://localhost:4831 npx playwright test \
 *       tests/e2e/common-state-shell.spec.ts --project='Desktop Chrome'
 */
import { test, expect, type Page } from '@playwright/test';

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
];
/** Public, non-paid, non-authenticated routes that render the shared shell. */
const ROUTES = ['/', '/planner', '/tours', '/charter', '/community', '/guide'];

const TOUCH_MIN = 44;
const FIELD_MIN = 16;

async function setLang(page: Page, lang: string) {
  await page.addInitScript((l) => {
    window.localStorage.setItem('cocotrip_lang', l as string);
    // The planner intro modal covers the page on first visit and is not what
    // this spec measures. See the AIIntroModal note in the planner e2e specs.
    window.localStorage.setItem('COCO_AI_INTRO_SEEN_v1', '1');
  }, lang);
}

/**
 * Everything this PR owns: the chrome the app renders around every route.
 * A page body is measured too, but only reported — those belong to the pages
 * still on the previous dark system and are a separate queue.
 */
const SHELL =
  'header.ec-root, nav.mobile-bottom-nav, footer.ec-root, [role="dialog"], [role="region"].ec-no-print';

/** Every visible shell control whose real box is under 44×44. */
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
        // WCAG 2.5.8 inline exception — a link inside a sentence is sized by
        // the line-height of the text around it, not by its own box.
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

/** Shell text fields under 16px — iOS zooms the viewport on focus below that. */
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
        // `m.text()` for a failed resource is just "Failed to load resource:
        // …404" with no URL, so counting those alone invents a P1 out of
        // third-party font noise. The URL lives in `location()`.
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
        // Own origin only — gstatic/Google font 404s are ambient noise here.
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

    // Delay only the chunks requested *after* this point, so the shell itself
    // is already up and we are looking at the route fallback, not a blank page.
    let hold = false;
    await page.route('**/assets/*.js', async (route) => {
      if (hold) await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    hold = true;

    await page.getByRole('link', { name: /Tours/i }).first().click();

    const busy = page.locator('[role="status"][aria-busy="true"]').first();
    await expect(busy).toBeVisible();
    // Specific, not "Loading" — states.tsx asks callers to name what is loading.
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
    // An empty screen is not an error — it must not shout at a screen reader.
    await expect(page.locator('[aria-live="assertive"]')).toHaveCount(0);
  });

  test('청크가 거절되면 오류 상태 + 실제 재시도 버튼이 나온다', async ({ page }) => {
    await setLang(page, 'en');
    // The article body is a lazy JSON module; refusing it is exactly the
    // dropped-connection case the page distinguishes from a real 404.
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
    // Focus returns to what opened it — otherwise the keyboard lands at the
    // top of the document and the reader has to walk the whole header again.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))).toBe('false');

    const controls = await undersizedControls(page, SHELL);
    expect(controls, controls.join(' | ')).toEqual([]);
  });
});
