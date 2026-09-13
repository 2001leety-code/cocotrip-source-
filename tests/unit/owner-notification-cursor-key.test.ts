import { describe, expect, it } from 'vitest';
import {
  openOwnerCursor, readOwnerNotificationConfig, sealOwnerCursor,
} from '../../api/_shared/owner-notification-policy.js';

const UID = 'cursor-key-owner';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/cursor-key-device';
const SUBSCRIPTION_ID = `${UID}_${Buffer.from(ENDPOINT).toString('base64').slice(-32)}`;
const LEGACY_SECRET = 'legacy-cursor-secret-that-is-longer-than-thirty-two-bytes';
const DEDICATED_SECRET = 'dedicated-cursor-secret-that-is-longer-than-thirty-two-bytes';
const key = (size: number, byte = 9) => Buffer.alloc(size, byte).toString('base64url');

function environment(overrides: Record<string, unknown> = {}) {
  return {
    OWNER_EVENT_PUSH_ENABLED: 'true',
    VERCEL_ENV: 'production',
    OWNER_NOTIFICATION_UID: UID,
    OWNER_NOTIFICATION_SUBSCRIPTION_ID: SUBSCRIPTION_ID,
    ADMIN_EMAIL: 'cursor-key-owner@example.invalid',
    OWNER_NOTIFICATION_LANGUAGE: 'ko',
    OWNER_NOTIFICATION_RETENTION_DAYS: '30',
    CRON_SECRET: LEGACY_SECRET,
    VAPID_PUBLIC_KEY: key(65),
    VITE_VAPID_PUBLIC_KEY: key(65),
    VAPID_PRIVATE_KEY: key(32),
    VAPID_SUBJECT: 'mailto:cursor-key-owner@example.invalid',
    ...overrides,
  };
}

describe('owner notification dedicated cursor encryption key', () => {
  it('falls back to CRON_SECRET only when the dedicated key is absent or undefined', () => {
    for (const env of [environment(), environment({ OWNER_NOTIFICATION_CURSOR_SECRET: undefined })]) {
      expect(readOwnerNotificationConfig(env)).toEqual(expect.objectContaining({
        ok: true, enabled: true, code: 'CONFIGURED', cursorSecret: LEGACY_SECRET,
      }));
    }
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    [null, 'null'],
    [1234, 'number'],
    ['short', 'short string'],
  ])('does not fall back for an explicit %s dedicated key', (dedicated) => {
    expect(readOwnerNotificationConfig(environment({ OWNER_NOTIFICATION_CURSOR_SECRET: dedicated })))
      .toEqual(expect.objectContaining({
        ok: false, enabled: false, code: 'CONFIGURATION_REQUIRED', issues: expect.arrayContaining(['CURSOR_SECRET_INVALID']),
      }));
  });

  it('trims and prefers a valid dedicated key even when the legacy key is short', () => {
    const dedicated = `  ${DEDICATED_SECRET}  `;
    const env = environment({ OWNER_NOTIFICATION_CURSOR_SECRET: dedicated, CRON_SECRET: 'short' });
    const original = structuredClone(env);
    const config = readOwnerNotificationConfig(env);

    expect(config).toEqual(expect.objectContaining({
      ok: true, enabled: true, code: 'CONFIGURED', cursorSecret: DEDICATED_SECRET,
    }));
    expect(env).toEqual(original);
  });

  it('enforces the exact 32-byte dedicated-key boundary', () => {
    expect(readOwnerNotificationConfig(environment({
      OWNER_NOTIFICATION_CURSOR_SECRET: 'd'.repeat(31),
    }))).toEqual(expect.objectContaining({
      ok: false, enabled: false, issues: expect.arrayContaining(['CURSOR_SECRET_INVALID']),
    }));
    expect(readOwnerNotificationConfig(environment({
      OWNER_NOTIFICATION_CURSOR_SECRET: 'd'.repeat(32), CRON_SECRET: 'short',
    }))).toEqual(expect.objectContaining({ ok: true, enabled: true, cursorSecret: 'd'.repeat(32) }));
  });

  it('keeps a short legacy key invalid when no dedicated key is set', () => {
    expect(readOwnerNotificationConfig(environment({ CRON_SECRET: 'short' })))
      .toEqual(expect.objectContaining({
        ok: false, enabled: false, issues: expect.arrayContaining(['CURSOR_SECRET_INVALID']),
      }));
  });

  it('does not change the stable control scope when selecting a dedicated key', () => {
    const legacy = readOwnerNotificationConfig(environment());
    const dedicated = readOwnerNotificationConfig(environment({ OWNER_NOTIFICATION_CURSOR_SECRET: DEDICATED_SECRET }));
    expect(legacy).toEqual(expect.objectContaining({ ok: true, enabled: true }));
    expect(dedicated).toEqual(expect.objectContaining({ ok: true, enabled: true }));
    expect(dedicated.scope).toBe(legacy.scope);
  });

  it('does not examine dedicated keys in disabled or non-production short-circuit paths', () => {
    expect(readOwnerNotificationConfig(environment({
      OWNER_EVENT_PUSH_ENABLED: 'false', OWNER_NOTIFICATION_CURSOR_SECRET: 'short', CRON_SECRET: 'short',
    }))).toEqual({ ok: true, enabled: false, code: 'DISABLED' });
    expect(readOwnerNotificationConfig(environment({
      VERCEL_ENV: 'preview', OWNER_NOTIFICATION_CURSOR_SECRET: 'short', CRON_SECRET: 'short',
    }))).toEqual({ ok: false, enabled: false, code: 'PRODUCTION_REQUIRED' });
  });

  it('uses the dedicated key for cursors independently of later CRON_SECRET changes', () => {
    const cursor = { time: { seconds: 123, nanoseconds: 456 }, id: 'cursor-key-event' };
    const encryptedWithDedicated = readOwnerNotificationConfig(environment({
      OWNER_NOTIFICATION_CURSOR_SECRET: DEDICATED_SECRET,
    }));
    const changedLegacy = readOwnerNotificationConfig(environment({
      OWNER_NOTIFICATION_CURSOR_SECRET: DEDICATED_SECRET,
      CRON_SECRET: 'different-legacy-secret-that-is-longer-than-thirty-two-bytes',
    }));

    const sealed = sealOwnerCursor(cursor, encryptedWithDedicated, 'bookings');
    expect(openOwnerCursor(sealed, changedLegacy, 'bookings')).toEqual(cursor);
  });

  it('rejects an existing dedicated-key cursor after key rotation instead of initializing silently', () => {
    const cursor = { time: { seconds: 123, nanoseconds: 456 }, id: 'cursor-key-event' };
    const first = readOwnerNotificationConfig(environment({ OWNER_NOTIFICATION_CURSOR_SECRET: DEDICATED_SECRET }));
    const rotated = readOwnerNotificationConfig(environment({
      OWNER_NOTIFICATION_CURSOR_SECRET: 'rotated-cursor-secret-that-is-longer-than-thirty-two-bytes',
    }));

    expect(() => openOwnerCursor(sealOwnerCursor(cursor, first, 'bookings'), rotated, 'bookings'))
      .toThrow('CURSOR_INVALID');
  });
});
