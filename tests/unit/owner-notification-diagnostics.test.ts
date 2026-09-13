import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const harness = vi.hoisted(() => ({
  authorize: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../api/_shared/cron-auth.js', () => ({ verifyCronRequest: harness.authorize }));
vi.mock('../../api/_shared/log.js', () => ({ logger: { info: harness.info, warn: harness.warn } }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => { throw new Error('TEST_SERVICES_UNAVAILABLE'); },
}));

import ownerNotificationSweep, { ownerNotificationSweepTask } from '../../api/_crons/owner-notification-sweep.js';
import { ownerSweepDiagnostic } from '../../api/_shared/owner-notification-diagnostics.js';
import { readOwnerNotificationConfig } from '../../api/_shared/owner-notification-policy.js';

const UID = 'diagnostic-owner';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/diagnostic-owner';
const SUBSCRIPTION_ID = `${UID}_${Buffer.from(ENDPOINT).toString('base64').slice(-32)}`;
const PRIVATE_SENTINELS = ['cursor-sentinel-that-is-longer-than-thirty-two-bytes', 'private-vapid-sentinel'];
const key = (size: number, byte = 7) => Buffer.alloc(size, byte).toString('base64url');
const ISSUES = [
  'OWNER_UID_INVALID', 'OWNER_SUBSCRIPTION_INVALID', 'ADMIN_EMAIL_MISSING', 'LANGUAGE_INVALID',
  'RETENTION_INVALID', 'CURSOR_SECRET_INVALID', 'VAPID_PUBLIC_KEY_INVALID', 'VAPID_PRIVATE_KEY_INVALID',
  'VAPID_PUBLIC_KEY_MISMATCH', 'VAPID_SUBJECT_INVALID',
];

function configuredEnv(overrides: Record<string, string> = {}) {
  return {
    OWNER_EVENT_PUSH_ENABLED: 'true',
    VERCEL_ENV: 'production',
    OWNER_NOTIFICATION_UID: UID,
    OWNER_NOTIFICATION_SUBSCRIPTION_ID: SUBSCRIPTION_ID,
    ADMIN_EMAIL: 'owner@example.invalid',
    OWNER_NOTIFICATION_LANGUAGE: 'ko',
    OWNER_NOTIFICATION_RETENTION_DAYS: '30',
    CRON_SECRET: PRIVATE_SENTINELS[0],
    VAPID_PUBLIC_KEY: key(65),
    VITE_VAPID_PUBLIC_KEY: key(65),
    VAPID_PRIVATE_KEY: key(32),
    VAPID_SUBJECT: 'mailto:owner@example.invalid',
    ...overrides,
  };
}

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

beforeEach(() => {
  harness.authorize.mockReset().mockResolvedValue({ ok: true });
  harness.info.mockReset();
  harness.warn.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe('owner notification configuration diagnostics', () => {
  it('keeps OFF and non-production results structurally unchanged', () => {
    expect(readOwnerNotificationConfig({ OWNER_EVENT_PUSH_ENABLED: 'false' }))
      .toEqual({ ok: true, enabled: false, code: 'DISABLED' });
    expect(readOwnerNotificationConfig({ OWNER_EVENT_PUSH_ENABLED: 'true', VERCEL_ENV: 'preview' }))
      .toEqual({ ok: false, enabled: false, code: 'PRODUCTION_REQUIRED' });
  });

  it('returns every fixed issue code without configuration values', () => {
    const result = readOwnerNotificationConfig(configuredEnv({
      OWNER_NOTIFICATION_UID: '',
      OWNER_NOTIFICATION_SUBSCRIPTION_ID: 'other_device',
      ADMIN_EMAIL: '',
      OWNER_NOTIFICATION_LANGUAGE: 'unknown',
      OWNER_NOTIFICATION_RETENTION_DAYS: '0',
      CRON_SECRET: 'short',
      VAPID_PUBLIC_KEY: 'bad',
      VITE_VAPID_PUBLIC_KEY: 'different',
      VAPID_PRIVATE_KEY: 'bad',
      VAPID_SUBJECT: 'https://not-mailto.invalid',
    }));

    expect(result).toEqual({ ok: false, enabled: false, code: 'CONFIGURATION_REQUIRED', issues: ISSUES });
    expect(JSON.stringify(result)).not.toContain('different');
  });

  it.each([
    ['invalid owner id', { OWNER_NOTIFICATION_UID: 'bad/id' }, 'OWNER_UID_INVALID'],
    ['wrong subscription namespace', { OWNER_NOTIFICATION_SUBSCRIPTION_ID: 'other_device' }, 'OWNER_SUBSCRIPTION_INVALID'],
    ['missing admin email', { ADMIN_EMAIL: '' }, 'ADMIN_EMAIL_MISSING'],
    ['unknown language', { OWNER_NOTIFICATION_LANGUAGE: 'xx' }, 'LANGUAGE_INVALID'],
    ['invalid retention', { OWNER_NOTIFICATION_RETENTION_DAYS: '91' }, 'RETENTION_INVALID'],
    ['short cursor secret', { CRON_SECRET: 'short' }, 'CURSOR_SECRET_INVALID'],
    ['malformed public VAPID key', { VAPID_PUBLIC_KEY: 'bad' }, 'VAPID_PUBLIC_KEY_INVALID'],
    ['malformed private VAPID key', { VAPID_PRIVATE_KEY: 'bad' }, 'VAPID_PRIVATE_KEY_INVALID'],
    ['mismatched public VAPID keys', { VITE_VAPID_PUBLIC_KEY: key(65, 8) }, 'VAPID_PUBLIC_KEY_MISMATCH'],
    ['invalid VAPID subject', { VAPID_SUBJECT: 'https://not-mailto.invalid' }, 'VAPID_SUBJECT_INVALID'],
  ])('fails closed for %s', (_label, override, issue) => {
    const result = readOwnerNotificationConfig(configuredEnv(override));
    expect(result).toEqual(expect.objectContaining({
      ok: false, enabled: false, code: 'CONFIGURATION_REQUIRED', issues: expect.arrayContaining([issue]),
    }));
  });

  it('keeps valid configured data unchanged while its diagnostic has no private values', () => {
    const config = readOwnerNotificationConfig(configuredEnv());
    expect(config).toEqual(expect.objectContaining({ ok: true, enabled: true, code: 'CONFIGURED' }));

    const diagnostic = ownerSweepDiagnostic({
      code: 'CHECKED', phase: 'DELIVERY', issues: [], config,
      error: config.cursorSecret, request: { endpoint: config.privateKey },
    });
    expect(diagnostic).toEqual({ code: 'CHECKED', phase: 'DELIVERY', issues: [] });
    for (const secret of [config.cursorSecret, config.privateKey, config.publicKey]) {
      expect(JSON.stringify(diagnostic)).not.toContain(secret);
    }
  });
});

describe('owner sweep diagnostic projection and logging', () => {
  it('allowlists known codes and phases, and rejects injected values and duplicate issues', () => {
    expect(ownerSweepDiagnostic({
      code: 'NOT_A_CODE', phase: 'NOT_A_PHASE',
      issues: ['OWNER_UID_INVALID', 'untrusted', 'OWNER_UID_INVALID', 'VAPID_SUBJECT_INVALID'],
      error: PRIVATE_SENTINELS[0], request: { token: PRIVATE_SENTINELS[1] },
    })).toEqual({
      code: 'UNKNOWN', phase: 'UNKNOWN', issues: ['OWNER_UID_INVALID', 'VAPID_SUBJECT_INVALID'],
    });

    for (const phase of ['CONFIGURATION', 'SERVICES', 'INBOX_CONFIGURATION', 'DEVICE', 'CONTROL', 'SOURCES', 'DELIVERY', 'CLEANUP']) {
      expect(ownerSweepDiagnostic({ code: 'CHECKED', phase, issues: [] })).toEqual({ code: 'CHECKED', phase, issues: [] });
    }
  });

  it('does no SDK work for malformed configuration and returns its projected issue list', async () => {
    const loadServices = vi.fn();
    const result = await ownerNotificationSweepTask({
      env: configuredEnv({ OWNER_NOTIFICATION_UID: '', OWNER_NOTIFICATION_SUBSCRIPTION_ID: '' }),
      loadServices,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false, enabled: false, code: 'CONFIGURATION_REQUIRED', phase: 'CONFIGURATION',
      issues: expect.arrayContaining(['OWNER_UID_INVALID', 'OWNER_SUBSCRIPTION_INVALID']),
    }));
    expect(loadServices).not.toHaveBeenCalled();
  });

  it('logs only an authorized failure using the fixed diagnostic projection', async () => {
    for (const [name, value] of Object.entries(configuredEnv({
      OWNER_NOTIFICATION_UID: '', OWNER_NOTIFICATION_SUBSCRIPTION_ID: '', VAPID_SUBJECT: 'invalid',
    }))) vi.stubEnv(name, value);
    const res = response();

    await ownerNotificationSweep({}, res);

    expect(harness.warn).toHaveBeenCalledWith('[owner-notification-sweep]', {
      code: 'CONFIGURATION_REQUIRED', phase: 'CONFIGURATION',
      issues: expect.arrayContaining(['OWNER_UID_INVALID', 'OWNER_SUBSCRIPTION_INVALID', 'VAPID_SUBJECT_INVALID']),
    });
  });

  it('does not log when unauthorized or OFF', async () => {
    harness.authorize.mockResolvedValueOnce({ ok: false });
    await ownerNotificationSweep({}, response());
    expect(harness.info).not.toHaveBeenCalled();
    expect(harness.warn).not.toHaveBeenCalled();

    vi.stubEnv('OWNER_EVENT_PUSH_ENABLED', 'false');
    await ownerNotificationSweep({}, response());
    expect(harness.info).not.toHaveBeenCalled();
    expect(harness.warn).not.toHaveBeenCalled();
  });

  it('logs only fixed VAPID booleans after authorization and preserves the sweep result', async () => {
    for (const [name, value] of Object.entries(configuredEnv())) vi.stubEnv(name, value);
    const res = response();

    await ownerNotificationSweep({}, res);

    expect(harness.info).toHaveBeenCalledTimes(1);
    expect(harness.info).toHaveBeenCalledWith('[owner-push-auth]', {
      publicKeyValid: expect.any(Boolean), privateKeyValid: expect.any(Boolean), pairMatches: expect.any(Boolean),
    });
    const diagnostic = harness.info.mock.calls[0][1];
    expect(Object.keys(diagnostic).sort()).toEqual(['pairMatches', 'privateKeyValid', 'publicKeyValid']);
    expect(JSON.stringify(diagnostic)).not.toContain(PRIVATE_SENTINELS[1]);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, enabled: true, code: 'OWNER_SWEEP_FAILED' }));
  });

  it('keeps the handler warning bound to the sanitized diagnostic helper', () => {
    const source = readFileSync(new URL('../../api/_crons/owner-notification-sweep.js', import.meta.url), 'utf8');
    expect(source).toContain("logger.warn('[owner-notification-sweep]', ownerSweepDiagnostic(result))");
    expect(source).not.toMatch(/logger\.warn\([^\n]*error|logger\.warn\([^\n]*request/);
  });
});
