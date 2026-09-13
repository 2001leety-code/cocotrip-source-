/* eslint-disable @typescript-eslint/no-explicit-any -- bounded Firestore transaction double. */
import { createECDH } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OWNER_SOURCES, openOwnerCursor, ownerHash, sealOwnerCursor, timeAtMs } from '../../api/_shared/owner-notification-policy.js';
import { OWNER_CONTROL_COLLECTION, OWNER_EVENT_COLLECTION, ownerEventId } from '../../api/_shared/owner-notification-delivery.js';
import { ownerNotificationTestControlId } from '../../api/_shared/owner-notification-test.js';
import { reconnectOwnerNotificationDevice } from '../../api/_shared/owner-notification-reconnect.js';

const now = 1_750_000_000_000;
const uid = 'reconnect-owner';
const cursorSecret = 'cursor-secret-kept-stable-32-bytes';
const user = { uid, email: 'owner@cocotripkr.com', emailVerified: true, disabled: false, customClaims: { admin: true } };
const uuid = (last: string) => `11111111-1111-4111-8111-11111111111${last}`;

function vapidPair(seed: number) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.alloc(32, seed));
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
}

const oldVapid = vapidPair(7);
const newVapid = vapidPair(8);

function subscription(uidValue: string, endpoint: string, vapidPublicKey: string) {
  const id = `${uidValue}_${Buffer.from(endpoint, 'binary').toString('base64').slice(-32)}`;
  return { id, record: { uid: uidValue, endpoint, vapidPublicKey,
    keys: { p256dh: Buffer.alloc(65, 3).toString('base64url'), auth: Buffer.alloc(16, 4).toString('base64url') } } };
}

const oldDevice = subscription(uid, 'https://fcm.googleapis.com/fcm/send/old-device', oldVapid.publicKey);
const newDevice = subscription(uid, 'https://fcm.googleapis.com/fcm/send/new-device', newVapid.publicKey);

function config(subscriptionId: string, vapid = newVapid) {
  return { enabled: true, uid, subscriptionId, adminEmail: user.email, language: 'ko', retentionDays: 30,
    cursorSecret, publicKey: vapid.publicKey, privateKey: vapid.privateKey,
    scope: ownerHash('owner-notifications-v1', uid, subscriptionId, 'ko', 30) };
}

function cursorState(oldConfig: ReturnType<typeof config>) {
  const activatedAtMs = now - 60_000;
  const cursors = Object.fromEntries(OWNER_SOURCES.map((spec, index) => [spec.name,
    sealOwnerCursor({ time: timeAtMs(activatedAtMs + index, spec.numericTime), id: `event-${index}` }, oldConfig, spec.name)]));
  return { version: 1, scope: oldConfig.scope, deviceHash: ownerHash('device', oldDevice.record.endpoint,
    oldDevice.record.keys.p256dh, oldDevice.record.keys.auth), sourceSchemaVersion: 2, activatedAtMs,
    cursors, nextSource: 3, sourceHealth: { lastRunMs: activatedAtMs }, lockToken: '', lockUntilMs: 0 };
}

