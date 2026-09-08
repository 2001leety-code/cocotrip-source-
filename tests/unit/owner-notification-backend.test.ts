import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OWNER_SOURCES, OWNER_SOURCE_FIELDS, eventFromSource, isOwnerAdmin, openOwnerCursor, ownerHash,
  ownerPayload, readOwnerNotificationConfig, sealOwnerCursor, sourceTime, timeAtMs, validateOwnerSubscription,
} from '../../api/_shared/owner-notification-policy.js';
import {
  OWNER_CONTROL_COLLECTION, OWNER_EVENT_COLLECTION, OWNER_LEASE_MS, deliverOwnerEvent, newOwnerEvent,
  ownerEventId, sendSingleOwnerPush,
} from '../../api/_shared/owner-notification-delivery.js';
import ownerHandler, { ownerNotificationSweepTask } from '../../api/_crons/owner-notification-sweep.js';
import { buildCartChildBookings } from '../../api/_shared/cart-capture.js';

const transport = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: transport }));
const authorize = vi.hoisted(() => vi.fn());
vi.mock('../../api/_shared/cron-auth.js', () => ({ verifyCronRequest: authorize }));
const PRIVATE = 'fake-customer-email-phone-order-do-not-copy';
const EPOCH = Date.parse('2026-09-07T00:00:00.000Z');
const UID = 'fake-owner';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/fake-controller-endpoint';
const SUB_ID = `${UID}_${Buffer.from(ENDPOINT).toString('base64').slice(-32)}`;
const key = (size: number, byte = 4) => Buffer.alloc(size, byte).toString('base64url');
const environment = () => ({
  OWNER_EVENT_PUSH_ENABLED: 'true', VERCEL_ENV: 'production', OWNER_NOTIFICATION_UID: UID,
  OWNER_NOTIFICATION_SUBSCRIPTION_ID: SUB_ID, OWNER_NOTIFICATION_LANGUAGE: 'ko', OWNER_NOTIFICATION_RETENTION_DAYS: '7',
  ADMIN_EMAIL: 'fake-owner@example.invalid', CRON_SECRET: 'fake-only-cursor-secret-with-32-characters',
  VAPID_PUBLIC_KEY: key(65), VITE_VAPID_PUBLIC_KEY: key(65), VAPID_PRIVATE_KEY: key(32),
});
const subscription = () => ({ uid: UID, endpoint: ENDPOINT, keys: { p256dh: key(65), auth: key(16) }, userAgent: PRIVATE });
const userRecord = () => ({ uid: UID, email: 'fake-owner@example.invalid', emailVerified: true, disabled: false, customClaims: {} });
type Row = Record<string, unknown>;
type Ref = { path: string; id: string; get: () => Promise<ReturnType<typeof snapshot>> };
function snapshot(ref: Ref, row: Row | undefined) {
  return { id: ref.id, ref, exists: Boolean(row), data: () => row && structuredClone(row) };
}
function compare(a: unknown, b: unknown): number {
  if (a && b && typeof a === 'object' && typeof b === 'object' && 'seconds' in a && 'seconds' in b) {
    const left = a as { seconds: number; nanoseconds: number };
    const right = b as { seconds: number; nanoseconds: number };
    return left.seconds - right.seconds || left.nanoseconds - right.nanoseconds;
  }
  return a === b ? 0 : (a as number) < (b as number) ? -1 : 1;
}

/** Strict in-memory Firestore double: projections, tuple cursors, staged atomic commits, no SDK/network. */
function memoryStore() {
  const records = new Map<string, Row>();
  const writes: string[] = [];
  const reads: string[] = [];
  const queries: { collection: string; fields: string[]; orders: string[]; after: unknown[] }[] = [];
  const failedCollections = new Set<string>();
  const failedDocuments = new Set<string>();
  let failCommit = false;
  let failEventCommit = false;
  let failReads = false;
  let chain = Promise.resolve();
  const ref = (filename: string): Ref => ({ path: filename, id: filename.split('/').at(-1) || '',
    get: async () => { reads.push(filename); if (failReads || failedDocuments.has(filename)) throw new Error(PRIVATE); return snapshot(ref(filename), records.get(filename)); } });
  const apply = (kind: string, target: Ref, data: Row) => {
    if (![OWNER_EVENT_COLLECTION, OWNER_CONTROL_COLLECTION].includes(target.path.split('/')[0])) throw new Error('SOURCE_WRITE_FORBIDDEN');
    writes.push(target.path);
    if (kind === 'delete') { records.delete(target.path); return; }
    if (kind === 'create' && records.has(target.path)) throw new Error('ALREADY_EXISTS');
    const row = kind === 'update' ? structuredClone(records.get(target.path) || {}) : {};
    for (const [field, v] of Object.entries(data)) {
      if (field.includes('.')) {
        const [group, leaf] = field.split('.');
        row[group] = { ...(row[group] as Row || {}), [leaf]: v };
      }
      else row[field] = v;
    }
    records.set(target.path, row);
  };
  const db = {
    collection: (name: string) => {
      const predicates: [string, string, unknown][] = [];
      const orders: string[] = [];
      let fields: string[] = [];
      let after: unknown[] = [];
      let maximum = 1000;
      const query = {
        doc: (id: string) => ref(`${name}/${id}`),
        where: (field: string, operator: string, value: unknown) => { predicates.push([field, operator, value]); return query; },
        orderBy: (field: string) => { orders.push(field); return query; },
        select: (...projection: string[]) => { fields = projection; return query; },
        startAfter: (...cursor: unknown[]) => { after = cursor; return query; },
        limit: (count: number) => { maximum = count; return query; },
        get: async () => {
          if (failReads || failedCollections.has(name)) throw new Error(PRIVATE);
          queries.push({ collection: name, fields: [...fields], orders: [...orders], after: [...after] });
          const extract = (filename: string, row: Row, field: string) => field === '__name__' ? filename.split('/').at(-1) : row[field];
          const rows = [...records].filter(([filename, row]) => filename.startsWith(`${name}/`) && !filename.slice(name.length + 1).includes('/')
            && predicates.every(([field, operator, expected]) => {
              const actual = extract(filename, row, field);
              if (actual === undefined) return false;
              const delta = compare(actual, expected);
              return operator === '==' ? delta === 0 : operator === '>=' ? delta >= 0 : operator === '<=' ? delta <= 0 : false;
            }) && orders.every((field) => extract(filename, row, field) !== undefined))
            .sort(([a, av], [b, bv]) => orders.reduce((delta, field) => delta || compare(extract(a, av, field), extract(b, bv, field)), 0))
            .filter(([filename, row]) => !after.length || orders.reduce((delta, field, index) => delta || compare(extract(filename, row, field), after[index]), 0) > 0)
            .slice(0, maximum);
          return { docs: rows.map(([filename, row]) => snapshot(ref(filename), fields.length
            ? Object.fromEntries(fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]])) : row)) };
        },
      };
      return query;
    },
    runTransaction: async <T,>(run: (tx: { get: (target: Ref) => Promise<ReturnType<typeof snapshot>>;
      create: (target: Ref, data: Row) => void; update: (target: Ref, data: Row) => void; delete: (target: Ref) => void }) => Promise<T>): Promise<T> => {
      const previous = chain;
      let release: () => void = () => {};
      chain = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const staged: [string, Ref, Row][] = [];
        const answer = await run({
          get: async (target) => { if (staged.length) throw new Error('READ_AFTER_WRITE'); return target.get(); },
          create: (target, data) => { staged.push(['create', target, data]); },
          update: (target, data) => { staged.push(['update', target, data]); },
          delete: (target) => { staged.push(['delete', target, {}]); },
        });
        if (failCommit || (failEventCommit && staged.some(([, target]) => target.path.startsWith(`${OWNER_EVENT_COLLECTION}/`)))) throw new Error(PRIVATE);
        staged.forEach(([kind, target, data]) => apply(kind, target, data));
        return answer;
      } finally { release(); }
    },
  };
  return { db, records, writes, reads, queries, failedCollections, failedDocuments,
    setFailCommit: (value: boolean) => { failCommit = value; }, setFailEventCommit: (value: boolean) => { failEventCommit = value; },
    setFailReads: (value: boolean) => { failReads = value; } };
}
function fixture() {
  const store = memoryStore();
  const env = environment();
  const config = readOwnerNotificationConfig(env);
  const auth = { getUser: vi.fn(async () => userRecord()) };
  const services = { db: store.db, auth, documentId: '__name__', timestamp: (time: Row) => time };
  const device = validateOwnerSubscription(SUB_ID, subscription(), config);
  store.records.set(`push_subscriptions/${SUB_ID}`, subscription());
  let current = EPOCH;
  const now = () => current;
  const send = vi.fn(async () => ({ outcome: 'accepted' }));
  const loadServices = vi.fn(async () => services);
  const run = () => ownerNotificationSweepTask({ env, now, send, loadServices });
  return { ...store, env, config, auth, services, device, now, send, loadServices, run,
    setNow: (next: number) => { current = next; },
    seed: (source: string, id: string, data: Row = {}) => store.records.set(`${source}/${id}`, {
      createdAt: source === 'mood_bookings' ? EPOCH + 1000 : timeAtMs(EPOCH + 1000),
      status: source.includes('inquiries') || source === 'cs_tickets' ? 'NEW' : 'CONFIRMED',
      name: PRIVATE, email: PRIVATE, phone: PRIVATE, amount: PRIVATE, memo: PRIVATE, ...data,
    }),
    ledger: () => [...store.records].filter(([filename]) => filename.startsWith(`${OWNER_EVENT_COLLECTION}/`)),
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); transport.sendNotification.mockReset(); authorize.mockReset(); });

