/**
 * PR #446 — Audit W-H18 regression slot.
 *
 * Pre-fix: src/App.tsx Routes had NO catch-all route. Unknown URL → no
 * <Route> matched → blank page. SEO: crawlers see 200 OK + empty body
 * (soft-404 penalty). UX: dead inbound links → user bounces.
 *
 * Post-fix:
 *   - new src/pages/NotFoundPage.tsx (i18n message + noindex meta tag +
 *     home/tours/charter recovery links)
 *   - <Route path="*" element={<NotFoundPage />} /> as the LAST route
 *     in App.tsx (must come last — react-router matches first-hit)
 *
 * This test asserts both files' shape so the catch-all + noindex tag
 * can't silently regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSrc = readFileSync(
  resolve(process.cwd(), 'src/App.tsx'),
  'utf8',
);
const notFoundSrc = readFileSync(
  resolve(process.cwd(), 'src/pages/NotFoundPage.tsx'),
  'utf8',
);

describe('PR #446 W-H18 — App.tsx catch-all 404 route', () => {
  it('lazy-imports NotFoundPage', () => {
    expect(appSrc).toMatch(/const\s+NotFoundPage\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]@\/pages\/NotFoundPage['"]/);
  });

  it('mounts <Route path="*" /> rendering NotFoundPage', () => {
    expect(appSrc).toMatch(/<Route\s+path=["']\*["'][\s\S]*?NotFoundPage/);
  });

  it('catch-all route is the LAST route in <Routes> (react-router first-match wins)', () => {
    const closeIdx = appSrc.indexOf('</Routes>');
    expect(closeIdx).toBeGreaterThan(-1);
    const catchAllIdx = appSrc.lastIndexOf('path="*"');
    expect(catchAllIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeLessThan(closeIdx);
    // No other <Route ...> appears between path="*" and </Routes>.
    const tail = appSrc.slice(catchAllIdx, closeIdx);
    // Allow only the closing of the catch-all's own <Route ... /> tag.
    const otherRoutes = tail.match(/<Route\s+path=/g) || [];
    expect(otherRoutes.length).toBeLessThanOrEqual(1);
  });
});

describe('PR #446 W-H18 — NotFoundPage SEO + UX', () => {
  it('sets <meta name="robots" content="noindex, follow"> via useEffect', () => {
    expect(notFoundSrc).toMatch(/meta\[name="robots"\]/);
    expect(notFoundSrc).toMatch(/tag\.content\s*=\s*['"]noindex,\s*follow['"]/);
  });

  it('restores previous robots meta on unmount (no poisoning of indexable pages)', () => {
    expect(notFoundSrc).toMatch(/return\s*\(\s*\)\s*=>\s*\{/);
    expect(notFoundSrc).toMatch(/if\s*\(\s*prev\s*===\s*null\s*\)\s*tag\.remove\(\)/);
    expect(notFoundSrc).toMatch(/else\s+tag\.content\s*=\s*prev/);
  });

  it('uses usePageMeta for title/description (consistent with other pages)', () => {
    expect(notFoundSrc).toMatch(/usePageMeta\s*\(/);
  });

  it('renders i18n copy for all 4 locales (en/ko/ja/zh)', () => {
    expect(notFoundSrc).toMatch(/en:\s*\{/);
    expect(notFoundSrc).toMatch(/ko:\s*\{/);
    expect(notFoundSrc).toMatch(/ja:\s*\{/);
    expect(notFoundSrc).toMatch(/zh:\s*\{/);
  });

  it('provides recovery navigation (home + tours + charter)', () => {
    expect(notFoundSrc).toMatch(/to="\/"/);
    expect(notFoundSrc).toMatch(/to="\/tours"/);
    expect(notFoundSrc).toMatch(/to="\/charter"/);
  });

  it('uses Header + Footer for consistent chrome (not a bare body)', () => {
    expect(notFoundSrc).toMatch(/import\s*\{\s*Header\s*\}\s*from/);
    expect(notFoundSrc).toMatch(/import\s*\{\s*Footer\s*\}\s*from/);
    expect(notFoundSrc).toMatch(/<Header\s*\/>/);
    expect(notFoundSrc).toMatch(/<Footer\s*\/>/);
  });

  it('falls back to en when language is unknown (defensive)', () => {
    expect(notFoundSrc).toMatch(/COPY\[lang\]\s*\|\|\s*COPY\.en/);
  });

  it('sets aria-labelledby on <main> for screen readers', () => {
    expect(notFoundSrc).toMatch(/role="main"/);
    expect(notFoundSrc).toMatch(/aria-labelledby="not-found-title"/);
    expect(notFoundSrc).toMatch(/id="not-found-title"/);
  });
});
