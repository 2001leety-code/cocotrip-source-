/* eslint-disable @typescript-eslint/no-explicit-any -- handler and serial Firestore doubles. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_shared/owner-notification-delivery.js', () => ({
  readSelectedOwnerDevice: vi.fn(), sendSingleOwnerPush: vi.fn(),
}));

import { createAdminOwnerNotificationTestHandler } from '../../api/admin-owner-notification-test.js';
import { readSelectedOwnerDevice } from '../../api/_shared/owner-notification-delivery.js';
import { ownerHash } from '../../api/_shared/owner-notification-policy.js';
import { ownerNotificationTestTask, parseOwnerNotificationTestBody } from '../../api/_shared/owner-notification-test.js';

const nowMs = 1_750_000_000_000;
const config = { enabled: true, uid: 'owner', subscriptionId: 'owner_device', scope: 'a'.repeat(64), language: 'ko' };
const device = { deviceHash: 'b'.repeat(64), subscription: {
  endpoint: 'https://fcm.googleapis.com/fcm/send/selected-owner-only', keys: { p256dh: 'public-key', auth: 'auth-key' },
} };
const uuid = (last = '1') => `11111111-1111-4111-8111-11111111111${last}`;
const check = () => ({ action: 'check', subscriptionId: config.subscriptionId });
const send = (requestId = uuid()) => ({ action: 'send', subscriptionId: config.subscriptionId, requestId, confirmed: true });

function atomicDb(initial?: any, failedTransactionNumbers = new Set<number>()) {
  let row = initial === undefined ? undefined : structuredClone(initial);
  let tail = Promise.resolve();
  let transactionNumber = 0;
  const snapshot = () => ({ exists: row !== undefined, data: () => structuredClone(row) });
  const ref = { path: 'owner_notification_control/test', get: vi.fn(async () => snapshot()) };
  const db = {
    collection: vi.fn(() => ({ doc: vi.fn(() => ref) })),
    runTransaction: vi.fn(async (work: any) => {
      let unlock!: () => void;
      const turn = new Promise<void>((resolve) => { unlock = resolve; });
      const before = tail;
      tail = turn;
      await before;
      transactionNumber += 1;
      try {
        if (failedTransactionNumbers.has(transactionNumber)) throw new Error('transaction unavailable');
        return await work({ get: async () => snapshot(), set: (_ref: any, value: any) => { row = structuredClone(value); } });
      } finally { unlock(); }
    }),
  };
  return { db, ref, row: () => structuredClone(row) };
}

function env(overrides: Record<string, string> = {}) {
  const publicKey = Buffer.alloc(65, 7).toString('base64url');
  return {
    OWNER_EVENT_PUSH_ENABLED: 'true', VERCEL_ENV: 'production', OWNER_NOTIFICATION_UID: 'owner',
    OWNER_NOTIFICATION_SUBSCRIPTION_ID: config.subscriptionId, ADMIN_EMAIL: 'owner@cocotripkr.com',
    OWNER_NOTIFICATION_LANGUAGE: 'ko', OWNER_NOTIFICATION_RETENTION_DAYS: '30', CRON_SECRET: 'x'.repeat(32),
    VAPID_PUBLIC_KEY: publicKey, VITE_VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: Buffer.alloc(32, 8).toString('base64url'), ...overrides,
  };
}

async function invoke(handler: any, body: any, options: any = {}) {
  const out: any = {};
  await handler({ method: options.method || 'POST', url: options.url || '/api/admin-owner-notification-test',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }, body }, {
    writeHead: (status: number, headers: any) => { out.status = status; out.headers = headers; },
    end: (body = '') => { out.body = body; },
  });
  return { ...out, json: out.body ? JSON.parse(out.body) : null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSelectedOwnerDevice).mockResolvedValue(device as any);
});

describe('admin owner notification test HTTP gate', () => {
  it('runs an authenticated check and explicit send through the real handler without exposing secrets', async () => {
    const store = atomicDb();
    const sender = vi.fn(async () => ({ outcome: 'accepted' }));
    const loadServices = vi.fn(async () => ({ db: store.db, auth: { getUser: vi.fn() } }));
    const handler = createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: true, uid: 'owner' }),
      loadServices, env: env(), now: () => nowMs, send: sender });
    expect(await invoke(handler, check())).toMatchObject({ status: 200, json: { ok: true, data: { ready: true, code: 'READY' } } });
    expect(sender).not.toHaveBeenCalled();
    expect(store.db.runTransaction).not.toHaveBeenCalled();
    const reply = await invoke(handler, send());
    expect(reply).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store' },
      json: { ok: true, data: { code: 'PROVIDER_ACCEPTED', providerAccepted: true, deliveryVerified: false } } });
    expect(sender).toHaveBeenCalledTimes(1);
    for (const privateValue of [device.subscription.endpoint, device.subscription.keys.auth, env().VAPID_PRIVATE_KEY]) {
      expect(reply.body).not.toContain(privateValue);
    }
  });

  it('does not disclose disabled config without auth and suppresses dependency error content', async () => {
    const absent = createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: false, status: 401 }),
      env: env({ OWNER_EVENT_PUSH_ENABLED: 'false' }) });
    expect(await invoke(absent, check())).toMatchObject({ status: 401, json: { code: 'AUTH_REQUIRED' } });
    const failing = createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: true, uid: 'owner' }), env: env(),
      loadServices: async () => { throw new Error('private-service-content'); } });
    const reply = await invoke(failing, check());
    expect(reply).toMatchObject({ status: 503, json: { code: 'OWNER_TEST_UNAVAILABLE' } });
    expect(reply.body).not.toContain('private-service-content');
  });

  it('requires exact bounded JSON and rejects query strings before service setup', async () => {
    expect(parseOwnerNotificationTestBody({ headers: { 'content-type': 'application/json' }, body: send() } as any)).toEqual(send());
    for (const req of [
      { headers: { 'content-type': 'text/plain' }, body: send() },
      { headers: { 'content-type': 'application/json', 'content-length': '2049' }, body: send() },
      { headers: { 'content-type': 'application/json', 'content-length': 'invalid' }, body: send() },
      { headers: { 'content-type': 'application/json' }, body: { ...send(), inquiryId: 'real-record' } },
      { headers: { 'content-type': 'application/json' }, body: { ...send(), subscriptionId: ' owner_device' } },
      { headers: { 'content-type': 'application/json' }, body: JSON.stringify(send()) + ' '.repeat(2050) },
    ]) expect(parseOwnerNotificationTestBody(req as any)).toBeNull();

    const store = atomicDb();
    const loadServices = vi.fn(async () => ({ db: store.db, auth: { getUser: vi.fn() } }));
    const handler = createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: true, uid: 'owner' }), loadServices, env: env() });
    expect(await invoke(handler, check(), { url: '/api/admin-owner-notification-test?ignored=1' }))
      .toMatchObject({ status: 400, json: { code: 'INVALID_REQUEST' } });
    expect(loadServices).not.toHaveBeenCalled();
  });

  it('rejects bad origin, methods, unauthenticated and non-admin requests without loading services', async () => {
    const store = atomicDb();
    const services = vi.fn(async () => ({ db: store.db, auth: { getUser: vi.fn() } }));
    const trusted = createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: true, uid: 'owner' }), loadServices: services, env: env() });
    expect(await invoke(trusted, check(), { headers: { origin: 'https://attacker.invalid' } })).toMatchObject({ status: 403, json: { code: 'ORIGIN_NOT_ALLOWED' } });
    expect(await invoke(trusted, check(), { method: 'GET' })).toMatchObject({ status: 405, json: { code: 'METHOD_NOT_ALLOWED' } });
    const preflight = await invoke(trusted, undefined, { method: 'OPTIONS', headers: { origin: 'https://cocotripkr.com' } });
    expect(preflight).toMatchObject({ status: 200, headers: { 'Access-Control-Allow-Origin': 'https://cocotripkr.com', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    expect(await invoke(createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: false, status: 401 }), env: env() }), check())).toMatchObject({ status: 401, json: { code: 'AUTH_REQUIRED' } });
    expect(await invoke(createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: false, status: 403 }), env: env() }), check())).toMatchObject({ status: 403, json: { code: 'ADMIN_REQUIRED' } });
    expect(services).not.toHaveBeenCalled();
  });

  it('handles disabled/invalid configuration before uid comparison and blocks mismatched owner uid', async () => {
    const loadServices = vi.fn();
    const owner = { ok: true, uid: 'owner' };
    const disabled = createAdminOwnerNotificationTestHandler({ authenticate: async () => owner, loadServices, env: env({ OWNER_EVENT_PUSH_ENABLED: 'false' }) });
    expect(await invoke(disabled, check())).toMatchObject({ status: 200, json: { data: { ready: false, code: 'DISABLED' } } });
    expect(await invoke(disabled, send())).toMatchObject({ status: 503, json: { code: 'DISABLED' } });
    const invalid = createAdminOwnerNotificationTestHandler({ authenticate: async () => owner, loadServices, env: env({ VAPID_PRIVATE_KEY: 'wrong' }) });
    expect(await invoke(invalid, send())).toMatchObject({ status: 503, json: { code: 'CONFIGURATION_REQUIRED' } });
    const mismatch = createAdminOwnerNotificationTestHandler({ authenticate: async () => ({ ok: true, uid: 'other' }), loadServices, env: env() });
    expect(await invoke(mismatch, check())).toMatchObject({ status: 403, json: { code: 'OWNER_MISMATCH' } });
    expect(loadServices).not.toHaveBeenCalled();
  });
});

describe('single-device test atomic ledger', () => {
  it('keeps check read-only and rejects wrong selected subscription/device before a claim', async () => {
    const store = atomicDb({ version: 1, scope: config.scope, attempts: [{ requestId: uuid(), atMs: nowMs - 59_999, deviceHash: device.deviceHash, outcome: 'PROVIDER_ACCEPTED' }] });
    const sender = vi.fn();
    expect(await ownerNotificationTestTask({ db: store.db, auth: {}, config, input: check(), now: () => nowMs, send: sender }))
      .toEqual({ ok: true, data: { ready: false, code: 'RATE_LIMITED' } });
    expect(store.db.runTransaction).not.toHaveBeenCalled();
    expect(await ownerNotificationTestTask({ db: store.db, auth: {}, config, input: { ...send(), subscriptionId: 'other_device' }, now: () => nowMs, send: sender }))
      .toEqual({ ok: false, code: 'DEVICE_NOT_SELECTED' });
    vi.mocked(readSelectedOwnerDevice).mockResolvedValueOnce(null as any);
    expect(await ownerNotificationTestTask({ db: atomicDb().db, auth: {}, config, input: check(), now: () => nowMs, send: sender }))
      .toEqual({ ok: false, code: 'OWNER_DEVICE_REQUIRED' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('sends one fixed test-only payload to exactly the fresh selected device', async () => {
    const store = atomicDb();
    const sender = vi.fn(async () => ({ outcome: 'accepted' }));
    const id = uuid('2');
    expect(await ownerNotificationTestTask({ db: store.db, auth: {}, config, input: send(id), now: () => nowMs, send: sender }))
      .toEqual({ ok: true, data: { code: 'PROVIDER_ACCEPTED', providerAccepted: true, deliveryVerified: false } });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]).toEqual([device.subscription, {
      title: 'CocoTrip 운영 알림 테스트', body: '본인 휴대폰 단일 기기 테스트 알림입니다.', url: '/admin/ai-center',
      tag: `owner-test-${ownerHash('owner-notification-test', id)}`,
    }, config]);
    expect(store.row().attempts).toEqual([expect.objectContaining({ requestId: id, deviceHash: device.deviceHash, outcome: 'PROVIDER_ACCEPTED' })]);
  });

  it('serializes simultaneous same UUID calls: one claim, one send, one ledger row', async () => {
    const store = atomicDb();
    const sender = vi.fn(async () => ({ outcome: 'accepted' }));
    const id = uuid('3');
    const results = await Promise.all([
      ownerNotificationTestTask({ db: store.db, auth: {}, config, input: send(id), now: () => nowMs, send: sender }),
      ownerNotificationTestTask({ db: store.db, auth: {}, config, input: send(id), now: () => nowMs, send: sender }),
    ]);
    expect(results.map((result) => result.data.code).sort()).toEqual(['ALREADY_HANDLED', 'PROVIDER_ACCEPTED']);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(store.row().attempts).toHaveLength(1);
  });

  it('quarantines any unknown/sending state for check and fresh UUIDs, and enforces 60-second cooldown', async () => {
    const unknown = { version: 1, scope: config.scope, attempts: [{ requestId: uuid('4'), atMs: nowMs - 61_000, deviceHash: device.deviceHash, outcome: 'OUTCOME_UNKNOWN' }] };
    const sender = vi.fn();
    const unknownStore = atomicDb(unknown);
    expect(await ownerNotificationTestTask({ db: unknownStore.db, auth: {}, config, input: check(), now: () => nowMs, send: sender })).toMatchObject({ data: { ready: false, code: 'OUTCOME_UNKNOWN' } });
    expect(await ownerNotificationTestTask({ db: unknownStore.db, auth: {}, config, input: send(uuid('5')), now: () => nowMs, send: sender })).toMatchObject({ data: { code: 'OUTCOME_UNKNOWN' } });
    const sendingStore = atomicDb({ version: 1, scope: config.scope, attempts: [{ requestId: uuid('8'), atMs: nowMs - 61_000, deviceHash: device.deviceHash, outcome: 'SENDING' }] });
    expect(await ownerNotificationTestTask({ db: sendingStore.db, auth: {}, config, input: send(uuid('9')), now: () => nowMs, send: sender })).toMatchObject({ data: { code: 'OUTCOME_UNKNOWN' } });
    const cooldownStore = atomicDb({ version: 1, scope: config.scope, attempts: [{ requestId: uuid('6'), atMs: nowMs - 59_999, deviceHash: device.deviceHash, outcome: 'PROVIDER_ACCEPTED' }] });
    expect(await ownerNotificationTestTask({ db: cooldownStore.db, auth: {}, config, input: send(uuid('7')), now: () => nowMs, send: sender })).toMatchObject({ data: { code: 'RATE_LIMITED' } });
    expect(sender).not.toHaveBeenCalled();
  });

  it('preserves all eight UUIDs and never replays delivery after the maximum', async () => {
    const prior = Array.from({ length: 7 }, (_, index) => ({ requestId: uuid(String(index + 1)), atMs: nowMs - (8 - index) * 61_000, deviceHash: device.deviceHash, outcome: 'PROVIDER_ACCEPTED' }));
    const store = atomicDb({ version: 1, scope: config.scope, attempts: prior });
    const sender = vi.fn(async () => ({ outcome: 'accepted' }));
    const eighth = uuid('8');
    await ownerNotificationTestTask({ db: store.db, auth: {}, config, input: send(eighth), now: () => nowMs, send: sender });
    expect(store.row().attempts.map((entry: any) => entry.requestId)).toEqual([...prior.map((entry) => entry.requestId), eighth]);
    expect(await ownerNotificationTestTask({ db: store.db, auth: {}, config, input: send(uuid('9')), now: () => nowMs + 61_000, send: sender })).toMatchObject({ data: { code: 'MAX_TESTS_REACHED' } });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('fails closed for malformed controls and failed claims without provider calls', async () => {
    const sender = vi.fn();
    const malformed = atomicDb({ version: 1, scope: config.scope, attempts: [{ requestId: uuid(), atMs: nowMs, deviceHash: device.deviceHash, outcome: 'BAD' }] });
    expect(await ownerNotificationTestTask({ db: malformed.db, auth: {}, config, input: check(), now: () => nowMs, send: sender })).toMatchObject({ data: { ready: false, code: 'CONTROL_INVALID' } });
    expect(await ownerNotificationTestTask({ db: malformed.db, auth: {}, config, input: send(uuid('2')), now: () => nowMs, send: sender })).toMatchObject({ data: { code: 'CONTROL_INVALID' } });
    expect(await ownerNotificationTestTask({ db: atomicDb(undefined, new Set([1])).db, auth: {}, config, input: send(uuid('3')), now: () => nowMs, send: sender }))
      .toEqual({ ok: false, code: 'OWNER_TEST_UNAVAILABLE' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('rejects fresh account/device changes before dispatch', async () => {
    const sender = vi.fn(async () => ({ outcome: 'accepted' }));
    vi.mocked(readSelectedOwnerDevice).mockResolvedValueOnce(device as any).mockResolvedValueOnce(null as any);
    expect(await ownerNotificationTestTask({ db: atomicDb().db, auth: {}, config, input: send(uuid('4')), now: () => nowMs, send: sender })).toMatchObject({ data: { code: 'SEND_REJECTED' } });
    vi.mocked(readSelectedOwnerDevice).mockReset().mockResolvedValueOnce(device as any).mockResolvedValueOnce({ ...device, deviceHash: 'c'.repeat(64) } as any);
    expect(await ownerNotificationTestTask({ db: atomicDb().db, auth: {}, config, input: send(uuid('5')), now: () => nowMs, send: sender })).toMatchObject({ data: { code: 'SEND_REJECTED' } });
    expect(sender).not.toHaveBeenCalled();
  });

  it('quarantines failed final writes and late acceptance timeouts, with no resend or leaked provider result', async () => {
    const sender = vi.fn(async () => ({ outcome: 'accepted' }));
    const failedFinal = atomicDb(undefined, new Set([2]));
    expect(await ownerNotificationTestTask({ db: failedFinal.db, auth: {}, config, input: send(uuid('6')), now: () => nowMs, send: sender })).toMatchObject({ data: { code: 'OUTCOME_UNKNOWN', providerAccepted: false } });
    expect(await ownerNotificationTestTask({ db: failedFinal.db, auth: {}, config, input: send(uuid('7')), now: () => nowMs + 61_000, send: sender })).toMatchObject({ data: { code: 'OUTCOME_UNKNOWN' } });
    expect(sender).toHaveBeenCalledTimes(1);

    let resolveLate: (value: any) => void = () => undefined;
    const late = vi.fn(() => new Promise((resolve) => { resolveLate = resolve; }));
    const timedOut = atomicDb();
    const first = await ownerNotificationTestTask({ db: timedOut.db, auth: {}, config, input: send(uuid('8')), now: () => nowMs, send: late, timeoutMs: 1 });
    expect(first).toMatchObject({ data: { code: 'OUTCOME_UNKNOWN', providerAccepted: false } });
    resolveLate({ outcome: 'accepted' });
    await Promise.resolve();
    expect(await ownerNotificationTestTask({ db: timedOut.db, auth: {}, config, input: send(uuid('9')), now: () => nowMs + 61_000, send: late, timeoutMs: 1 })).toMatchObject({ data: { code: 'OUTCOME_UNKNOWN' } });
    expect(late).toHaveBeenCalledTimes(1);
  });
});