describe('explicit owner-only activation and privacy policy', () => {
  it.each(['', 'false', 'TRUE', '1', undefined])('OFF (%s) performs zero service initialization, reads and sends', async (flag) => {
    const f = fixture();
    const result = await ownerNotificationSweepTask({ env: { ...f.env, OWNER_EVENT_PUSH_ENABLED: flag }, loadServices: f.loadServices, send: f.send });
    expect(result).toEqual({ ok: true, enabled: false, code: 'DISABLED' });
    expect(f.loadServices).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.reads).toEqual([]);
  });
  it.each(['OWNER_NOTIFICATION_UID', 'OWNER_NOTIFICATION_SUBSCRIPTION_ID', 'OWNER_NOTIFICATION_LANGUAGE', 'OWNER_NOTIFICATION_RETENTION_DAYS',
    'ADMIN_EMAIL', 'CRON_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VITE_VAPID_PUBLIC_KEY'])('missing %s is closed before I/O', async (field) => {
    const f = fixture();
    const result = await ownerNotificationSweepTask({ env: { ...f.env, [field]: '' }, loadServices: f.loadServices, send: f.send });
    expect(result.ok).toBe(false); expect(f.loadServices).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['preview', 'development', undefined])('cannot activate in %s', (deployment) => {
    expect(readOwnerNotificationConfig({ ...environment(), VERCEL_ENV: deployment }).code).toBe('PRODUCTION_REQUIRED');
  });
  it.each(['0', '-1', '91', '7x', '7.5', ''])('requires a bounded explicit retention: %s', (days) => {
    expect(readOwnerNotificationConfig({ ...environment(), OWNER_NOTIFICATION_RETENTION_DAYS: days }).enabled).toBe(false);
  });
  it('uses ADMIN_EMAIL fallback and the actual server admin claim predicate, not frontend email alone', () => {
    const config = readOwnerNotificationConfig({ ...environment(), ADMIN_EMAIL: '', VITE_ADMIN_EMAIL: 'fake-owner@example.invalid' });
    expect(config.enabled).toBe(true);
    expect(isOwnerAdmin(userRecord(), config)).toBe(true);
    expect(isOwnerAdmin({ ...userRecord(), email: 'another@example.invalid', customClaims: { admin: true } }, config)).toBe(true);
    for (const changes of [{ disabled: true }, { emailVerified: false }, { uid: 'other' }, { email: '' }, { email: 'other@example.invalid' }]) {
      expect(isOwnerAdmin({ ...userRecord(), ...changes }, config)).toBe(false);
    }
  });
  it('requires exact account, namespace, endpoint-derived ID and keys for the selected one device', () => {
    const config = readOwnerNotificationConfig(environment());
    expect(validateOwnerSubscription(SUB_ID, subscription(), config)).toBeTruthy();
    expect(validateOwnerSubscription(SUB_ID, { ...subscription(), uid: `${UID}_other` }, config)).toBeNull();
    expect(validateOwnerSubscription(`${SUB_ID}_other`, subscription(), config)).toBeNull();
    expect(validateOwnerSubscription(SUB_ID, { ...subscription(), keys: {} }, config)).toBeNull();
    expect(validateOwnerSubscription(SUB_ID, { ...subscription(), endpoint: ENDPOINT + '-other' }, config)).toBeNull();
  });
  it.each(['http://fcm.googleapis.com/fcm/send/x', 'https://127.0.0.1/fcm/send/x', 'https://fcm.googleapis.com.evil.invalid/fcm/send/x',
    'https://fcm.googleapis.com/fcm/send/x?secret=fake', 'https://fcm.googleapis.com/fcm/send/x#fake',
    'https://fake:secret@fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:444/fcm/send/x', 'https://fcm.googleapis.com/other'])('rejects endpoint %s', (endpoint) => {
    expect(validateOwnerSubscription(SUB_ID, { ...subscription(), endpoint }, readOwnerNotificationConfig(environment()))).toBeNull();
  });
  it.each(['ko', 'en', 'ja', 'zh'])('constructs only fixed PII-free %s payloads', (language) => {
    for (const source of OWNER_SOURCES) {
      const data = source.name === 'external_inbox_messages'
        ? { channel: 'email', accountId: 'company@example.invalid', receivedAtMs: EPOCH, sourceAtMs: EPOCH, expiresAtMs: EPOCH + 86_400_000 }
        : source.name === 'chat_sessions'
          ? { ownerNotificationEligible: true }
          : { status: source.name.includes('inquiries') || source.name === 'cs_tickets' ? 'new' : 'confirmed' };
      const event = eventFromSource(source.name, PRIVATE, { ...data, name: PRIVATE, email: PRIVATE });
      const payload = ownerPayload(event.kind, event.eventKey, language);
      expect(Object.keys(payload).sort()).toEqual(['body', 'tag', 'title', 'url']);
      expect(payload.url).toBe('/admin/ai-center');
      expect(JSON.stringify(payload)).not.toContain(PRIVATE);
      expect(payload.tag).toMatch(/^owner-[a-f0-9]{64}$/);
    }
    expect(ownerPayload('mail', ownerHash('x'), language)).toBeNull();
    expect(ownerPayload('booking', PRIVATE, language)).toBeNull();
  });
  it.each([{ isTest: true }, { testMode: true }, { paypalEnvironment: 'sandbox' }, { status: 'refunded' }, { status: 'cancelled' }, { status: 'completed' }])('excludes test/closed sources (%j)', (changes) => {
    expect(eventFromSource('bookings', 'fake-order', { status: 'CONFIRMED', ...changes })).toBeNull();
  });
  it('deduplicates pending mirrors and cart children, but separates MOOD and inquiries', () => {
    const pending = eventFromSource('pending_bookings', 'fake-order', { status: 'AWAITING_VERIFICATION' });
    expect(eventFromSource('bookings', 'fake-order', { status: 'CONFIRMED' })).toEqual(pending);
    expect(eventFromSource('bookings', 'child-a', { status: 'CONFIRMED', parentOrderID: 'fake-order' })).toEqual(pending);
    expect(eventFromSource('bookings', 'child-b', { status: 'CONFIRMED', parentOrderID: 'fake-order' })).toEqual(pending);
    expect(eventFromSource('mood_bookings', 'fake-order', { status: 'confirmed' })?.eventKey).not.toBe(pending.eventKey);
  });
});

