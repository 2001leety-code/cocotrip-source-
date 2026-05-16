/**
 * PR #437 — Audit W-H11 regression slot.
 *
 * Pre-fix: 14 admin-* endpoints returned `Access-Control-Allow-Origin: *`.
 * Defense-in-depth gap: any site could fire admin POSTs from a victim's
 * browser. With our Bearer token auth the attacker can't read the token,
 * but the wildcard also blocks ever migrating to cookie-based admin auth
 * (browsers refuse credentialed requests against `*`). Audit flagged it.
 *
 * Post-fix: api/_shared/cors.js exposes:
 *   - isAdminCorsOriginAllowed(origin) — predicate
 *   - buildAdminCors(req, opts)        — headers WITHOUT Content-Type
 *   - buildAdminJsonCors(req, opts)    — headers WITH Content-Type
 * The Access-Control-Allow-Origin header is echoed back ONLY for
 * cocotripkr.com (prod) + cocotrip-source*.vercel.app (preview) +
 * localhost (dev). Vary: Origin is always set so CDN doesn't pin one
 * origin's response onto another's.
 *
 * All admin-* endpoints now import the helper instead of hardcoding `*`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isAdminCorsOriginAllowed,
  buildAdminCors,
  buildAdminJsonCors,
} from '../../api/_shared/cors.js';

function reqWith(origin?: string) {
  return { headers: origin ? { origin } : {} } as any;
}

describe('PR #437 W-H11 — isAdminCorsOriginAllowed', () => {
  it('allows production origins', () => {
    expect(isAdminCorsOriginAllowed('https://cocotripkr.com')).toBe(true);
    expect(isAdminCorsOriginAllowed('https://www.cocotripkr.com')).toBe(true);
  });

  it('allows Vercel preview origins (cocotrip-source*.vercel.app)', () => {
    expect(isAdminCorsOriginAllowed('https://cocotrip-source2026-abc.vercel.app')).toBe(true);
    expect(isAdminCorsOriginAllowed('https://cocotrip-source-123.vercel.app')).toBe(true);
  });

  it('allows local dev origins', () => {
    expect(isAdminCorsOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isAdminCorsOriginAllowed('http://localhost:3000')).toBe(true);
  });

  it('REJECTS arbitrary origins (the W-H11 fix point)', () => {
    expect(isAdminCorsOriginAllowed('https://evil.example.com')).toBe(false);
    expect(isAdminCorsOriginAllowed('https://cocotripkr.com.evil.com')).toBe(false);
    expect(isAdminCorsOriginAllowed('http://cocotripkr.com')).toBe(false); // http on prod domain — block
    expect(isAdminCorsOriginAllowed('https://other-vercel.vercel.app')).toBe(false);
    expect(isAdminCorsOriginAllowed('')).toBe(false);
    expect(isAdminCorsOriginAllowed(undefined as any)).toBe(false);
  });
});

describe('PR #437 W-H11 — buildAdminCors header shape', () => {
  it('echoes Allow-Origin only when origin is allowed', () => {
    const allowed = buildAdminCors(reqWith('https://cocotripkr.com'));
    expect(allowed['Access-Control-Allow-Origin']).toBe('https://cocotripkr.com');

    const blocked = buildAdminCors(reqWith('https://evil.com'));
    expect(blocked['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('ALWAYS sets Vary: Origin (so CDN caches per-origin response)', () => {
    expect(buildAdminCors(reqWith('https://cocotripkr.com'))['Vary']).toBe('Origin');
    expect(buildAdminCors(reqWith('https://evil.com'))['Vary']).toBe('Origin');
    expect(buildAdminCors(reqWith())['Vary']).toBe('Origin');
  });

  it('honours methods + headers overrides', () => {
    const h = buildAdminCors(reqWith('https://cocotripkr.com'), {
      methods: 'GET, PATCH, DELETE, OPTIONS',
      headers: 'Authorization, Content-Type, X-Admin-Action',
    });
    expect(h['Access-Control-Allow-Methods']).toBe('GET, PATCH, DELETE, OPTIONS');
    expect(h['Access-Control-Allow-Headers']).toBe('Authorization, Content-Type, X-Admin-Action');
  });

  it('buildAdminJsonCors adds Content-Type: application/json', () => {
    const h = buildAdminJsonCors(reqWith('https://cocotripkr.com'));
    expect(h['Content-Type']).toBe('application/json');
  });
});

describe('PR #437 W-H11 — all admin-* endpoints use the helper (no wildcard CORS regression)', () => {
  const adminFiles = readdirSync(resolve(process.cwd(), 'api'))
    .filter((f) => /^admin-.*\.js$/.test(f))
    .map((f) => resolve(process.cwd(), 'api', f));

  it('catalogue not empty — sanity', () => {
    expect(adminFiles.length).toBeGreaterThanOrEqual(14);
  });

  it.each(adminFiles)('%s: no hardcoded wildcard Access-Control-Allow-Origin', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/'Access-Control-Allow-Origin'\s*:\s*['"]\*['"]/);
  });

  it.each(adminFiles)('%s: imports cors helper', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/from\s*['"]\.\/_shared\/cors\.js['"]/);
  });
});