function memoryDb(initial: Record<string, unknown>, options: { fail?: boolean } = {}) {
  const rows = new Map(Object.entries(structuredClone(initial)));
  const writes: Array<{ path: string; value: unknown }> = [];
  let writeStarted = false;
  let readAfterWrite = false;
  const snap = (path: string) => {
    const value = rows.get(path);
    return { exists: value !== undefined, data: () => structuredClone(value) };
  };
  const ref = (path: string) => ({ path, get: async () => snap(path) });
  const collection = (name: string) => ({
    doc: (id: string) => ref(`${name}/${id}`),
    limit: (count: number) => { void count; return { path: `${name}/__query__`, collection: name, count }; },
  });
  const db = {
    collection,
      runTransaction: async (work: (tx: any) => Promise<unknown>) => {
      if (options.fail) throw new Error('transaction unavailable');
      const staged = new Map<string, unknown>();
      const tx = {
        get: async (target: any) => {
          if (writeStarted) readAfterWrite = true;
          if (target.collection === OWNER_EVENT_COLLECTION) {
            const docs = [...rows.entries()].filter(([path]) => path.startsWith(`${OWNER_EVENT_COLLECTION}/`))
              .slice(0, target.count || 1).map(([path, value]) => ({ ref: { path }, id: path.split('/').at(-1), exists: true, data: () => structuredClone(value) }));
            return { docs };
          }
          return snap(target.path);
        },
        update: (target: any, value: unknown) => { writeStarted = true; writes.push({ path: target.path, value }); staged.set(target.path, { ...rows.get(target.path) as object, ...structuredClone(value) }); },
        create: (target: any, value: unknown) => { writeStarted = true; writes.push({ path: target.path, value }); staged.set(target.path, structuredClone(value)); },
        set: (target: any, value: unknown) => { writeStarted = true; writes.push({ path: target.path, value }); staged.set(target.path, structuredClone(value)); },
      };
      const result = await work(tx);
      for (const [path, value] of staged) rows.set(path, value);
      return result;
    },
  };
  return { db, rows, writes, get readAfterWrite() { return readAfterWrite; } };
}

function fixture(overrides: { state?: any; attempts?: any[]; events?: any[]; newTest?: any; newVapidPublicKey?: string } = {}) {
  const oldConfig = config(oldDevice.id, oldVapid);
  const newConfig = config(newDevice.id, newVapid);
  const state = overrides.state || cursorState(oldConfig);
  const oldTest = { version: 1, scope: oldConfig.scope, attempts: overrides.attempts || [
    { requestId: uuid('1'), atMs: now - 120_000, deviceHash: state.deviceHash, outcome: 'PROVIDER_ACCEPTED' },
  ] };
  const rows: Record<string, unknown> = {
    [`${OWNER_CONTROL_COLLECTION}/v1`]: state,
    [`push_subscriptions/${oldDevice.id}`]: oldDevice.record,
    [`push_subscriptions/${newDevice.id}`]: { ...newDevice.record, vapidPublicKey: overrides.newVapidPublicKey || newVapid.publicKey },
    [`${OWNER_CONTROL_COLLECTION}/${ownerNotificationTestControlId(oldConfig)}`]: oldTest,
  };
  if (overrides.newTest) rows[`${OWNER_CONTROL_COLLECTION}/${ownerNotificationTestControlId(newConfig)}`] = overrides.newTest;
  for (const [index, event] of (overrides.events || []).entries()) rows[`${OWNER_EVENT_COLLECTION}/event-${index}`] = event;
  return { oldConfig, newConfig, rows };
}

function storedEvent(configValue: ReturnType<typeof config>, deviceValue: typeof oldDevice, outcome = 'accepted', idSuffix = 'event') {
  const eventKey = ownerHash('reconnect-event', idSuffix);
  const row = { version: 1, kind: 'inquiry', eventKey, scope: configValue.scope,
    deviceHash: ownerHash('device', deviceValue.record.endpoint, deviceValue.record.keys.p256dh, deviceValue.record.keys.auth),
    queuedAtMs: now - 120_000, expiresAtMs: now - 120_000 + configValue.retentionDays * 86_400_000,
    status: outcome === 'accepted' ? 'accepted' : 'manual_required', attempts: 1,
    nextAttemptAtMs: Number.MAX_SAFE_INTEGER, leaseUntilMs: 0,
    outcomeCode: outcome === 'accepted' ? 'PROVIDER_ACCEPTED' : 'MANUAL_REQUIRED' };
  return { id: ownerEventId(row, configValue, { deviceHash: row.deviceHash }), row };
}

const services = (store: ReturnType<typeof memoryDb>, authorized = true) => ({ db: store.db, auth: { getUser: async () => authorized ? user : null } });