describe('authenticated encrypted exact resume cursor', () => {
  it('preserves nanoseconds and document ID while hiding both in fresh randomized ciphertext', () => {
    const config = readOwnerNotificationConfig(environment());
    const cursor = { time: { seconds: 100, nanoseconds: 123456789 }, id: PRIVATE };
    const first = sealOwnerCursor(cursor, config, 'bookings');
    const second = sealOwnerCursor(cursor, config, 'bookings');
    expect(first).not.toEqual(second);
    expect(first).not.toContain(PRIVATE);
    expect(Buffer.from(first, 'base64url').toString()).not.toContain(PRIVATE);
    expect(openOwnerCursor(first, config, 'bookings')).toEqual(cursor);
  });
  it('preserves numeric MOOD timestamps, including an initial null ID', () => {
    const config = readOwnerNotificationConfig(environment());
    const cursor = { time: { ms: EPOCH }, id: null };
    expect(openOwnerCursor(sealOwnerCursor(cursor, config, 'mood_bookings'), config, 'mood_bookings')).toEqual(cursor);
  });
  it.each(['secret', 'scope', 'source', 'iv', 'tag', 'ciphertext', 'truncate'])('rejects %s tampering with a fixed nonsecret error', (change) => {
    const config = readOwnerNotificationConfig(environment());
    let sealed = sealOwnerCursor({ time: timeAtMs(EPOCH), id: PRIVATE }, config, 'bookings');
    let source = 'bookings';
    if (change === 'secret') config.cursorSecret = 'different-private-cursor-secret-with-32-characters';
    else if (change === 'scope') config.scope = ownerHash('other-scope');
    else if (change === 'source') source = 'pending_bookings';
    else if (change === 'truncate') sealed = sealed.slice(0, -20);
    else {
      const bytes = Buffer.from(sealed, 'base64url');
      bytes[change === 'iv' ? 0 : change === 'tag' ? 12 : 28] ^= 1;
      sealed = bytes.toString('base64url');
    }
    expect(() => openOwnerCursor(sealed, config, source)).toThrow('CURSOR_INVALID');
  });
  it.each([{ seconds: 1, nanoseconds: -1 }, { seconds: 1, nanoseconds: 1e9 }, { seconds: -1, nanoseconds: 0 }, {}])('rejects invalid timestamp %j', (time) => {
    expect(sourceTime(time)).toBeNull();
  });
});

