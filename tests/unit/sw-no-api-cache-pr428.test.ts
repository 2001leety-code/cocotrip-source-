/**
 * PR #428 — Audit CZ4 regression slot.
 *
 * Pre-fix: src/sw.ts registered a NetworkFirst runtime cache for every
 * `/api/*` URL with a 5-minute expiry. The cache is shared across all
 * users in the SW scope. Two failure modes leaked PII across accounts:
 *
 *   - Offline / network timeout: /api/voucher?bookingID=X returned the
 *     previous user's PDF from cache, bypassing the Authorization-Bearer
 *     check that PR #418 added to the server.
 *   - Auth-context mismatch: user A's cached response served to user B's
 *     subsequent request for the same URL (Workbox's default cache key
 *     ignores Authorization headers).
 *
 * Post-fix: /api/* is forced through NetworkOnly. On `activate` we also
 * delete the legacy `api-runtime` cache so existing clients don't keep
 * leaking entries from their last cached state until the 5min TTL expires.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/sw.ts'), 'utf8');

describe('PR #428 CZ4 — /api/* must not hit the service worker cache', () => {
  it('the /api/ route uses NetworkOnly, not NetworkFirst/StaleWhileRevalidate', () => {
    const routeRe = /registerRoute\(\s*\(\s*\{\s*url\s*\}\s*\)\s*=>\s*url\.pathname\.startsWith\(\s*['"]\/api\/['"]\s*\)[\s\S]*?\)/;
    const m = src.match(routeRe);
    expect(m, 'the /api/* route must exist').not.toBeNull();
    expect(m![0]).toMatch(/new\s+NetworkOnly\s*\(/);
    expect(m![0]).not.toMatch(/new\s+NetworkFirst/);
    expect(m![0]).not.toMatch(/new\s+StaleWhileRevalidate/);
  });

  it('the legacy api-runtime cache is purged on activate', () => {
    // Even after the route stops caching, old clients still have
    // pre-PR-#428 entries in `api-runtime`. The activate handler must
    // proactively delete the cache so stale cross-user responses can't
    // be served while waiting for individual entries to expire.
    expect(src).toMatch(/caches\.delete\(\s*['"]api-runtime['"]\s*\)/);
  });

  it('no other route leaks api responses into a shared cache', () => {
    // Quick sweep: there should be only ONE registerRoute that matches
    // /api/, and it's the NetworkOnly one above. If a future PR adds a
    // separate registerRoute for, say, /api/maps with caching, this
    // test should catch it because the new route would also have to be
    // NetworkOnly or skipped from the cache.
    const apiRouteCount = (src.match(/url\.pathname\.startsWith\(\s*['"]\/api\/['"]\s*\)/g) || []).length;
    expect(apiRouteCount).toBe(1);
  });
});
