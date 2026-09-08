import { describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
import {
  WEBCHAT_REPLY_RECEIPTS,
  commitAdminWebchatReply,
  listAdminWebchatSessions,
  parseAdminWebchatReply,
  publicWebchatMessage,
  publicWebchatSession,
  readAdminWebchatDetail,
  validWebchatSession,
} from '../../api/_shared/adminWebchatInbox.js';

const NOW = Date.parse('2026-09-08T10:00:00Z');
const ID = 'sess_abcdefghijklmnopqrstuvwxyz012345';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const input = (extra: Record<string, unknown> = {}) => ({ sessionId: ID, requestId: REQUEST_ID,
  text: '원문\n그대로', expectedLastMessageAtMs: NOW - 10, ...extra });
const session = (extra: Record<string, unknown> = {}) => ({ ownerType: 'user', ownerUid: 'customer-uid',
  language: 'ko', lastMessageAt: new Date(NOW - 10), lastMessageFrom: 'customer', ...extra });
const sessionPath = `chat_sessions/${ID}`;
const replyMessages = (db: ReturnType<typeof createFakeFirestore>) => Object.entries(db.__dump())
  .filter(([path]) => path.startsWith(`${sessionPath}/messages/`));

describe('admin webchat inbox privacy shapes', () => {
  it('allows only server-compatible owner records and returns no owner identifier', () => {
    expect(validWebchatSession(ID, { ownerType: 'guest', ownerFingerprint: 'a'.repeat(32) })).toBe(true);
    expect(validWebchatSession(ID, { ownerType: 'guest', ownerFingerprint: 'A'.repeat(32) })).toBe(false);
    expect(validWebchatSession(ID, { ownerType: 'user', ownerUid: '   ' })).toBe(false);
    expect(validWebchatSession(ID, { ownerType: 'user', ownerUid: `user\u0000id` })).toBe(false);
    expect(validWebchatSession(ID, { ownerType: 'user', ownerUid: 'x'.repeat(129) })).toBe(false);
    const visible = publicWebchatSession(ID, session({ lastMessageAtMs: 1 }), NOW);
    expect(visible).toMatchObject({ ownerType: 'user', lastMessageAtMs: NOW - 10 });
    expect(JSON.stringify(visible)).not.toContain('customer-uid');
  });

  it('uses canonical server timestamp rather than a stale auxiliary millisecond field', () => {
    const visible = publicWebchatSession(ID, session({ lastMessageAt: new Date(NOW), lastMessageAtMs: NOW - 999_999 }), NOW);
    expect(visible?.lastMessageAtMs).toBe(NOW);
    expect(publicWebchatSession(ID, session({ lastMessageAt: new Date(NOW + 300_001) }), NOW)).toBeNull();
    expect(publicWebchatMessage('m1', { from: 'customer', text: `safe\u007ftext`, ts: new Date(NOW) }, NOW))
      .toMatchObject({ text: 'safetext', truncated: true });
    expect(publicWebchatMessage('m1', { from: 'customer', text: 'x', ts: new Date(NOW + 300_001) }, NOW)).toBeNull();
  });

  it('rejects broadened, non-JSON-shaped, or oversized reply fields without normalizing them', () => {
    expect(parseAdminWebchatReply(input())).toMatchObject({ text: '원문\n그대로' });
    expect(parseAdminWebchatReply({ ...input(), ignored: true })).toBeNull();
    expect(parseAdminWebchatReply({ ...input(), text: 'x'.repeat(4001) })).toBeNull();
    expect(parseAdminWebchatReply({ ...input(), text: 'x\u0000' })).toBeNull();
    expect(parseAdminWebchatReply([input()])).toBeNull();
  });
});

describe('admin webchat inbox reads are bounded and honest about withheld rows', () => {
  it('times out a single read at three seconds rather than holding the request open', async () => {
    vi.useFakeTimers();
    const query = { orderBy: () => query, limit: () => query, get: () => new Promise(() => {}) };
    const result = listAdminWebchatSessions({ collection: () => query }, NOW);
    const timeout = expect(result).rejects.toThrow('WEBCHAT_READ_TIMEOUT');
    await vi.advanceTimersByTimeAsync(3_001); await timeout;
    vi.useRealTimers();
  });

  it('uses 51st rows as a truncation boundary and does not call a legacy-only zero list complete', async () => {
    const many: Record<string, unknown> = {};
    for (let index = 0; index < 51; index += 1) {
      const suffix = String(index).padStart(24, '0');
      many[`chat_sessions/sess_${suffix}`] = { ...session(), lastMessageAt: new Date(NOW - index) };
    }
    const db = createFakeFirestore(many);
    const listed = await listAdminWebchatSessions(db, NOW);
    expect(listed.sessions).toHaveLength(50); expect(listed.possiblyTruncated).toBe(true);
    expect(listed.sessions[0]?.lastMessageAtMs).toBe(NOW);

    const legacy = createFakeFirestore({ 'chat_sessions/sess_legacylegacylegacylegacy': { lastMessageAt: new Date(NOW) } });
    const hidden = await listAdminWebchatSessions(legacy, NOW);
    expect(hidden.sessions).toEqual([]); expect(hidden.possiblyTruncated).toBe(true);
  });

  it('withholds malformed messages and marks a detail as possibly truncated', async () => {
    const db = createFakeFirestore({ [sessionPath]: session(),
      [`${sessionPath}/messages/valid`]: { from: 'customer', text: 'hello', ts: new Date(NOW - 5) },
      [`${sessionPath}/messages/bad`]: { from: 'intruder', text: 'private', ts: new Date(NOW - 4) },
      [`${sessionPath}/messages/future`]: { from: 'customer', text: 'private', ts: new Date(NOW + 300_001) } });
    const result = await readAdminWebchatDetail(db, ID, NOW);
    expect(result).toMatchObject({ ok: true, data: { messagesPossiblyTruncated: true } });
    expect(result.data.messages).toEqual([expect.objectContaining({ id: 'valid', text: 'hello' })]);
  });
});

describe('admin webchat replies are receipt-idempotent and fail closed', () => {
  it('commits one message for concurrent identical requests and replays before stale checking', async () => {
    const db = createFakeFirestore({ [sessionPath]: session() });
    const barrier = makeBarrier(2);
    db.__beforeCommit = async ({ attempt }: { attempt: number }) => { if (attempt === 1) await barrier.wait(); };
    const results = await Promise.all([commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW }),
      commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW })]);
    expect(results.filter(result => result.ok && result.replay).length).toBe(1);
    expect(replyMessages(db)).toHaveLength(1); expect(db.__stats.retries).toBeGreaterThan(0);

    db.__patch(sessionPath, { lastMessageAt: new Date(NOW + 1), lastMessageFrom: 'customer' });
    const replay = await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW + 2 });
    expect(replay).toMatchObject({ ok: true, replay: true }); expect(replyMessages(db)).toHaveLength(1);
  });

  it('keeps expected timestamp and text in the receipt fingerprint, and rejects stale threads', async () => {
    const db = createFakeFirestore({ [sessionPath]: session() });
    expect((await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW })).ok).toBe(true);
    expect(await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input({ text: 'changed' }), nowMs: NOW + 1 }))
      .toEqual({ code: 'REQUEST_CONFLICT' });
    expect(await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input({ expectedLastMessageAtMs: NOW - 9 }), nowMs: NOW + 1 }))
      .toEqual({ code: 'REQUEST_CONFLICT' });
    const another = input({ requestId: '223e4567-e89b-42d3-a456-426614174000', expectedLastMessageAtMs: NOW - 10 });
    expect(await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: another, nowMs: NOW + 1 }))
      .toEqual({ code: 'STALE_THREAD' });
    expect(await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input({ requestId: '323e4567-e89b-42d3-a456-426614174000', expectedLastMessageAtMs: NOW + 300_002 }), nowMs: NOW + 1 }))
      .toEqual({ code: 'INVALID_REQUEST' });
  });

  it('does not write on a failed transaction and recovers an applied commit whose response was lost', async () => {
    const db = createFakeFirestore({ [sessionPath]: session() });
    const before = db.__dump();
    db.__beforeCommit = async () => { throw new Error('SYNTHETIC_DB_FAILURE'); };
    await expect(commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW })).rejects.toThrow();
    expect(db.__dump()).toEqual(before);

    db.__beforeCommit = null;
    const original = db.runTransaction.bind(db);
    let first = true;
    db.runTransaction = async callback => {
      const result = await original(callback);
      if (first) { first = false; throw new Error('COMMIT_RESPONSE_LOST'); }
      return result;
    };
    await expect(commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW })).rejects.toThrow('COMMIT_RESPONSE_LOST');
    expect(await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW + 1 }))
      .toMatchObject({ ok: true, replay: true });
    expect(replyMessages(db)).toHaveLength(1);
    const stored = db.__dump();
    expect(stored[sessionPath]).not.toHaveProperty('lastMessageAtMs');
    expect(stored[replyMessages(db)[0][0]].ts).toBeInstanceOf(Date);
    expect(stored[replyMessages(db)[0][0]]).not.toHaveProperty('tsMs');
  });

  it('never trusts a malformed stored receipt as a completed delivery', async () => {
    const db = createFakeFirestore({ [sessionPath]: session() });
    await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW });
    db.__patch(`${WEBCHAT_REPLY_RECEIPTS}/${REQUEST_ID}`, { response: { requestId: REQUEST_ID } });
    expect(await commitAdminWebchatReply({ db, actorUid: 'admin-uid', input: input(), nowMs: NOW + 1 }))
      .toEqual({ code: 'REQUEST_CONFLICT' });
    expect(replyMessages(db)).toHaveLength(1);
  });
});