describe('metadata scanner, cutover and atomic queue/cursor', () => {
  it('initializes without scanning or sending historical records, then scans new metadata only', async () => {
    const f = fixture();
    f.seed('bookings', 'old', { createdAt: timeAtMs(EPOCH - 1000) });
    expect((await f.run()).code).toBe('INITIALIZED'); expect(f.queries).toEqual([]); expect(f.send).not.toHaveBeenCalled();
    f.seed('bookings', PRIVATE);
    f.setNow(EPOCH + 300_000);
    const result = await f.run();
    expect(result).toMatchObject({ ok: true, scanned: 1, accepted: 1 });
    expect(f.ledger()).toHaveLength(1);
    expect(JSON.stringify(f.ledger())).not.toContain(PRIVATE);
    expect(JSON.stringify(f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`))).not.toContain(PRIVATE);
    for (const query of f.queries.filter((entry) => OWNER_SOURCES.some((spec) => spec.name === entry.collection))) {
      const spec = OWNER_SOURCES.find((source) => source.name === query.collection);
      expect(query.orders).toEqual([spec?.timeField, '__name__']);
      expect(query.fields.length).toBeGreaterThan(0);
      expect(query.fields.every((field) => OWNER_SOURCE_FIELDS.includes(field))).toBe(true);
      expect(query.fields).not.toEqual(expect.arrayContaining(['name', 'email', 'phone', 'amount', 'memo']));
    }
    expect(f.writes.every((filename) => filename.startsWith('owner_notification_'))).toBe(true);
    expect(f.send.mock.calls[0][0]).toEqual({ endpoint: ENDPOINT, keys: subscription().keys });
  });

  it('starts newly added inbox and webchat sources at upgrade time and never backfills them', async () => {
    const f = fixture();
    Object.assign(f.env, {
      COMPANY_GMAIL_INBOX_ENABLED: 'true', COMPANY_GMAIL_INBOX_EMAIL: 'cocotripkr@gmail.com',
      COMPANY_GMAIL_INBOX_CLIENT_ID: 'fake-client', COMPANY_GMAIL_INBOX_CLIENT_SECRET: 'fake-secret',
      COMPANY_GMAIL_INBOX_REFRESH_TOKEN: 'fake-token', COMPANY_GMAIL_INBOX_CAPTURE_START_AT: '2026-09-06T00:00:00.000Z',
      COMPANY_GMAIL_INBOX_RETENTION_DAYS: '7',
    });
    await f.run();
    const control = f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`) as Row;
    control.sourceSchemaVersion = 1;
    delete (control.cursors as Row).external_inbox_messages;
    delete (control.cursors as Row).chat_sessions;
    f.records.set('external_inbox_messages/old-receipt', {
      channel: 'email', accountId: 'cocotripkr@gmail.com', receivedAtMs: EPOCH - 1000, sourceAtMs: EPOCH - 1000, expiresAtMs: EPOCH + 86_400_000,
    });
    f.records.set('chat_sessions/old-session', { ownerNotificationEligible: true, ownerNotificationAt: timeAtMs(EPOCH - 1000) });
    f.setNow(EPOCH + 300_000);
    expect((await f.run()).code).toBe('CHECKED');
    expect(f.ledger()).toHaveLength(0);
    expect(f.send).not.toHaveBeenCalled();
    expect(Object.keys((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors || {}) as Row))
      .toEqual(OWNER_SOURCES.map((source) => source.name));
  });

  it('treats a missing legacy cursor as corruption instead of silently skipping it', async () => {
    const f = fixture();
    await f.run();
    const control = f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`) as Row;
    delete (control.cursors as Row).bookings;
    f.setNow(EPOCH + 300_000);
    expect(await f.run()).toMatchObject({ ok: false, code: 'CURSOR_INVALID' });
    expect(f.queries).toEqual([]);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('queues a delayed company-email receipt by received time, plus new metadata-only customer chat', async () => {
    const f = fixture();
    Object.assign(f.env, {
      COMPANY_GMAIL_INBOX_ENABLED: 'true', COMPANY_GMAIL_INBOX_EMAIL: 'cocotripkr@gmail.com',
      COMPANY_GMAIL_INBOX_CLIENT_ID: 'fake-client', COMPANY_GMAIL_INBOX_CLIENT_SECRET: 'fake-secret',
      COMPANY_GMAIL_INBOX_REFRESH_TOKEN: 'fake-token', COMPANY_GMAIL_INBOX_CAPTURE_START_AT: '2026-09-06T00:00:00.000Z',
      COMPANY_GMAIL_INBOX_RETENTION_DAYS: '7',
    });
    await f.run();
    f.records.set('external_inbox_messages/new-receipt', {
      channel: 'email', accountId: 'cocotripkr@gmail.com', receivedAtMs: EPOCH + 1000, sourceAtMs: EPOCH - 60_000, expiresAtMs: EPOCH + 86_400_000,
      sender: PRIVATE, subject: PRIVATE, text: PRIVATE,
    });
    f.records.set('chat_sessions/new-session', {
      ownerNotificationEligible: true, ownerNotificationAt: timeAtMs(EPOCH + 1000), text: PRIVATE,
    });
    f.setNow(EPOCH + 300_000);
    expect((await f.run()).accepted).toBe(2);
    expect(f.ledger()).toHaveLength(2);
    expect(JSON.stringify(f.ledger())).not.toContain(PRIVATE);
    const sourceQueries = f.queries.filter((entry) => ['external_inbox_messages', 'chat_sessions'].includes(entry.collection));
    expect(sourceQueries.flatMap((entry) => entry.fields)).not.toEqual(expect.arrayContaining(['sender', 'subject', 'text']));
  });

  it('does not queue WhatsApp text after consent is closed or the message has expired', async () => {
    const f = fixture();
    Object.assign(f.env, {
      WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1',
      WHATSAPP_INBOX_WABA_ID: '111', WHATSAPP_INBOX_PHONE_NUMBER_ID: '222',
      WHATSAPP_INBOX_APP_SECRET: 'fake-app-secret', WHATSAPP_INBOX_VERIFY_TOKEN: 'fake-verify-token',
      WHATSAPP_INBOX_CAPTURE_START_AT: '2026-09-06T00:00:00.000Z', WHATSAPP_INBOX_RETENTION_DAYS: '7',
    });
    await f.run();
    const sessionId = 'a'.repeat(64);
    f.records.set(`whatsapp_inbox_sessions/${sessionId}`, {
      policyVersion: 1, accountId: '222', status: 'closed', startedAtMs: EPOCH - 10_000,
      expiresAtMs: EPOCH + 3_600_000, closedAtMs: EPOCH, updatedAtMs: EPOCH,
    });
    f.records.set('external_inbox_messages/private-receipt', {
      channel: 'whatsapp', accountId: '222', receivedAtMs: EPOCH + 1000, sourceAtMs: EPOCH + 1000, expiresAtMs: EPOCH + 10_000,
      whatsappPolicyVersion: 1, whatsappSessionId: sessionId, sender: PRIVATE, text: PRIVATE,
    });
    f.setNow(EPOCH + 300_000);
    expect((await f.run()).accepted).toBe(0);
    expect(f.ledger()).toHaveLength(0);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('queues a new WhatsApp receipt only while its exact consent session is active', async () => {
    const f = fixture();
    Object.assign(f.env, {
      WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1',
      WHATSAPP_INBOX_WABA_ID: '111', WHATSAPP_INBOX_PHONE_NUMBER_ID: '222',
      WHATSAPP_INBOX_APP_SECRET: 'fake-app-secret', WHATSAPP_INBOX_VERIFY_TOKEN: 'fake-verify-token',
      WHATSAPP_INBOX_CAPTURE_START_AT: '2026-09-06T00:00:00.000Z', WHATSAPP_INBOX_RETENTION_DAYS: '7',
    });
    await f.run();
    const sessionId = 'b'.repeat(64);
    f.records.set(`whatsapp_inbox_sessions/${sessionId}`, {
      policyVersion: 1, accountId: '222', status: 'active', startedAtMs: EPOCH - 10_000,
      expiresAtMs: EPOCH + 3_600_000, closedAtMs: 0, updatedAtMs: EPOCH,
    });
    f.records.set('external_inbox_messages/active-receipt', {
      channel: 'whatsapp', accountId: '222', receivedAtMs: EPOCH + 1000, sourceAtMs: EPOCH + 1000, expiresAtMs: EPOCH + 86_400_000,
      whatsappPolicyVersion: 1, whatsappSessionId: sessionId, sender: PRIVATE, text: PRIVATE,
    });
    f.setNow(EPOCH + 300_000);
    expect((await f.run()).accepted).toBe(1);
    expect(f.ledger()).toHaveLength(1);
    expect(JSON.stringify(f.ledger())).not.toContain(PRIVATE);
  });

  it('holds the WhatsApp source cursor when its consent-session read fails', async () => {
    const f = fixture();
    Object.assign(f.env, {
      WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1',
      WHATSAPP_INBOX_WABA_ID: '111', WHATSAPP_INBOX_PHONE_NUMBER_ID: '222',
      WHATSAPP_INBOX_APP_SECRET: 'fake-app-secret', WHATSAPP_INBOX_VERIFY_TOKEN: 'fake-verify-token',
      WHATSAPP_INBOX_CAPTURE_START_AT: '2026-09-06T00:00:00.000Z', WHATSAPP_INBOX_RETENTION_DAYS: '7',
    });
    await f.run();
    const sessionId = 'c'.repeat(64);
    f.records.set(`whatsapp_inbox_sessions/${sessionId}`, {
      policyVersion: 1, accountId: '222', status: 'active', startedAtMs: EPOCH - 10_000,
      expiresAtMs: EPOCH + 3_600_000, closedAtMs: 0, updatedAtMs: EPOCH,
    });
    f.records.set('external_inbox_messages/read-failure-receipt', {
      channel: 'whatsapp', accountId: '222', receivedAtMs: EPOCH + 1000, sourceAtMs: EPOCH + 1000,
      expiresAtMs: EPOCH + 86_400_000, whatsappPolicyVersion: 1, whatsappSessionId: sessionId,
    });
    f.failedDocuments.add(`whatsapp_inbox_sessions/${sessionId}`);
    f.setNow(EPOCH + 300_000);
    const cursorBefore = (f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).external_inbox_messages;
    const result = await f.run();
    expect(result).toMatchObject({ code: 'PARTIAL_SOURCE_FAILURE', sourceFailures: [{ source: 'external_inbox_messages', code: 'WHATSAPP_SESSION_READ_FAILED' }] });
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).external_inbox_messages).toBe(cursorBefore);
    expect(f.ledger()).toHaveLength(0);
    expect(f.send).not.toHaveBeenCalled();
  });
  it('continues exact timestamp ties past a page boundary without offset, loss or duplicate queue entries', async () => {
    const f = fixture(); await f.run();
    for (let index = 0; index < 23; index++) f.seed('bookings', `fake-${String(index).padStart(3, '0')}`);
    f.setNow(EPOCH + 300_000); expect((await f.run()).scanned).toBe(10);
    f.setNow(EPOCH + 600_000); expect((await f.run()).scanned).toBe(10);
    f.setNow(EPOCH + 900_000); expect((await f.run()).scanned).toBe(3);
    expect(f.ledger()).toHaveLength(23);
    const pages = f.queries.filter((query) => query.collection === 'bookings');
    expect(pages[1].after).toEqual([timeAtMs(EPOCH + 1000), 'fake-009']);
    expect(pages[2].after).toEqual([timeAtMs(EPOCH + 1000), 'fake-019']);
  });
  it('discovers all five active receipt sources without reading raw customer fields', async () => {
    const f = fixture(); await f.run();
    for (const spec of OWNER_SOURCES) f.seed(spec.name, `fake-${spec.name}`);
    f.setNow(EPOCH + 300_000); const result = await f.run();
    expect(result.scanned).toBe(5); expect(f.ledger()).toHaveLength(5); expect(f.send).toHaveBeenCalledTimes(3);
  });
  it('does not enqueue an old pending booking again when a new confirmation mirror is created', async () => {
    const f = fixture(); await f.run();
    f.seed('pending_bookings', 'fake-pending', { createdAt: timeAtMs(EPOCH - 1000) });
    f.seed('bookings', 'fake-provider-capture', { bookingRef: 'fake-pending', provider: 'paypal-manual' });
    f.setNow(EPOCH + 300_000); expect((await f.run()).ok).toBe(true);
    expect(f.ledger()).toEqual([]); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['paypal-manual', 'paypal-webhook'])('links actual mirror provider %s by bookingRef, not capture document ID', async (provider) => {
    const f = fixture(); await f.run();
    f.seed('pending_bookings', 'fake-pending-reference', { status: 'AWAITING_VERIFICATION' });
    f.seed('bookings', 'fake-distinct-capture-id', { bookingRef: 'fake-pending-reference', provider });
    f.setNow(EPOCH + 300_000); expect((await f.run()).ok).toBe(true);
    expect(f.ledger()).toHaveLength(1); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(['paypal-manual', 'paypal-webhook'])('isolates a missing pending source for %s across repeated runs; independent inquiries and queued delivery continue', async (provider) => {
    const f = fixture(); await f.run();
    const cursorBefore = (f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings;
    f.seed('bookings', PRIVATE, { bookingRef: 'fake-missing-pending', provider });
    f.seed('charter_inquiries', 'fake-independent-inquiry');
    const queued = eventFromSource('mood_bookings', 'fake-already-queued', { status: 'confirmed' });
    const queuedId = ownerEventId(queued, f.config, f.device);
    f.records.set(`${OWNER_EVENT_COLLECTION}/${queuedId}`, newOwnerEvent(queued, f.config, f.device, EPOCH));
    f.setNow(EPOCH + 300_000);
    const first = await f.run();
    expect(first).toMatchObject({ ok: true, code: 'PARTIAL_SOURCE_FAILURE', sourceFailureCount: 1, accepted: 2,
      sourceFailures: [{ source: 'bookings', code: 'SOURCE_LINK_INVALID' }] });
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.ledger()).toHaveLength(2);
    expect(f.ledger().filter(([, data]) => data.kind === 'inquiry')).toHaveLength(1);
    expect(f.ledger().some(([, data]) => data.eventKey === eventFromSource('bookings', PRIVATE, { status: 'confirmed', bookingRef: 'fake-missing-pending' }).eventKey)).toBe(false);
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings).toBe(cursorBefore);
    f.setNow(EPOCH + 600_000);
    const second = await f.run();
    expect(second).toMatchObject({ ok: true, code: 'PARTIAL_SOURCE_FAILURE', sourceFailureCount: 1, accepted: 0 });
    expect(f.send).toHaveBeenCalledTimes(2);
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings).toBe(cursorBefore);
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.sourceHealth as Row).bookings)
      .toEqual({ code: 'SOURCE_LINK_INVALID', checkedAtMs: EPOCH + 600_000, consecutiveFailures: 2 });
    expect(JSON.stringify([first, second, f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`), f.ledger()])).not.toContain(PRIVATE);
    expect(f.writes.every((filename) => filename.startsWith('owner_notification_'))).toBe(true);
  });
  it('does not skip a blocked booking or later records within its source, retaining the last safely committed tuple', async () => {
    const f = fixture(); await f.run();
    f.seed('bookings', 'a-safe');
    f.seed('bookings', 'b-blocked', { bookingRef: 'fake-missing', provider: 'paypal-manual' });
    f.seed('bookings', 'c-must-not-skip-to');
    f.setNow(EPOCH + 300_000); expect((await f.run()).code).toBe('PARTIAL_SOURCE_FAILURE');
    const sealed = (f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings;
    expect(openOwnerCursor(sealed, f.config, 'bookings')).toEqual({ time: timeAtMs(EPOCH + 1000), id: 'a-safe' });
    expect(f.ledger()).toHaveLength(1);
    f.setNow(EPOCH + 600_000); await f.run(); expect(f.ledger()).toHaveLength(1);
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings).toBe(sealed);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(['', undefined, 'fake/path', ' fake-reference ', 'x'.repeat(513)])('keeps an active mirror with invalid bookingRef (%s) blocked rather than silently advancing', async (bookingRef) => {
    const f = fixture(); await f.run();
    const cursorBefore = (f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings;
    f.seed('bookings', 'fake-invalid-link', { bookingRef, provider: 'paypal-manual' });
    f.seed('charter_inquiries', 'fake-independent'); f.setNow(EPOCH + 300_000);
    expect(await f.run()).toMatchObject({ code: 'PARTIAL_SOURCE_FAILURE', accepted: 1,
      sourceFailures: [{ source: 'bookings', code: 'SOURCE_LINK_INVALID' }] });
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings).toBe(cursorBefore);
    expect(f.ledger()).toHaveLength(1);
  });
  it('continues to exclude closed or test mirrors without treating their unused links as a blocking failure', async () => {
    const f = fixture(); await f.run();
    f.seed('bookings', 'fake-closed', { status: 'refunded', bookingRef: '', provider: 'paypal-manual' });
    f.seed('bookings', 'fake-test', { isTest: true, bookingRef: '', provider: 'paypal-webhook' });
    f.setNow(EPOCH + 300_000); expect((await f.run()).code).toBe('CHECKED'); expect(f.ledger()).toHaveLength(0);
  });
  it('isolates a source query failure with a fixed code and still handles an independent inquiry', async () => {
    const f = fixture(); await f.run(); f.failedCollections.add('bookings');
    f.seed('charter_inquiries', 'fake-inquiry'); f.setNow(EPOCH + 300_000);
    const result = await f.run();
    expect(result).toMatchObject({ ok: true, code: 'PARTIAL_SOURCE_FAILURE', accepted: 1,
      sourceFailures: [{ source: 'bookings', code: 'SOURCE_QUERY_FAILED' }] });
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });
  it('isolates invalid source timestamps instead of silently skipping the record or halting other sources', async () => {
    const f = fixture(); await f.run();
    f.seed('bookings', 'fake-bad-time', { createdAt: { seconds: Math.floor(EPOCH / 1000) + 1, nanoseconds: -1 } });
    f.seed('cs_tickets', 'fake-cs'); f.setNow(EPOCH + 300_000);
    expect(await f.run()).toMatchObject({ code: 'PARTIAL_SOURCE_FAILURE', accepted: 1,
      sourceFailures: [{ source: 'bookings', code: 'SOURCE_TIME_INVALID' }] });
    expect(f.ledger()).toHaveLength(1);
  });
  it('isolates an over-policy Firestore source ID without treating it as cursor corruption; CS and queued delivery continue once', async () => {
    const f = fixture(); await f.run();
    const longId = 'x'.repeat(513);
    const cursorBefore = (f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).charter_inquiries;
    f.seed('charter_inquiries', longId);
    f.seed('cs_tickets', 'fake-independent-cs', { status: 'open' });
    const queued = eventFromSource('mood_bookings', 'fake-queued-before-id-error', { status: 'confirmed' });
    const id = ownerEventId(queued, f.config, f.device);
    f.records.set(`${OWNER_EVENT_COLLECTION}/${id}`, newOwnerEvent(queued, f.config, f.device, EPOCH));
    for (let run = 1; run <= 2; run++) {
      f.setNow(EPOCH + run * 300_000);
      const result = await f.run();
      expect(result).toMatchObject({ ok: true, code: 'PARTIAL_SOURCE_FAILURE', accepted: run === 1 ? 2 : 0,
        sourceFailures: [{ source: 'charter_inquiries', code: 'SOURCE_ID_INVALID' }] });
      expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).charter_inquiries).toBe(cursorBefore);
      expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.sourceHealth as Row).charter_inquiries)
        .toEqual({ code: 'SOURCE_ID_INVALID', checkedAtMs: EPOCH + run * 300_000, consecutiveFailures: run });
      expect(JSON.stringify([result, f.ledger(), f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)])).not.toContain(longId);
    }
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.ledger()).toHaveLength(2);
    expect(f.records.has(`charter_inquiries/${longId}`)).toBe(true);
  });
  it('resumes the blocked source only when its fake prerequisite becomes valid, resetting source health without duplicate inquiries', async () => {
    const f = fixture(); await f.run();
    f.seed('bookings', 'fake-capture', { bookingRef: 'fake-pending', provider: 'paypal-webhook' });
    f.seed('charter_inquiries', 'fake-inquiry'); f.setNow(EPOCH + 300_000); await f.run();
    f.seed('pending_bookings', 'fake-pending'); // In-memory test repair only; product code never repairs source documents.
    f.setNow(EPOCH + 600_000); expect((await f.run()).code).toBe('CHECKED');
    expect(f.ledger()).toHaveLength(2); expect(f.send).toHaveBeenCalledTimes(2);
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.sourceHealth as Row).bookings)
      .toEqual({ code: 'CHECKED', checkedAtMs: EPOCH + 600_000, consecutiveFailures: 0 });
  });
  it('uses the real pure cart child builder output to group one parent instead of line IDs', async () => {
    const f = fixture(); await f.run();
    const children = buildCartChildBookings('fake-cart-order', { usdRate: 1400, lines: [
      { lineId: 'L1', productType: 'charter', amountKRW: 14000, booking: {} },
      { lineId: 'L2', productType: 'charter', amountKRW: 28000, booking: {} },
    ] }, {});
    for (const child of children) f.seed('bookings', child.childOrderID, { ...child.bookingDoc, paypalEnvironment: 'live' });
    f.setNow(EPOCH + 300_000); await f.run(); expect(f.ledger()).toHaveLength(1);
    expect(JSON.stringify(f.ledger())).not.toMatch(/amountKRW|amountUSD|fake-cart-order|L1|L2/);
  });
  it.each(['responded', 'resolved', 'closed', 'rejected', 'converted'])('a new inquiry already %s before first scan is not a pending-inquiry alert', async (status) => {
    const f = fixture(); await f.run(); f.seed('charter_inquiries', 'fake-auto-handled', { status });
    f.setNow(EPOCH + 300_000); expect((await f.run()).scanned).toBe(1);
    expect(f.ledger()).toHaveLength(0); expect(f.send).not.toHaveBeenCalled();
  });
  it('deduplicates cart children and pending/confirmed copies across source collections', async () => {
    const f = fixture(); await f.run();
    f.seed('pending_bookings', 'fake-order'); f.seed('bookings', 'fake-order');
    f.seed('bookings', 'child1', { parentOrderID: 'fake-cart' }); f.seed('bookings', 'child2', { parentOrderID: 'fake-cart' });
    f.setNow(EPOCH + 300_000); await f.run(); expect(f.ledger()).toHaveLength(2);
  });
  it('concurrent sweeps enqueue/send only once', async () => {
    const f = fixture(); await f.run(); f.seed('charter_inquiries', 'fake-inquiry'); f.setNow(EPOCH + 300_000);
    const results = await Promise.all([f.run(), f.run()]);
    expect(results.some((result) => result.code === 'BUSY')).toBe(true);
    expect(f.ledger()).toHaveLength(1); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('a failed atomic commit neither queues nor advances; raw database errors never escape', async () => {
    const f = fixture(); await f.run(); f.seed('bookings', PRIVATE); f.setNow(EPOCH + 300_000);
    const before = structuredClone(f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`));
    f.setFailCommit(true); const result = await f.run();
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)).toEqual(before);
    expect(f.ledger()).toEqual([]); expect(f.send).not.toHaveBeenCalled();
  });
  it('an event+cursor commit failure retains the exact source cursor and discovers the event on recovery', async () => {
    const f = fixture(); await f.run(); f.seed('bookings', PRIVATE); f.setNow(EPOCH + 300_000);
    const before = (f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings;
    f.setFailEventCommit(true); expect((await f.run()).ok).toBe(false);
    expect((f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings).toEqual(before);
    expect(f.ledger()).toHaveLength(0); expect(f.send).not.toHaveBeenCalled();
    f.setFailEventCommit(false); f.setNow(EPOCH + 600_000); expect((await f.run()).ok).toBe(true);
    expect(f.ledger()).toHaveLength(1); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('a selected-device worker does not dispatch to other subscriptions under the same owner', async () => {
    const f = fixture(); await f.run(); f.seed('charter_inquiries', 'fake-new'); f.setNow(EPOCH + 300_000);
    f.records.set(`push_subscriptions/${UID}_other`, { ...subscription(), endpoint: ENDPOINT + '-another' });
    await f.run(); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.reads.filter((path) => path.startsWith('push_subscriptions/')).every((path) => path === `push_subscriptions/${SUB_ID}`)).toBe(true);
  });
  it('a deleted previous document still resumes correctly with the stored scalar cursor', async () => {
    const f = fixture(); await f.run();
    for (let i = 0; i < 11; i++) f.seed('bookings', `fake-${String(i).padStart(2, '0')}`);
    f.setNow(EPOCH + 300_000); await f.run();
    f.records.delete('bookings/fake-09');
    f.setNow(EPOCH + 600_000); expect((await f.run()).scanned).toBe(1); expect(f.ledger()).toHaveLength(11);
  });
  it.each(['secret', 'scope', 'cursor', 'device'])('does not reset/backfill after %s changes', async (change) => {
    const f = fixture(); await f.run(); f.seed('bookings', 'fake-new'); f.setNow(EPOCH + 300_000);
    if (change === 'secret') f.env.CRON_SECRET = 'fake-rotated-secret-with-at-least-32-bytes';
    if (change === 'scope') f.env.OWNER_NOTIFICATION_LANGUAGE = 'en';
    if (change === 'cursor') (f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)?.cursors as Row).bookings = 'tampered';
    if (change === 'device') f.records.set(`push_subscriptions/${SUB_ID}`, { ...subscription(), keys: { p256dh: key(65, 5), auth: key(16) } });
    const before = structuredClone(f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`));
    expect((await f.run()).ok).toBe(false); expect(f.send).not.toHaveBeenCalled(); expect(f.queries).toEqual([]);
    expect(f.records.get(`${OWNER_CONTROL_COLLECTION}/v1`)).toEqual(before);
  });
  it('does not look at source records when the owner is disabled or selected subscription is absent', async () => {
    const f = fixture(); f.auth.getUser.mockResolvedValue({ ...userRecord(), disabled: true });
    expect((await f.run()).code).toBe('OWNER_DEVICE_REQUIRED'); expect(f.reads).toEqual([]);
    f.auth.getUser.mockResolvedValue(userRecord()); f.records.delete(`push_subscriptions/${SUB_ID}`);
    expect((await f.run()).code).toBe('OWNER_DEVICE_REQUIRED'); expect(f.queries).toEqual([]); expect(f.writes).toEqual([]);
  });
});

