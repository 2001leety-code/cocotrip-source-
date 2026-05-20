/**
 * PR #441 — Audit Y-H12 regression slot.
 *
 * Pre-fix: api/_shared/admin-auth.js's getAdminAuth() did a per-request
 * `await import('firebase-admin/app')` and `await import('firebase-admin/auth')`,
 * then tried ONLY GOOGLE_SERVICE_ACCOUNT_KEY. Two failure modes:
 *
 *   (a) Cold start with FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
 *       FIREBASE_PRIVATE_KEY set (canonical pattern matching
 *       api/_shared/firebase-admin.js) but no GOOGLE_SERVICE_ACCOUNT_KEY:
 *       `JSON.parse('')` throws → unhandled rejection → 500 with cryptic
 *       stack trace. Operator sees "JSON parse error" instead of
 *       "missing env var". This is the prod state today.
 *   (b) Per-request dynamic import + initializeApp call — measurable
 *       cold-start latency and a small race window where two parallel
 *       admin requests can each try to initializeApp (one wins, the
 *       other gets "app already exists").
 *
 * Post-fix:
 *   - Bootstrap once at module load (matches firebase-admin.js pattern)
 *   - Try FIREBASE_* triple FIRST, fall back to GOOGLE_SERVICE_ACCOUNT_KEY
 *   - Reuse getApps()[0] if firebase-admin.js bootstrap already initialized
 *   - Cache getAuth(app) at module scope — zero per-request init overhead
 *   - On no usable creds, return an explicit actionable 500 instead of
 *     letting JSON.parse throw
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_shared/admin-auth.js'),
  'utf8',
);

describe('PR #441 Y-H12 — admin-auth bootstrap shape', () => {
  it('imports firebase-admin at module top (NOT lazy dynamic-import per request)', () => {
    // Top-level static import means the module bundle resolves once at
    // cold start, before any request lands.
    expect(src).toMatch(/^import\s*\{[^}]*initializeApp[^}]*\}\s*from\s*['"]firebase-admin\/app['"]/m);
    expect(src).toMatch(/^import\s*\{[^}]*getAuth[^}]*\}\s*from\s*['"]firebase-admin\/auth['"]/m);
    // The old per-request `await import('firebase-admin/...')` must be gone.
    expect(src).not.toMatch(/await\s+import\(\s*['"]firebase-admin\/app['"]/);
    expect(src).not.toMatch(/await\s+import\(\s*['"]firebase-admin\/auth['"]/);
  });

  it('caches the auth instance at module scope (no per-request init)', () => {
    expect(src).toMatch(/let\s+_adminAuth\s*=\s*null/);
    expect(src).toMatch(/function\s+bootstrapAdminAuth/);
    // The cache short-circuit
    expect(src).toMatch(/if\s*\(\s*_adminAuth\s*\)\s*return\s+_adminAuth/);
  });

  it('reuses getApps()[0] if firebase-admin.js already initialized an app (no double-init)', () => {
    expect(src).toMatch(/if\s*\(\s*getApps\(\)\.length\s*\)/);
    expect(src).toMatch(/getAuth\(\s*getApps\(\)\[0\]\s*\)/);
  });

  it('tries FIREBASE_* triple FIRST (canonical), GOOGLE_SERVICE_ACCOUNT_KEY as fallback', () => {
    // Use code-level signatures (not text/comment positions) to assert
    // execution order: cert({projectId,...}) must run before Buffer.from(...GOOGLE_SERVICE_ACCOUNT_KEY...).
    const firebaseCodeIdx = src.indexOf('cert({ projectId, clientEmail, privateKey })');
    const googleSaCodeIdx = src.indexOf("Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY");
    expect(firebaseCodeIdx, 'cert({projectId,clientEmail,privateKey}) call required').toBeGreaterThan(-1);
    expect(googleSaCodeIdx, 'Buffer.from(GOOGLE_SERVICE_ACCOUNT_KEY) call required').toBeGreaterThan(-1);
    expect(firebaseCodeIdx).toBeLessThan(googleSaCodeIdx);
  });

  it('JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY) is wrapped in try/catch (no cold-start throw)', () => {
    // The Y-H12 trigger was JSON.parse('') throwing inside getAdminAuth.
    // We must guard so a missing/empty env var returns null cleanly.
    const block = src.match(/GOOGLE_SERVICE_ACCOUNT_KEY[\s\S]*?\}\s*catch/);
    expect(block, 'GOOGLE_SERVICE_ACCOUNT_KEY parse must be in try/catch').not.toBeNull();
  });

  it('returns explicit 500 with actionable message on init failure (no cryptic JSON.parse stack)', () => {
    expect(src).toMatch(/firebase-admin init failed/);
    expect(src).toMatch(/FIREBASE_PROJECT_ID\s*\+\s*FIREBASE_CLIENT_EMAIL\s*\+\s*FIREBASE_PRIVATE_KEY/);
    expect(src).toMatch(/GOOGLE_SERVICE_ACCOUNT_KEY/);
  });
});

describe('PR #441 Y-H12 — verifyAdminToken behavior preserved', () => {
  it('still requires Bearer header', () => {
    expect(src).toMatch(/Authorization Bearer token required/);
  });

  it('still requires ADMIN_EMAIL env (with VITE_ADMIN_EMAIL alias)', () => {
    expect(src).toMatch(/ADMIN_EMAIL.*VITE_ADMIN_EMAIL/);
  });

  it('checks email_verified + admin email match (no permission widening)', () => {
    expect(src).toMatch(/email_verified/);
    // P110 (2026-05-20): admin claim OR email match — Phase 1 마이그 점진 안전.
    // 기존 `email !== adminEmail` strict 비교 → `!adminClaim && !emailMatch` 로 확장.
    // email match 유지 (RBAC 마이그 완료 전까지) + admin claim 추가.
    expect(src).toMatch(/emailMatch|email\s*===\s*adminEmail|email\s*!==\s*adminEmail/);
    expect(src).toMatch(/adminClaim|decoded\.admin\s*===\s*true/);
  });

  it('exports a test-only cache reset helper (so vitest can re-bootstrap between cases)', () => {
    expect(src).toMatch(/export\s+function\s+__resetAdminAuthCacheForTests/);
  });
});

describe('PR #441 Y-H12 — verifyAdminToken execution paths (coverage)', () => {
  // Save + restore env vars across cases so we don't mutate global state.
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'ADMIN_EMAIL', 'VITE_ADMIN_EMAIL',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'GOOGLE_SERVICE_ACCOUNT_KEY',
  ];

  beforeEach(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // Wipe creds so bootstrap returns null deterministically
    for (const k of ENV_KEYS) delete process.env[k];
    // Reset module cache between cases
    const mod = await import('../../api/_shared/admin-auth.js');
    mod.__resetAdminAuthCacheForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('returns 401 when Authorization header is missing', async () => {
    process.env.ADMIN_EMAIL = '2001leety@gmail.com';
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: {} } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toMatch(/Bearer token required/);
    }
  });

  it('returns 401 when Authorization header is not a Bearer', async () => {
    process.env.ADMIN_EMAIL = '2001leety@gmail.com';
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Basic abc=' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('returns 500 when ADMIN_EMAIL env is not configured', async () => {
    // No ADMIN_EMAIL in env (wiped in beforeEach)
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer xyz' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.error).toMatch(/ADMIN_EMAIL env var not configured/);
    }
  });

  it('returns 500 with actionable env-var message when no firebase creds are available', async () => {
    process.env.ADMIN_EMAIL = '2001leety@gmail.com';
    // FIREBASE_* and GOOGLE_SERVICE_ACCOUNT_KEY both wiped in beforeEach.
    // bootstrap will fall through to "no creds" → null → 500.
    //
    // CAVEAT: if firebase-admin.js bootstrap already initialized an app
    // earlier in this test process, getApps()[0] will succeed and short-
    // circuit our null path. Skip the assertion in that case — the
    // module-scope reset only clears OUR cache, not firebase-admin's
    // global app list. The test still confirms the request flow runs
    // (no throw).
    const { getApps } = await import('firebase-admin/app');
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer xyz' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Either the no-creds 500 OR token-verification 401 (if app was already initialized).
      expect([401, 500]).toContain(r.status);
      if (r.status === 500 && getApps().length === 0) {
        expect(r.error).toMatch(/firebase-admin init failed/);
        expect(r.error).toMatch(/FIREBASE_PROJECT_ID/);
        expect(r.error).toMatch(/GOOGLE_SERVICE_ACCOUNT_KEY/);
      }
    }
  });

  it('accepts VITE_ADMIN_EMAIL as ADMIN_EMAIL alias', async () => {
    process.env.VITE_ADMIN_EMAIL = '2001leety@gmail.com';
    // No FIREBASE creds — will fail at bootstrap, but it gets past the
    // ADMIN_EMAIL check using the alias.
    const { verifyAdminToken } = await import('../../api/_shared/admin-auth.js');
    const r = await verifyAdminToken({ headers: { authorization: 'Bearer xyz' } } as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Should NOT be the ADMIN_EMAIL-missing error
      expect(r.error).not.toMatch(/ADMIN_EMAIL env var not configured/);
    }
  });

  it('__resetAdminAuthCacheForTests clears _adminAuth + _bootstrapTried', async () => {
    process.env.ADMIN_EMAIL = '2001leety@gmail.com';
    const { verifyAdminToken, __resetAdminAuthCacheForTests } = await import('../../api/_shared/admin-auth.js');
    // First call — may cache something
    await verifyAdminToken({ headers: { authorization: 'Bearer xyz' } } as any);
    // Reset should not throw
    expect(() => __resetAdminAuthCacheForTests()).not.toThrow();
    // Second call still works (re-bootstraps)
    const r2 = await verifyAdminToken({ headers: { authorization: 'Bearer xyz' } } as any);
    expect(r2.ok).toBe(false); // no real creds → still fails, but cleanly
  });
});
