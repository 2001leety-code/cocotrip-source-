import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { SESSION_DURATION_MS, START_FRESHNESS_MS, sessionDocId, supportCommand, transitionSupportSession,
  validateSupportSession } from '../../api/_shared/whatsapp-support-sessions.js';
import { prepareExternalInboxMessage, writeExternalInboxMessages } from '../../api/_shared/external-inbox-store.js';

const NOW = Date.parse('2026-09-08T04:00:00Z');
const START = 'COCOTRIP SUPPORT START';
const sender = '821012345678';
const accountId = '222';
const id = sessionDocId(accountId, sender);
const sessionPath = `whatsapp_inbox_sessions/${id}`;
const context = { accountId, sender, sessionId: id };
const active = { policyVersion: 1, accountId, sender, status: 'active', startedAtMs: NOW - 60_000,
  expiresAtMs: NOW - 60_000 + SESSION_DURATION_MS, updatedAtMs: NOW - 60_000, closedAtMs: 0, lastStartMessageId: 'start-previous' };
const message = { channel: 'whatsapp', accountId, sender, providerThreadId: sender, providerMessageId: 'receipt-synthetic',
  sourceAtMs: NOW - 1000, kind: 'text', subject: '', text: 'SYNTHETIC_PRIVATE_CONTENT', truncated: false };
const control = (text = START, sourceAtMs = NOW - 1000, providerMessageId = 'control-new') => ({ ...message, text, sourceAtMs, providerMessageId });
const dbWith = (session: unknown = active) => createFakeFirestore(session === undefined ? {} : { [sessionPath]: session });
const write = (db: ReturnType<typeof createFakeFirestore>, messages = [message], now = () => NOW) => writeExternalInboxMessages({
  db, messages, nowMs: NOW, now, retentionDays: 7, captureStartAtMs: NOW - 86_400_000,
});
const storedMessages = (db: ReturnType<typeof createFakeFirestore>) => Object.entries(db.__dump()).filter(([path]) => path.startsWith('external_inbox_messages/'));

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK_FORBIDDEN'); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('strict sender-scoped support session contract', () => {
  it('pins the exact account and sender hash and fixed maximum duration', () => {
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionDocId('333', sender)).not.toBe(id);
    expect(sessionDocId(accountId, '821099999999')).not.toBe(id);
    expect(SESSION_DURATION_MS).toBe(7_200_000);
    expect(START_FRESHNESS_MS).toBe(120_000);
    expect(validateSupportSession(active, context)).toEqual(active);
  });
  it.each(['', '0', '+821012345678', ' 821012345678', '821012345678\n', 'x', '1'.repeat(21)])('rejects malformed sender %j', value => {
    expect(() => sessionDocId(accountId, value)).toThrow('SUPPORT_ID_INVALID');
  });
  it.each([
    { policyVersion: 2 }, { accountId: '333' }, { sender: '821099999999' }, { sender: undefined }, { status: 'unknown' },
    { expiresAtMs: active.expiresAtMs + 1 }, { startedAtMs: -1 }, { updatedAtMs: active.startedAtMs - 1 },
    { closedAtMs: active.startedAtMs }, { lastStartMessageId: '' }, { lastStartMessageId: 'x\n' }, { arbitrary: true },
  ])('rejects contaminated or cross-account session %j', patch => {
    expect(validateSupportSession({ ...active, ...patch }, context)).toBeNull();
  });
  it('does not allow a correct body stored under another document key', () => {
    expect(validateSupportSession(active, { ...context, sessionId: 'f'.repeat(64) })).toBeNull();
  });
  it('accepts a sender-free unknown STOP barrier but never promotes it to active or blocked', () => {
    const tombstone = { policyVersion: 1, accountId, status: 'closed', startedAtMs: 0, expiresAtMs: 0,
      updatedAtMs: NOW, closedAtMs: NOW, lastStartMessageId: '' };
    expect(validateSupportSession(tombstone, context)).toEqual(tombstone);
    expect(validateSupportSession({ ...tombstone, status: 'active' }, context)).toBeNull();
    expect(validateSupportSession({ ...tombstone, status: 'blocked' }, context)).toBeNull();
    expect(validateSupportSession({ ...tombstone, sender, status: 'blocked' }, context)).not.toBeNull();
  });
  it.each([START + '\0', START + '\n', START + '\r', START + ' ', ' ' + START, START.toLowerCase(),
    'START', 'Support start', 'STOP ', 'stop', 'COCOTRIP SUPPORT STOP\n'])('never normalizes a command variant %j', text => {
    expect(supportCommand('text', text)).toBe('message');
    expect(transitionSupportSession(null, control(text), { nowMs: NOW })).toEqual({ session: null, changed: false, allowMessage: false });
  });
  it('recognizes exact text commands only; captions and non-text kinds cannot open sessions', () => {
    expect(supportCommand('text', START)).toBe('start');
    expect(supportCommand('text', 'STOP')).toBe('stop');
    expect(supportCommand('text', 'COCOTRIP SUPPORT STOP')).toBe('stop');
    expect(supportCommand('image', START)).toBe('message');
  });
});

