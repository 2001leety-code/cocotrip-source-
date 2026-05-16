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
import { describe, it, expect } from 'vitest';
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
    expect(src).toMatch(/email\s*!==\s*adminEmail/);
  });

  it('exports a test-only cache reset helper (so vitest can re-bootstrap between cases)', () => {
    expect(src).toMatch(/export\s+function\s+__resetAdminAuthCacheForTests/);
  });
});