describe('owner notification device reconnect', () => {
  it('re-encrypts every cursor, preserves progress, and copies accepted test history once', async () => {
    const f = fixture(); const store = memoryDb(f.rows);
    const result = await reconnectOwnerNotificationDevice(services(store), f.newConfig, oldDevice.id, now);
    expect(result).toEqual({ code: 'DEVICE_RECONNECTED', preservedSources: OWNER_SOURCES.length, preservedTests: 1, preservedEvents: 0 });
    expect(store.readAfterWrite).toBe(false);
    const state = store.rows.get(`${OWNER_CONTROL_COLLECTION}/v1`) as any;
    expect(state).toMatchObject({ scope: f.newConfig.scope, deviceHash: ownerHash('device', newDevice.record.endpoint,
      newDevice.record.keys.p256dh, newDevice.record.keys.auth), activatedAtMs: now - 60_000, nextSource: 3, sourceHealth: { lastRunMs: now - 60_000 } });
    expect(state.deviceMigration).toMatchObject({ version: 1, fromScope: f.oldConfig.scope, completedAtMs: now });
    for (const [index, spec] of OWNER_SOURCES.entries()) {
      const cursor = openOwnerCursor(state.cursors[spec.name], f.newConfig, spec.name);
      expect(cursor).toEqual({ time: timeAtMs(now - 60_000 + index, spec.numericTime), id: `event-${index}` });
    }
    expect(store.rows.has(`${OWNER_CONTROL_COLLECTION}/${ownerNotificationTestControlId(f.oldConfig)}`)).toBe(true);
    expect(store.rows.has(`${OWNER_CONTROL_COLLECTION}/${ownerNotificationTestControlId(f.newConfig)}`)).toBe(true);
  });

  it.each(['manual_required', 'accepted'])('preserves terminal %s events without deleting or resending originals', async outcome => {
    const f = fixture(); const event = storedEvent(f.oldConfig, oldDevice, outcome, 'terminal');
    f.rows[`${OWNER_EVENT_COLLECTION}/${event.id}`] = event.row;
    const store = memoryDb(f.rows);
    expect(await reconnectOwnerNotificationDevice(services(store), f.newConfig, oldDevice.id, now)).toEqual({
      code: 'DEVICE_RECONNECTED', preservedSources: OWNER_SOURCES.length, preservedTests: 1, preservedEvents: 1,
    });
    expect(store.rows.get(`${OWNER_EVENT_COLLECTION}/${event.id}`)).toEqual(event.row);
    const nextId = ownerEventId(event.row, f.newConfig, { deviceHash: ownerHash('device', newDevice.record.endpoint, newDevice.record.keys.p256dh, newDevice.record.keys.auth) });
    expect(store.rows.get(`${OWNER_EVENT_COLLECTION}/${nextId}`)).toEqual({ ...event.row, scope: f.newConfig.scope,
      deviceHash: ownerHash('device', newDevice.record.endpoint, newDevice.record.keys.p256dh, newDevice.record.keys.auth) });
  });

  it.each([
    ['live lease', { state: { ...cursorState(config(oldDevice.id, oldVapid)), lockUntilMs: now + 1 } }, 'BUSY'],
    ['event history', { events: [{ version: 1 }] }, 'RECONNECT_HISTORY_REQUIRES_REVIEW'],
    ['new ledger exists', { newTest: { version: 1 } }, 'RECONNECT_HISTORY_REQUIRES_REVIEW'],
    ['unknown old test', { attempts: [{ requestId: uuid('2'), atMs: now - 120_000, deviceHash: cursorState(config(oldDevice.id, oldVapid)).deviceHash, outcome: 'OUTCOME_UNKNOWN' }] }, 'RECONNECT_HISTORY_REQUIRES_REVIEW'],
  ])('does not write when %s', async (_label, overrides, code) => {
    const f = fixture(overrides as any); const store = memoryDb(f.rows); const before = structuredClone([...store.rows.entries()]);
    expect(await reconnectOwnerNotificationDevice(services(store), f.newConfig, oldDevice.id, now)).toEqual({ code });
    expect([...store.rows.entries()]).toEqual(before); expect(store.writes).toHaveLength(0);
  });

  it('blocks key mismatch, owner denial, malformed scope/cursor, and transaction failure without writes', async () => {
    const mismatch = fixture({ newVapidPublicKey: oldVapid.publicKey }); let store = memoryDb(mismatch.rows);
    expect(await reconnectOwnerNotificationDevice(services(store), mismatch.newConfig, oldDevice.id, now)).toEqual({ code: 'OWNER_DEVICE_REQUIRED' });
    expect(store.writes).toHaveLength(0);
    const denied = fixture(); store = memoryDb(denied.rows);
    expect(await reconnectOwnerNotificationDevice(services(store, false), denied.newConfig, oldDevice.id, now)).toEqual({ code: 'OWNER_DEVICE_REQUIRED' });
    expect(store.writes).toHaveLength(0);
    const bad = fixture({ state: { ...cursorState(config(oldDevice.id, oldVapid)), scope: 'f'.repeat(64) } }); store = memoryDb(bad.rows);
    expect(await reconnectOwnerNotificationDevice(services(store), bad.newConfig, oldDevice.id, now)).toEqual({ code: 'RECONNECT_CONTROL_MISMATCH' });
    const broken = fixture(); (broken.rows[`${OWNER_CONTROL_COLLECTION}/v1`] as any).cursors.bookings = 'corrupt'; store = memoryDb(broken.rows);
    expect(await reconnectOwnerNotificationDevice(services(store), broken.newConfig, oldDevice.id, now)).toEqual({ code: 'RECONNECT_UNAVAILABLE' });
    store = memoryDb(fixture().rows, { fail: true });
    expect(await reconnectOwnerNotificationDevice(services(store), fixture().newConfig, oldDevice.id, now)).toEqual({ code: 'RECONNECT_UNAVAILABLE' });
    expect(store.writes).toHaveLength(0);
  });

  it.each(['pending', 'retryable', 'sending', 'unknown'])('blocks non-terminal event outcome %s without writes', async (outcome) => {
    const f = fixture(); const event = storedEvent(f.oldConfig, oldDevice, 'accepted', `bad-${outcome}`);
    event.row.status = outcome; event.row.outcomeCode = outcome === 'retryable' ? 'RETRY_SCHEDULED' : outcome.toUpperCase();
    f.rows[`${OWNER_EVENT_COLLECTION}/${event.id}`] = event.row;
    const store = memoryDb(f.rows); const before = structuredClone([...store.rows.entries()]);
    expect(await reconnectOwnerNotificationDevice(services(store), f.newConfig, oldDevice.id, now)).toEqual({ code: 'RECONNECT_HISTORY_REQUIRES_REVIEW' });
    expect([...store.rows.entries()]).toEqual(before); expect(store.writes).toHaveLength(0);
  });

  it('blocks 26 events and a pre-existing new-scope event without writes', async () => {
    const f = fixture();
    for (let i = 0; i < 26; i++) { const event = storedEvent(f.oldConfig, oldDevice, 'accepted', `many-${i}`); f.rows[`${OWNER_EVENT_COLLECTION}/${event.id}`] = event.row; }
    let store = memoryDb(f.rows); const before = structuredClone([...store.rows.entries()]);
    expect(await reconnectOwnerNotificationDevice(services(store), f.newConfig, oldDevice.id, now)).toEqual({ code: 'RECONNECT_HISTORY_REQUIRES_REVIEW' });
    expect([...store.rows.entries()]).toEqual(before); expect(store.writes).toHaveLength(0);
    const one = fixture(); const oldEvent = storedEvent(one.oldConfig, oldDevice, 'accepted', 'collision');
    one.rows[`${OWNER_EVENT_COLLECTION}/${oldEvent.id}`] = oldEvent.row;
    const collision = ownerEventId(oldEvent.row, one.newConfig, { deviceHash: ownerHash('device',
      newDevice.record.endpoint, newDevice.record.keys.p256dh, newDevice.record.keys.auth) });
    one.rows[`${OWNER_EVENT_COLLECTION}/${collision}`] = { ...oldEvent.row, scope: one.newConfig.scope, deviceHash: ownerHash('device', newDevice.record.endpoint, newDevice.record.keys.p256dh, newDevice.record.keys.auth) };
    store = memoryDb(one.rows);
    expect(await reconnectOwnerNotificationDevice(services(store), one.newConfig, oldDevice.id, now)).toEqual({ code: 'RECONNECT_HISTORY_REQUIRES_REVIEW' });
    expect(store.writes).toHaveLength(0);
  });
});
