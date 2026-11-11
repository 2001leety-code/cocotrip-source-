import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSafeOnboardingDryRunResponse } from '../../scripts/lib/admin-onboarding-dryrun-result.mjs';

const valid = { dryRun: true, issued: 0, alreadyIssued: 0, errors: 0, candidates: 1 };

describe('admin CI read-only response contract', () => {
  it.each([0, 1])('accepts only a bounded successful dryRun with %i candidates', candidates => {
    expect(isSafeOnboardingDryRunResponse(200, { ok: true, results: { ...valid, candidates } })).toBe(true);
  });

  it.each([
    null, {}, { issued: 3 }, { issued: 0, alreadyIssued: 0 },
    { ...valid, dryRun: false }, { ...valid, dryRun: 'true' },
    { ...valid, issued: 3 }, { ...valid, alreadyIssued: 1 }, { ...valid, errors: 1 },
    { ...valid, candidates: -1 }, { ...valid, candidates: 2 }, { ...valid, candidates: 0.5 },
    { ...valid, candidates: '1' }, { ...valid, candidates: undefined },
  ])('rejects legacy, writing, ambiguous, or incomplete responses: %j', results => {
    expect(isSafeOnboardingDryRunResponse(200, { ok: true, results })).toBe(false);
  });

  it('rejects HTTP errors and legacy envelope fallbacks', () => {
    expect(isSafeOnboardingDryRunResponse(500, { ok: true, results: valid })).toBe(false);
    expect(isSafeOnboardingDryRunResponse(200, { ok: false, results: valid })).toBe(false);
    expect(isSafeOnboardingDryRunResponse(200, { ok: true, data: valid })).toBe(false);
    expect(isSafeOnboardingDryRunResponse(200, valid)).toBe(false);
    expect(isSafeOnboardingDryRunResponse(200, null)).toBe(false);
  });

  it('wires the real CI script to strict validation without executing its live requests', () => {
    const source = readFileSync(new URL('../../scripts/validate-prod-admin-auth.mjs', import.meta.url), 'utf8');
    expect(source).toContain("import { isSafeOnboardingDryRunResponse } from './lib/admin-onboarding-dryrun-result.mjs'");
    expect(source).toContain('adm4Pass = isSafeOnboardingDryRunResponse(r.status, body)');
    expect(source).toContain('body: JSON.stringify({ pageSize: 1, dryRun: true })');
    expect(source).toContain("body: '{\"dryRun\":true,\"pageSize\":1}'");
    expect(source).not.toContain('legacyShapeOk');
  });
});
