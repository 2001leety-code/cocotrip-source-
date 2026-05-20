/**
 * Coverage for api/_shared/admin-auth.js + api/admin-set-claims.js — P110
 * (2026-05-20) RBAC Phase 1 foundation.
 *
 * Verifies:
 *   1. extractRoles — schema sanitization (defensive against bad token).
 *   2. requireRole — super-admin bypass + exact match + missing/empty.
 *   3. sanitizeRoles (admin-set-claims) — whitelist enforcement.
 *
 * verifyAdminToken integration tests intentionally NOT here (Firebase Admin
 * SDK call). Covered by manual prod smoke + future e2e once endpoint enabled.
 */
import { describe, it, expect } from 'vitest';
import { extractRoles, requireRole } from '../../api/_shared/admin-auth.js';
import { sanitizeRoles } from '../../api/admin-set-claims.js';

describe('extractRoles — schema sanitization', () => {
  it('returns [] for non-array input', () => {
    expect(extractRoles(undefined)).toEqual([]);
    expect(extractRoles(null)).toEqual([]);
    expect(extractRoles('super-admin')).toEqual([]); // string is not array
    expect(extractRoles({ super: true } as any)).toEqual([]);
  });

  it('returns [] for empty array', () => {
    expect(extractRoles([])).toEqual([]);
  });

  it('lowercases + trims each role string', () => {
    expect(extractRoles(['  Super-Admin  ', 'PRODUCT-MANAGER']))
      .toEqual(['super-admin', 'product-manager']);
  });

  it('filters out non-string + empty entries', () => {
    expect(extractRoles(['super-admin', '', 0 as any, null as any, 'cs']))
      .toEqual(['super-admin', 'cs']);
  });
});

describe('requireRole — super-admin bypass + exact match', () => {
  it('returns false for empty roles', () => {
    expect(requireRole([], 'product-manager')).toBe(false);
    expect(requireRole(undefined as any, 'product-manager')).toBe(false);
  });

  it('super-admin role passes any neededRole', () => {
    expect(requireRole(['super-admin'], 'cs')).toBe(true);
    expect(requireRole(['super-admin'], 'finance')).toBe(true);
    expect(requireRole(['super-admin'], 'product-manager')).toBe(true);
    expect(requireRole(['super-admin', 'cs'], 'finance')).toBe(true);
  });

  it('exact role match passes', () => {
    expect(requireRole(['product-manager'], 'product-manager')).toBe(true);
    expect(requireRole(['cs', 'finance'], 'cs')).toBe(true);
  });

  it('role mismatch fails (no implicit hierarchy except super-admin)', () => {
    expect(requireRole(['cs'], 'finance')).toBe(false);
    expect(requireRole(['product-manager'], 'driver-ops')).toBe(false);
  });
});

describe('sanitizeRoles (admin-set-claims) — whitelist enforcement', () => {
  it('returns [] for empty / non-array', () => {
    expect(sanitizeRoles([])).toEqual([]);
    expect(sanitizeRoles(undefined as any)).toEqual([]);
    expect(sanitizeRoles('super-admin' as any)).toEqual([]);
  });

  it('allows all 5 canonical roles', () => {
    const all = ['super-admin', 'product-manager', 'cs', 'finance', 'driver-ops'];
    expect(sanitizeRoles(all).sort()).toEqual(all.slice().sort());
  });

  it('strips unknown roles', () => {
    expect(sanitizeRoles(['product-manager', 'ghost-role', 'cs']))
      .toEqual(['product-manager', 'cs']);
  });

  it('lowercases + trims for whitelist check', () => {
    expect(sanitizeRoles([' Super-Admin ', 'CS']))
      .toEqual(['super-admin', 'cs']);
  });

  it('dedupes identical roles', () => {
    expect(sanitizeRoles(['cs', 'cs', 'CS']))
      .toEqual(['cs']);
  });

  it('returns subset preserving canonical lowercase', () => {
    const r = sanitizeRoles(['Product-Manager', 'BAD', 'DRIVER-OPS']);
    expect(r.length).toBe(2);
    expect(r).toContain('product-manager');
    expect(r).toContain('driver-ops');
    expect(r).not.toContain('BAD');
  });
});
