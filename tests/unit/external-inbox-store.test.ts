import { describe, expect, it } from 'vitest';
import { createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
import {
  EXTERNAL_INBOX_MESSAGES_COLLECTION, EXTERNAL_INBOX_STATE_COLLECTION,
  planExpiredExternalInboxCleanup, prepareExternalInboxMessage, writeExternalInboxMessage, writeExternalInboxMessages,
} from '../../api/_shared/external-inbox-store.js';

const NOW = Date.parse('2026-09-08T02:00:00Z');
const DAY = 86_400_000;
const message = {
  channel: 'whatsapp', accountId: '222', providerMessageId: 'wamid.synthetic', providerThreadId: '821012345678',
  sourceAtMs: NOW - 1000, sender: '821012345678', subject: '', text: 'Synthetic inquiry only', kind: 'text', truncated: false,
};
const policy = { nowMs: NOW, retentionDays: 7 };
const captureStartAtMs = NOW - DAY;

describe('external inbox minimal deterministic storage', () => {
  it('preserves the agreed minimum only and uses server receipt time plus source-based TTL', () => {
    const { docId, data } = prepareExternalInboxMessage({ ...message, receivedAtMs: 1, raw: { token: 'forbidden' }, html: '<div>forbidden</div>' }, policy);
    expect(docId).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(data).sort()).toEqual(['accountId', 'channel', 'expiresAt', 'expiresAtMs', 'kind', 'providerMessageId', 'providerThreadId', 'receivedAtMs', 'sender', 'sourceAtMs', 'subject', 'text', 'truncated'].sort());
    expect(data.receivedAtMs).toBe(NOW);
    expect(data.expiresAtMs).toBe(message.sourceAtMs + 7 * DAY);
    expect(data.expiresAt).toEqual(new Date(data.expiresAtMs));
    expect(JSON.stringify(data)).not.toContain('forbidden');
  });

  it('deduplicates by provider ID scoped to account and channel, not body or receipt time', () => {
    const first = prepareExternalInboxMessage(message, policy).docId;
    expect(prepareExternalInboxMessage({ ...message, text: 'changed replay' }, { ...policy, nowMs: NOW + 1 }).docId).toBe(first);
    expect(prepareExternalInboxMessage({ ...message, accountId: '333' }, policy).docId).not.toBe(first);
    expect(prepareExternalInboxMessage({ ...message, channel: 'email', kind: 'email' }, policy).docId).not.toBe(first);
  });

  it('accepts Gmail canonical strings without importing any service or copying raw fields', () => {
    const { data } = prepareExternalInboxMessage({ ...message, channel: 'email', accountId: 'company@example.invalid', sender: 'sender@example.invalid', kind: 'email', subject: 'A question', text: 'Snippet only' }, policy);
    expect(data).toMatchObject({ channel: 'email', kind: 'email', subject: 'A question', text: 'Snippet only' });
  });

  it('caps Unicode text safely and marks every dropped character', () => {
    const { data } = prepareExternalInboxMessage({ ...message, sender: 's'.repeat(321), subject: 'a'.repeat(257), text: `\0${'😀'.repeat(4001)}` }, policy);
    expect(Array.from(data.text)).toHaveLength(4000);
    expect(data.text).toBe('😀'.repeat(4000));
    expect(data.sender).toHaveLength(320);
    expect(data.subject).toHaveLength(256);
    expect(data.truncated).toBe(true);
    expect(prepareExternalInboxMessage({ ...message, truncated: true }, policy).data.truncated).toBe(true);
  });

  it.each([0, 91, 1.5, undefined, '7'])('has no default retention for invalid policy %s', retentionDays => {
    expect(() => prepareExternalInboxMessage(message, { nowMs: NOW, retentionDays })).toThrow('INBOX_POLICY_INVALID');
  });
  it.each([0, NaN, NOW + 1, NOW - 7 * DAY])('rejects invalid, future or already expired source timestamp %s', sourceAtMs => {
    expect(() => prepareExternalInboxMessage({ ...message, sourceAtMs }, policy)).toThrow();
  });
  it.each(['', ' bad ', 'a\n', 'x'.repeat(513)])('rejects malformed provider identity', providerMessageId => {
    expect(() => prepareExternalInboxMessage({ ...message, providerMessageId }, policy)).toThrow('INBOX_IDENTIFIER_INVALID');
  });
  it('hashes provider slashes instead of treating them as document paths', () => {
    expect(prepareExternalInboxMessage({ ...message, providerMessageId: 'opaque/id' }, policy).docId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('writes a message and connection state atomically; duplicate never refreshes state', async () => {
    const db = createFakeFirestore();
    const options = { db, message, ...policy, captureStartAtMs };
    expect(await writeExternalInboxMessage(options)).toEqual({ created: true, duplicate: false });
    const snapshot = db.__dump();
    expect(Object.keys(snapshot)).toHaveLength(2);
    expect(snapshot[`${EXTERNAL_INBOX_STATE_COLLECTION}/whatsapp`]).toMatchObject({ status: 'connected', accountId: '222', lastReceivedAtMs: NOW, lastAttemptAtMs: NOW, captureStartAtMs, retentionDays: 7 });
    expect(await writeExternalInboxMessage({ ...options, nowMs: NOW + 50 })).toEqual({ created: false, duplicate: true });
    expect(db.__dump()).toEqual(snapshot);
  });

  it('two simultaneous deliveries create exactly one document and one state update', async () => {
    const db = createFakeFirestore();
    const barrier = makeBarrier(2);
    db.__beforeCommit = async ({ attempt }: { attempt: number }) => { if (attempt === 1) await barrier.wait(); };
    const results = await Promise.all([1, 2].map(() => writeExternalInboxMessage({ db, message, ...policy, captureStartAtMs })));
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(results.filter(result => result.duplicate)).toHaveLength(1);
    expect(db.__stats.retries).toBe(1);
    expect(Object.keys(db.__dump()).filter(path => path.startsWith(`${EXTERNAL_INBOX_MESSAGES_COLLECTION}/`))).toHaveLength(1);
    expect(db.__version(`${EXTERNAL_INBOX_STATE_COLLECTION}/whatsapp`)).toBe(1);
  });

  it('concurrent distinct messages are preserved and an older receipt cannot rewind state', async () => {
    const db = createFakeFirestore();
    await writeExternalInboxMessage({ db, message, ...policy, nowMs: NOW + 100, captureStartAtMs });
    await writeExternalInboxMessage({ db, message: { ...message, providerMessageId: 'second' }, ...policy, captureStartAtMs });
    expect(db.__get(`${EXTERNAL_INBOX_STATE_COLLECTION}/whatsapp`).lastReceivedAtMs).toBe(NOW + 100);
    expect(Object.keys(db.__dump())).toHaveLength(3);
  });

  it('stores 1,000 selected receipts using five bounded transactions and bulk reads', async () => {
    const db = createFakeFirestore();
    const runTransaction = db.runTransaction.bind(db);
    const bulkSizes: number[] = [];
    db.runTransaction = callback => runTransaction(transaction => callback({
      ...transaction,
      getAll: async (...refs: Parameters<typeof transaction.get>[0][]) => {
        bulkSizes.push(refs.length);
        return Promise.all(refs.map(ref => transaction.get(ref)));
      },
    }));
    const messages = Array.from({ length: 1000 }, (_, index) => ({ ...message, providerMessageId: String(index) }));
    expect(await writeExternalInboxMessages({ db, messages, ...policy, captureStartAtMs })).toEqual({ created: 1000, duplicate: 0 });
    expect(bulkSizes).toEqual([200, 200, 200, 200, 200]);
    expect(db.__stats.transactions).toBe(5);
    const stateVersion = db.__version('external_inbox_state/whatsapp');
    expect(await writeExternalInboxMessages({ db, messages, ...policy, nowMs: NOW + 1, captureStartAtMs })).toEqual({ created: 0, duplicate: 1000 });
    expect(db.__version('external_inbox_state/whatsapp')).toBe(stateVersion);
  });

  it('rejects a mixed account or invalid later record before committing the first item', async () => {
    const db = createFakeFirestore();
    await expect(writeExternalInboxMessages({ db, messages: [message, { ...message, accountId: '333' }], ...policy, captureStartAtMs })).rejects.toThrow('INBOX_WRITER_CHANNEL_INVALID');
    await expect(writeExternalInboxMessages({ db, messages: [message, { ...message, sourceAtMs: NOW + 1 }], ...policy, captureStartAtMs })).rejects.toThrow('INBOX_SOURCE_TIME_FUTURE');
    expect(db.__dump()).toEqual({});
    expect(db.__stats.reads).toBe(0);
  });

  it('failed transaction commits neither message nor state and can be retried safely', async () => {
    const db = createFakeFirestore();
    db.__beforeCommit = async () => { throw new Error('synthetic storage failure'); };
    await expect(writeExternalInboxMessage({ db, message, ...policy, captureStartAtMs })).rejects.toThrow();
    expect(db.__dump()).toEqual({});
    db.__beforeCommit = null;
    expect((await writeExternalInboxMessage({ db, message, ...policy, captureStartAtMs })).created).toBe(true);
  });
  it('rejects missing collection policy and pre-start input before any DB calls', async () => {
    const db = createFakeFirestore();
    await expect(writeExternalInboxMessage({ db, message, ...policy })).rejects.toThrow('INBOX_CAPTURE_START_INVALID');
    await expect(writeExternalInboxMessage({ db, message, ...policy, captureStartAtMs: NOW })).rejects.toThrow('INBOX_CAPTURE_START_INVALID');
    expect(db.__stats.reads).toBe(0);
    expect(db.__dump()).toEqual({});
  });
});

describe('expired-cache cleanup is a pure narrow plan, not an enabled deletion job', () => {
  it('only selects expired canonical IDs from the new message collection and never executes', () => {
    const prepared = prepareExternalInboxMessage(message, policy);
    const documents = [{ id: prepared.docId, data: prepared.data }];
    const result = planExpiredExternalInboxCleanup([
      ...documents, ...documents,
      { id: 'charter_inquiries/private', data: prepared.data },
      { id: prepared.docId, data: { ...prepared.data, channel: 'booking' } },
    ], { nowMs: prepared.data.expiresAtMs });
    expect(result).toEqual({ collection: 'external_inbox_messages', docIds: [prepared.docId], executed: false });
    expect(planExpiredExternalInboxCleanup(documents, { nowMs: NOW }).docIds).toEqual([]);
    expect(documents[0].data).toEqual(prepared.data);
  });
  it('bounds each plan and rejects broad or invalid policy', () => {
    const documents = [1, 2].map(id => {
      const prepared = prepareExternalInboxMessage({ ...message, providerMessageId: String(id) }, policy);
      return { id: prepared.docId, data: prepared.data };
    });
    expect(planExpiredExternalInboxCleanup(documents, { nowMs: NOW + 8 * DAY, limit: 1 }).docIds).toHaveLength(1);
    expect(() => planExpiredExternalInboxCleanup(documents, { nowMs: NOW, limit: 101 })).toThrow();
  });
});