describe('single-device durable delivery and uncertain outcomes', () => {
  function queued() {
    const f = fixture();
    const event = eventFromSource('bookings', PRIVATE, { status: 'confirmed' });
    const id = ownerEventId(event, f.config, f.device);
    f.records.set(`${OWNER_EVENT_COLLECTION}/${id}`, newOwnerEvent(event, f.config, f.device, EPOCH));
    const runDelivery = () => deliverOwnerEvent(f.services, f.config, f.device, id, { now: f.now, send: f.send });
    const row = () => f.records.get(`${OWNER_EVENT_COLLECTION}/${id}`) || {};
    return { ...f, id, row, runDelivery };
  }
  it('provider acceptance is not called phone receipt, and replay sends zero additional messages', async () => {
    const f = queued();
    expect((await f.runDelivery()).code).toBe('PROVIDER_ACCEPTED');
    expect((await f.runDelivery()).code).toBe('ALREADY_HANDLED');
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.row().status).toBe('accepted');
    expect(JSON.stringify(f.row())).not.toContain(PRIVATE);
  });
  it('a second simultaneous claim cannot send while the first is pending', async () => {
    const f = queued();
    let release: (result: { outcome: string }) => void = () => {};
    f.send.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = f.runDelivery();
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    expect((await f.runDelivery()).code).toBe('BUSY');
    release({ outcome: 'accepted' }); await first; expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('fresh admin/device revocation after enqueue prevents dispatch without subscription deletion', async () => {
    const f = queued(); f.auth.getUser.mockResolvedValue({ ...userRecord(), disabled: true });
    expect((await f.runDelivery()).code).toBe('MANUAL_REQUIRED'); expect(f.send).not.toHaveBeenCalled();
    expect(f.records.has(`push_subscriptions/${SUB_ID}`)).toBe(true);
  });
  it('does not dispatch if account verification returns after the claim lease expired', async () => {
    const f = queued();
    f.auth.getUser.mockImplementation(async () => { f.setNow(EPOCH + OWNER_LEASE_MS + 1); return userRecord(); });
    expect((await f.runDelivery()).code).toBe('MANUAL_REQUIRED'); expect(f.send).not.toHaveBeenCalled();
  });
  it('known temporary rejection retries only when due, at most three attempts', async () => {
    const f = queued(); f.send.mockResolvedValue({ outcome: 'retryable' });
    expect((await f.runDelivery()).code).toBe('RETRY_SCHEDULED'); expect((await f.runDelivery()).code).toBe('NOT_DUE');
    f.setNow(EPOCH + 300_000); expect((await f.runDelivery()).code).toBe('RETRY_SCHEDULED');
    f.setNow(EPOCH + 900_000); expect((await f.runDelivery()).code).toBe('MANUAL_REQUIRED');
    f.setNow(EPOCH + 1_800_000); expect((await f.runDelivery()).code).toBe('ALREADY_HANDLED');
    expect(f.send).toHaveBeenCalledTimes(3);
  });
  it.each(['unknown', 'unexpected'])('never auto-retries an ambiguous %s result', async (outcome) => {
    const f = queued(); f.send.mockResolvedValue({ outcome });
    expect((await f.runDelivery()).code).toBe('OUTCOME_UNKNOWN'); f.setNow(EPOCH + 300_000);
    expect((await f.runDelivery()).code).toBe('ALREADY_HANDLED'); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('a never-settling sender is quarantined on timeout, not retried', async () => {
    const f = queued(); f.send.mockImplementation(() => new Promise(() => {}));
    expect((await deliverOwnerEvent(f.services, f.config, f.device, f.id, { now: f.now, send: f.send, timeoutMs: 5 })).code).toBe('OUTCOME_UNKNOWN');
    expect(f.row().status).toBe('unknown');
  });
  it('a post-send persistence failure becomes unknown after the lease, never a second send', async () => {
    const f = queued();
    f.send.mockImplementation(async () => { f.setFailCommit(true); return { outcome: 'accepted' }; });
    await expect(f.runDelivery()).rejects.toThrow(); f.setFailCommit(false);
    f.setNow(EPOCH + OWNER_LEASE_MS + 1);
    expect((await f.runDelivery()).code).toBe('OUTCOME_UNKNOWN'); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('requires the pinned fingerprint and valid ledger kind, not a raw arbitrary payload', async () => {
    const f = queued(); Object.assign(f.row(), { kind: 'mail', title: PRIVATE, body: PRIVATE, url: 'https://evil.invalid' });
    expect((await f.runDelivery()).code).toBe('EVENT_INVALID'); expect(f.send).not.toHaveBeenCalled();
  });
  it('expired records never dispatch and cleanup only removes the new ledger, never sources', async () => {
    const f = queued(); f.setNow(EPOCH + 8 * 86_400_000);
    expect((await f.runDelivery()).code).toBe('MANUAL_REQUIRED'); expect(f.send).not.toHaveBeenCalled();
    await f.run(); await f.run(); expect(f.ledger()).toHaveLength(0);
    expect(f.records.has(`push_subscriptions/${SUB_ID}`)).toBe(true);
  });
});

describe('transport adapter and schedule contracts, with no external calls', () => {
  it('refuses unauthenticated handler calls and ignores caller-supplied UID/body when disabled', async () => {
    const fetch = vi.fn(() => { throw new Error('NETWORK_FORBIDDEN'); }); vi.stubGlobal('fetch', fetch);
    vi.stubEnv('OWNER_EVENT_PUSH_ENABLED', 'false');
    const response = { status: vi.fn(), json: vi.fn() }; response.status.mockReturnValue(response);
    const request = { headers: {}, body: { uid: PRIVATE }, query: { uid: PRIVATE } };
    authorize.mockResolvedValue({ ok: false, error: PRIVATE }); await ownerHandler(request, response);
    expect(response.status).toHaveBeenCalledWith(401); expect(response.json).toHaveBeenCalledWith({ ok: false, code: 'AUTH_REQUIRED' });
    authorize.mockResolvedValue({ ok: true }); await ownerHandler(request, response);
    expect(response.json).toHaveBeenLastCalledWith({ ok: true, enabled: false, code: 'DISABLED' });
    expect(fetch).not.toHaveBeenCalled(); expect(transport.sendNotification).not.toHaveBeenCalled();
  });
  it.each([200, 201, 202])('accepts provider HTTP %s using one selected subscription and request-local VAPID settings', async (statusCode) => {
    transport.sendNotification.mockResolvedValue({ statusCode });
    const config = readOwnerNotificationConfig(environment());
    const payload = ownerPayload('booking', ownerHash('fake-event'), 'ko');
    expect(await sendSingleOwnerPush(subscription(), payload, config)).toEqual({ outcome: 'accepted' });
    expect(transport.sendNotification).toHaveBeenCalledWith(subscription(), JSON.stringify(payload), expect.objectContaining({ timeout: 5000, TTL: 300 }));
  });
  it.each([429, 500, 502, 503, 504])('bounded retry classification for HTTP %s without logging response text', async (statusCode) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    transport.sendNotification.mockRejectedValue({ statusCode, body: PRIVATE, message: PRIVATE });
    expect(await sendSingleOwnerPush(subscription(), {}, readOwnerNotificationConfig(environment()))).toEqual({ outcome: 'retryable' });
    expect(log).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 410, 413])('permanent rejection HTTP %s does not delete shared subscription or retry forever', async (statusCode) => {
    transport.sendNotification.mockRejectedValue({ statusCode, body: PRIVATE });
    expect(await sendSingleOwnerPush(subscription(), {}, readOwnerNotificationConfig(environment()))).toEqual({ outcome: 'rejected' });
  });
  it('network reset/no status is unknown, and no raw exception escapes', async () => {
    transport.sendNotification.mockRejectedValue(new Error(PRIVATE));
    expect(await sendSingleOwnerPush(subscription(), {}, readOwnerNotificationConfig(environment()))).toEqual({ outcome: 'unknown' });
  });
  it('registers one five-minute authenticated dispatcher job with no query-provided recipient', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(vercel.crons.filter((entry: { path: string }) => entry.path.includes('owner-notification-sweep')))
      .toEqual([{ path: '/api/cron-runner?job=owner-notification-sweep', schedule: '*/5 * * * *' }]);
    const dispatcher = readFileSync('api/cron-runner.js', 'utf8');
    expect(dispatcher).toContain("'owner-notification-sweep':    ownerNotificationSweep");
    expect(dispatcher.indexOf('await verifyCronRequest(req)')).toBeLessThan(dispatcher.indexOf('return JOBS[job](req, res)'));
    const worker = readFileSync('api/_crons/owner-notification-sweep.js', 'utf8');
    expect(worker).not.toMatch(/req\.(body|query)|sendPushToUser|console\./);
  });
  it('guards the producer metadata contracts separately from runtime query/queue behavior', () => {
    const source = (file: string) => readFileSync(file, 'utf8');
    expect(source('api/manual-payment-request.js')).toMatch(/status: 'AWAITING_VERIFICATION',\s*createdAt: FieldValue\.serverTimestamp\(\)/);
    expect(source('api/inquiry-submit.js')).toMatch(/status: 'NEW',\s*createdAt: FieldValue\.serverTimestamp\(\)/);
    expect(source('api/telegram-webhook-admin.js')).toMatch(/status: 'open',\s*createdAt: FieldValue\.serverTimestamp\(\)/);
    expect(source('api/mood-book.js')).toContain('const createdAt = Date.now()');
    expect(source('api/mood-book.js')).toContain("status: 'confirmed'");
    expect(source('api/capturePaypalOrder.js')).toContain('bookingRef: orderID');
    expect(source('api/capturePaypalOrder.js')).toContain("paypalEnvironment: _isSandboxCapture ? 'sandbox' : 'live'");
    expect(source('api/captureCartOrder.js')).toContain("paypalEnvironment: isSandbox ? 'sandbox' : 'live'");
    expect(source('api/_shared/booking-confirm.js')).toContain('const bookingId = paypalTransactionId || bookingRef');
    expect(source('api/_shared/booking-confirm.js')).toContain("provider: source === 'webhook' ? 'paypal-webhook' : 'paypal-manual'");
    expect(source('api/_shared/inquiry-response-delivery.js')).toContain("{ status: 'responded' }");
  });
});