describe('session transitions without body storage', () => {
  it('starts only from a fresh explicit command, and source time bounds the two hours', () => {
    const result = transitionSupportSession(null, control(), { nowMs: NOW });
    expect(result).toMatchObject({ changed: true, allowMessage: false, session: {
      status: 'active', startedAtMs: NOW - 1000, expiresAtMs: NOW - 1000 + SESSION_DURATION_MS,
    } });
    expect(JSON.stringify(result.session)).not.toContain(START);
  });
  it.each([NOW - 120_001, NOW + 1, 0, NaN])('refuses stale/future/invalid START time %s', sourceAtMs => {
    expect(transitionSupportSession(null, control(START, sourceAtMs), { nowMs: NOW }).changed).toBe(false);
  });
  it('accepts the exact 120-second boundary and never extends an active session', () => {
    expect(transitionSupportSession(null, control(START, NOW - 120_000), { nowMs: NOW }).changed).toBe(true);
    expect(transitionSupportSession(active, control(), { nowMs: NOW })).toEqual({ session: active, changed: false, allowMessage: false });
  });
  it('same provider START ID cannot reopen an expired or closed session', () => {
    const closed = { ...active, status: 'closed', closedAtMs: NOW - 5000, updatedAtMs: NOW - 5000 };
    expect(transitionSupportSession(closed, control(START, NOW - 1000, active.lastStartMessageId), { nowMs: NOW }).changed).toBe(false);
  });
  it('a fresh later START may reopen closed, but never blocked, and cannot reuse a closure timestamp', () => {
    const closed = { ...active, status: 'closed', closedAtMs: NOW - 5000, updatedAtMs: NOW - 5000 };
    expect(transitionSupportSession(closed, control(), { nowMs: NOW }).session.status).toBe('active');
    expect(transitionSupportSession({ ...closed, status: 'blocked' }, control(), { nowMs: NOW }).changed).toBe(false);
    expect(transitionSupportSession(closed, control(START, NOW - 5000), { nowMs: NOW }).changed).toBe(false);
  });
  it('unknown STOP stores a phone-free barrier; repeated old STOP does not refresh it', () => {
    const first = transitionSupportSession(null, control('STOP'), { nowMs: NOW });
    expect(first.session).not.toHaveProperty('sender');
    expect(first.session).toMatchObject({ status: 'closed', closedAtMs: NOW, startedAtMs: 0, expiresAtMs: 0 });
    expect(transitionSupportSession(first.session, control('STOP'), { nowMs: NOW + 50 }).changed).toBe(false);
    expect(transitionSupportSession(first.session, control(START, NOW), { nowMs: NOW }).changed).toBe(false);
  });
  it('an old STOP from before the current session never closes its replacement', () => {
    expect(transitionSupportSession(active, control('STOP', active.startedAtMs - 1), { nowMs: NOW }).changed).toBe(false);
  });
  it.each([
    [active.startedAtMs - 1, NOW, false], [active.startedAtMs, NOW, false], [active.startedAtMs + 1000, NOW, true],
    [active.expiresAtMs, active.expiresAtMs, false], [active.expiresAtMs - 1, active.expiresAtMs, false],
  ])('requires message/clock within the active window (%s, %s)', (sourceAtMs, nowMs, allowed) => {
    expect(transitionSupportSession(active, { ...message, sourceAtMs }, { nowMs }).allowMessage).toBe(allowed);
  });
});

