import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readOwnerDispatchReadiness } from '../../api/_shared/ownerDispatchReadiness.js';
import { readOwnerNotificationConfig } from '../../api/_shared/owner-notification-policy.js';

function fixture(overrides: Record<string, string> = {}) {
  return {
    OWNER_EVENT_PUSH_ENABLED: 'true', VERCEL_ENV: 'production',
    OWNER_NOTIFICATION_UID: 'fake-owner', OWNER_NOTIFICATION_SUBSCRIPTION_ID: 'fake-owner_device',
    OWNER_NOTIFICATION_LANGUAGE: 'ko', OWNER_NOTIFICATION_RETENTION_DAYS: '7', ADMIN_EMAIL: 'fake@example.invalid',
    CRON_SECRET: 'fake-cron-secret-for-offline-tests-only',
    VAPID_PUBLIC_KEY: Buffer.alloc(65, 1).toString('base64url'),
    VITE_VAPID_PUBLIC_KEY: Buffer.alloc(65, 1).toString('base64url'),
    VAPID_PRIVATE_KEY: Buffer.alloc(32, 2).toString('base64url'),
    ...overrides,
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('owner server dispatch readiness: configuration only', () => {
  it.each([undefined, '', 'false', 'TRUE', ' true ', '0'])('keeps policy OFF for opt-in %j without inspecting any other setting', (flag) => {
    const reads: string[] = [];
    const env = new Proxy({}, { get(_target, key) {
      reads.push(String(key));
      if (key === 'OWNER_EVENT_PUSH_ENABLED') return flag;
      throw new Error('private setting must not be read while OFF');
    } });
    expect(readOwnerDispatchReadiness(env)).toEqual({ state: 'off', deliveryVerified: false });
    expect(reads).toEqual(['OWNER_EVENT_PUSH_ENABLED']);
  });

  it('does not opt in when no environment is passed', () => {
    expect(readOwnerDispatchReadiness()).toEqual({ state: 'off', deliveryVerified: false });
  });

  it.each(['preview', 'development', ''])('reports an enabled non-production environment %j as needing configuration', (environment) => {
    const env = fixture({ VERCEL_ENV: environment });
    expect(readOwnerNotificationConfig(env).code).toBe('PRODUCTION_REQUIRED');
    expect(readOwnerDispatchReadiness(env)).toEqual({ state: 'configuration_required', deliveryVerified: false });
  });

  it.each([
    ['OWNER_NOTIFICATION_UID', ''], ['OWNER_NOTIFICATION_SUBSCRIPTION_ID', 'someone-else_device'],
    ['OWNER_NOTIFICATION_LANGUAGE', 'unknown'], ['OWNER_NOTIFICATION_RETENTION_DAYS', '0'],
    ['OWNER_NOTIFICATION_RETENTION_DAYS', '91'], ['CRON_SECRET', 'too-short'],
    ['VAPID_PUBLIC_KEY', 'bad-key'], ['VITE_VAPID_PUBLIC_KEY', 'mismatch'],
    ['VAPID_PRIVATE_KEY', 'bad-key'], ['ADMIN_EMAIL', ''], ['VAPID_SUBJECT', 'https://example.invalid'],
  ])('reuses the existing policy rejection for %s=%s', (name, value) => {
    const env = fixture({ [name]: value });
    expect(readOwnerNotificationConfig(env).code).toBe('CONFIGURATION_REQUIRED');
    expect(readOwnerDispatchReadiness(env)).toEqual({ state: 'configuration_required', deliveryVerified: false });
  });

  it('returns only the allowlisted summary even when valid configuration contains private values', () => {
    const env = fixture();
    expect(readOwnerNotificationConfig(env).code).toBe('CONFIGURED');
    const result = readOwnerDispatchReadiness(env);
    expect(result).toEqual({ state: 'configured', deliveryVerified: false });
    expect(Object.keys(result).sort()).toEqual(['deliveryVerified', 'state']);
    for (const key of ['OWNER_NOTIFICATION_UID', 'OWNER_NOTIFICATION_SUBSCRIPTION_ID', 'ADMIN_EMAIL', 'CRON_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const) {
      expect(JSON.stringify(result)).not.toContain(env[key]);
    }
  });

  it('fails unknown without logging or returning a private exception', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = new Proxy({}, { get() { throw new Error('private-credential-sentinel'); } });
    expect(readOwnerDispatchReadiness(env)).toEqual({ state: 'unknown', deliveryVerified: false });
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });

  it('makes no external request and imports no account, database or delivery module', () => {
    const fetch = vi.fn(() => { throw new Error('external request forbidden'); });
    vi.stubGlobal('fetch', fetch);
    expect(readOwnerDispatchReadiness(fixture()).state).toBe('configured');
    expect(fetch).not.toHaveBeenCalled();
    const source = readFileSync(new URL('../../api/_shared/ownerDispatchReadiness.js', import.meta.url), 'utf8');
    expect(source.match(/^import .+$/gm)).toEqual(["import { readOwnerNotificationConfig } from './owner-notification-policy.js';"]);
    expect(source).not.toMatch(/process\.env|console\.|fetch\(|\.\.\.config|OWNER_EVENT_PUSH_ENABLED\s*:/);
  });
});