describe('atomic privacy enforcement before message preparation', () => {
  it('unknown private text reads its session only and writes absolutely nothing', async () => {
    const db = createFakeFirestore();
    // A body with an invalid type would throw if prepare ran before the session check.
    const privateMessage = { ...message, text: null };
    expect(await write(db, [privateMessage])).toMatchObject({ created: 0, ignored: 1 });
    expect(db.__dump()).toEqual({});
    expect(db.__stats.reads).toBe(1);
  });
  it.each(['closed', 'blocked', 'expired', 'malformed', 'null'])('stores no body for %s sessions', async kind => {
    const session = kind === 'expired' ? { ...active, startedAtMs: NOW - SESSION_DURATION_MS, expiresAtMs: NOW, updatedAtMs: NOW - SESSION_DURATION_MS }
      : kind === 'malformed' ? { ...active, policyVersion: 0 } : kind === 'null' ? null
      : { ...active, status: kind, closedAtMs: NOW, updatedAtMs: NOW };
    const db = dbWith(session);
    const initial = db.__dump();
    expect((await write(db, [{ ...message, text: null }])).created).toBe(0);
    expect(db.__dump()).toEqual(initial);
  });
  it('new START creates only the session and not a receipt/connection-success record', async () => {
    const db = createFakeFirestore();
    expect(await write(db, [control()])).toMatchObject({ created: 0 });
    expect(Object.keys(db.__dump())).toEqual([sessionPath]);
    expect(JSON.stringify(db.__dump())).not.toContain(START);
  });
  it('exact START then text shares a transaction and stamps the two provenance fields', async () => {
    const db = createFakeFirestore();
    expect((await write(db, [control(START, NOW - 2000), message])).created).toBe(1);
    const [, receipt] = storedMessages(db)[0];
    expect(receipt).toMatchObject({ whatsappPolicyVersion: 1, whatsappSessionId: id, text: message.text });
    expect(receipt).not.toHaveProperty('command');
    expect(db.__stats.transactions).toBe(1);
  });
  it.each([false, true])('same-second private text in the START batch is never stored (text first: %s)', async textFirst => {
    const db = createFakeFirestore();
    const start = control(START, NOW - 2000);
    const sameSecond = { ...message, sourceAtMs: start.sourceAtMs };
    const result = await write(db, textFirst ? [sameSecond, start] : [start, sameSecond]);
    expect(result.created).toBe(0);
    expect(storedMessages(db)).toHaveLength(0);
    expect(db.__get('external_inbox_state/whatsapp')).toBeUndefined();
    expect(db.__get(sessionPath)).toMatchObject({ status: 'active', startedAtMs: start.sourceAtMs });
    expect(JSON.stringify(db.__dump())).not.toContain(message.text);
  });
  it('late same-second text is excluded in a later batch, while next-second text is stored', async () => {
    const db = createFakeFirestore();
    const start = control(START, NOW - 2000);
    await write(db, [start]);
    const afterStart = db.__dump();
    expect((await write(db, [{ ...message, sourceAtMs: start.sourceAtMs }])).created).toBe(0);
    expect(db.__dump()).toEqual(afterStart);
    const nextSecond = { ...message, providerMessageId: 'next-second-receipt', sourceAtMs: start.sourceAtMs + 1000 };
    expect((await write(db, [nextSecond])).created).toBe(1);
    expect(storedMessages(db)).toHaveLength(1);
    expect(storedMessages(db)[0][1].providerMessageId).toBe('next-second-receipt');
  });
  it.each([
    ['start', 'text', 'stop'], ['stop', 'text', 'start'], ['text', 'start', 'stop'],
  ])('STOP wins over same-batch START/text regardless of supplied order %j', async (...order) => {
    const candidates = { start: control(START, NOW - 3000), text: { ...message, sourceAtMs: NOW - 2000 }, stop: control('STOP', NOW - 1000, 'stop-new') };
    const db = createFakeFirestore();
    const result = await write(db, order.map(key => candidates[key as keyof typeof candidates]));
    expect(result.created).toBe(0);
    expect(storedMessages(db)).toHaveLength(0);
    expect(db.__get(sessionPath)).toMatchObject({ status: 'closed', closedAtMs: NOW });
  });
  it('STOP for an unknown sender writes a hashed tombstone only, not sender/body/profile/state', async () => {
    const db = createFakeFirestore();
    await write(db, [control('STOP')]);
    const serialized = JSON.stringify(db.__dump());
    expect(serialized).not.toContain(sender);
    expect(serialized).not.toContain('STOP');
    expect(storedMessages(db)).toHaveLength(0);
    expect(db.__get('external_inbox_state/whatsapp')).toBeUndefined();
  });
  it('all 1,000 unknown messages remain bounded, unreadied and unwritten', async () => {
    const db = createFakeFirestore();
    const result = await write(db, Array.from({ length: 1000 }, (_, i) => ({ ...message, providerMessageId: 'unknown-' + i, text: null })));
    expect(result).toEqual({ created: 0, duplicate: 0, ignored: 1000 });
    expect(db.__stats.transactions).toBe(5);
    expect(db.__dump()).toEqual({});
  });
  it('cross-account existing session cannot grant storage or be overwritten by START', async () => {
    const db = dbWith({ ...active, accountId: '333' });
    const initial = db.__dump();
    expect((await write(db, [control(), message])).created).toBe(0);
    expect(db.__dump()).toEqual(initial);
  });
  it.each(['closed', 'blocked'])('retries the session read when %s commits before the message transaction', async status => {
    const db = dbWith();
    let intervened = false;
    db.__beforeCommit = async () => {
      if (!intervened) { intervened = true; db.__set(sessionPath, { ...active, status, updatedAtMs: NOW, closedAtMs: NOW }); }
    };
    expect((await write(db)).created).toBe(0);
    expect(db.__stats.retries).toBe(1);
    expect(storedMessages(db)).toHaveLength(0);
  });
  it('rechecks the live clock on transaction retry instead of retaining the request time', async () => {
    const nearExpiry = { ...active, startedAtMs: NOW - SESSION_DURATION_MS + 1000, expiresAtMs: NOW + 1000, updatedAtMs: NOW - 60_000 };
    const db = dbWith(nearExpiry);
    let clock = NOW;
    let intervened = false;
    db.__beforeCommit = async () => {
      if (!intervened) { intervened = true; clock = NOW + 1000; db.__set(sessionPath, nearExpiry); }
    };
    expect((await write(db, [message], () => clock)).created).toBe(0);
    expect(storedMessages(db)).toHaveLength(0);
    expect(db.__stats.retries).toBe(1);
  });
  it('a slow receipt/state read crossing expiration cannot write the prepared body', async () => {
    const nearExpiry = { ...active, startedAtMs: NOW - SESSION_DURATION_MS + 1000, expiresAtMs: NOW + 1000, updatedAtMs: NOW - 60_000 };
    const db = dbWith(nearExpiry);
    let times = 0;
    expect((await write(db, [message], () => ++times === 1 ? NOW : NOW + 1000)).created).toBe(0);
    expect(storedMessages(db)).toHaveLength(0);
  });
  it('START freshness expiring during reads cannot leave an orphan authorized receipt', async () => {
    const db = createFakeFirestore();
    let times = 0;
    expect((await write(db, [control(START, NOW - 120_000), message], () => ++times === 1 ? NOW : NOW + 1)).created).toBe(0);
    expect(db.__dump()).toEqual({});
  });
  it('duplicate receipts never rewrite body or connection state and retain session proof', async () => {
    const db = dbWith();
    expect((await write(db)).created).toBe(1);
    const first = db.__dump();
    expect((await write(db, [{ ...message, text: 'changed replay' }])).duplicate).toBe(1);
    expect(db.__dump()).toEqual(first);
  });
  it('proof whitelist preserves valid WhatsApp markers but rejects mismatched session identities', () => {
    const policy = { nowMs: NOW, retentionDays: 7 };
    expect(prepareExternalInboxMessage({ ...message, whatsappPolicyVersion: 1, whatsappSessionId: id }, policy).data.whatsappSessionId).toBe(id);
    expect(() => prepareExternalInboxMessage({ ...message, whatsappPolicyVersion: 1, whatsappSessionId: 'f'.repeat(64) }, policy)).toThrow('INBOX_SESSION_PROOF_INVALID');
    const email = prepareExternalInboxMessage({ ...message, channel: 'email', accountId: 'company@example.invalid', sender: 'sender@example.invalid', whatsappPolicyVersion: 1, whatsappSessionId: id }, policy);
    expect(email.data).not.toHaveProperty('whatsappPolicyVersion');
    expect(email.data).not.toHaveProperty('whatsappSessionId');
  });
});
