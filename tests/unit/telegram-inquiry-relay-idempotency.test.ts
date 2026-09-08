import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
const mocks = vi.hoisted(() => ({ database: vi.fn(), translate: vi.fn(), send: vi.fn() }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: mocks.database }));
vi.mock('../../api/_shared/translator.js', () => ({ translate: mocks.translate }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => ({ syntheticTimestamp: true }) } }));
vi.mock('../../api/_shared/telegram-bot.js', async () => ({
  ...await vi.importActual('../../api/_shared/telegram-bot.js'), sendBotMessage: mocks.send,
}));
import { relayAdminReply, confirmAdminReply } from '../../api/_shared/chat-relay.js';
import { TELEGRAM_REPLY_RECEIPTS, telegramReplyIdentity, sendTelegramReplyConfirmation } from '../../api/_shared/telegram-reply-delivery.js';
import inquiryWebhook from '../../api/telegram-webhook-inquiry.js';

const input = { botNamespace: 'inquiry:12345', updateId: 100, replyToMessageId: 50, text: 'Synthetic reply', adminName: 'Synthetic operator' };
const identity = telegramReplyIdentity(input);
const receiptPath = `${TELEGRAM_REPLY_RECEIPTS}/${identity.id}`;
const mapSeed = { 'inquiry_messages/50': { sessionId: 'synthetic-session', language: 'ko' } };
let db: ReturnType<typeof createFakeFirestore>;
const messages = () => Object.entries(db.__dump()).filter(([path]) => path.startsWith('chat_sessions/') && path.includes('/messages/'));
const confirm = (args = input) => confirmAdminReply({ ...args, send: mocks.send });
function request(updateId: unknown = 100) {
  return { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'synthetic-webhook-secret' },
    body: { update_id: updateId, message: { message_id: 101, chat: { id: -999 }, from: { first_name: 'Synthetic operator' },
      text: input.text, reply_to_message: { message_id: 50 } } } };
}
function response() {
  const res = { statusCode: 0, body: {} as Record<string, unknown>, status(code: number) { this.statusCode = code; return this; },
    json(body: Record<string, unknown>) { this.body = body; return this; } };
  return res;
}
async function invoke(req = request()) { const res = response(); await inquiryWebhook(req, res); return res; }

beforeEach(() => {
  db = createFakeFirestore(mapSeed);
  mocks.database.mockReset().mockImplementation(() => db);
  mocks.translate.mockReset().mockResolvedValue('Synthetic translation');
  mocks.send.mockReset().mockResolvedValue({ ok: true, result: { message_id: 900 } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('REAL_NETWORK_FORBIDDEN'); }));
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'synthetic-webhook-secret');
  vi.stubEnv('TELEGRAM_INQUIRY_BOT_TOKEN', '12345:synthetic-token');
  vi.stubEnv('TELEGRAM_CHAT_ID', '-999');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('one web reply per bot and Telegram update', () => {
  it('uses bot namespace plus update_id, not the reply target or text, as its key', () => {
    expect(identity.id).toMatch(/^[a-f0-9]{64}$/);
    expect(telegramReplyIdentity({ ...input, text: 'different' }).id).toBe(identity.id);
    expect(telegramReplyIdentity({ ...input, replyToMessageId: 51 }).id).toBe(identity.id);
    expect(telegramReplyIdentity({ ...input, updateId: 101 }).id).not.toBe(identity.id);
    expect(telegramReplyIdentity({ ...input, botNamespace: 'admin:12345' }).id).not.toBe(identity.id);
    expect(telegramReplyIdentity({ ...input, botNamespace: 'inquiry:67890' }).id).not.toBe(identity.id);
    expect(telegramReplyIdentity({ ...input, updateId: 0 }).id).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([undefined, -1, 0.1, NaN, Number.MAX_SAFE_INTEGER + 1, '100'])('rejects invalid update_id %s before DB or translation', async updateId => {
    await expect(relayAdminReply({ ...input, updateId })).rejects.toThrow('RELAY_INPUT_INVALID');
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.translate).not.toHaveBeenCalled();
  });
  it('replays a completed update without a new message, translation, or session timestamp', async () => {
    expect(await relayAdminReply(input)).toMatchObject({ relayed: true, duplicate: false });
    const before = db.__dump();
    expect(await relayAdminReply(input)).toMatchObject({ relayed: true, duplicate: true });
    expect(db.__dump()).toEqual(before); expect(messages()).toHaveLength(1);
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it('preserves two legitimate replies to the same original inquiry', async () => {
    await relayAdminReply(input);
    await relayAdminReply({ ...input, updateId: 101, text: 'Second legitimate reply' });
    expect(messages()).toHaveLength(2);
  });
  it('separates a new bot namespace sharing the same update_id', async () => {
    await relayAdminReply(input);
    await relayAdminReply({ ...input, botNamespace: 'inquiry:67890' });
    expect(messages()).toHaveLength(2);
  });
  it('concurrent duplicate commits one message and one session-head update', async () => {
    const barrier = makeBarrier(2);
    db.__beforeCommit = async ({ attempt }: { attempt: number }) => { if (attempt === 1) await barrier.wait(); };
    const results = await Promise.all([relayAdminReply(input), relayAdminReply(input)]);
    expect(results.filter(result => result.duplicate)).toHaveLength(1);
    expect(messages()).toHaveLength(1);
    expect(db.__version('chat_sessions/synthetic-session')).toBe(1);
    expect(db.__stats.retries).toBe(1);
  });
  it('failure before commit writes neither message, receipt nor session, then retry succeeds', async () => {
    db.__beforeCommit = async () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); };
    await expect(relayAdminReply(input)).rejects.toThrow();
    expect(db.__dump()).toEqual(mapSeed);
    db.__beforeCommit = null;
    expect((await relayAdminReply(input)).relayed).toBe(true); expect(messages()).toHaveLength(1);
  });
  it('committed-but-timeout retry reuses the receipt instead of adding a second message', async () => {
    const original = db.runTransaction.bind(db);
    let first = true;
    db.runTransaction = async callback => {
      const result = await original(callback);
      if (first) { first = false; throw new Error('COMMIT_RESPONSE_LOST'); }
      return result;
    };
    await expect(relayAdminReply(input)).rejects.toThrow('COMMIT_RESPONSE_LOST');
    expect((await relayAdminReply(input)).duplicate).toBe(true); expect(messages()).toHaveLength(1);
  });
  it('same update with changed text or reply target fails closed instead of overwriting or rerouting', async () => {
    await relayAdminReply(input);
    const before = db.__dump();
    await expect(relayAdminReply({ ...input, text: 'mutated' })).rejects.toThrow('RELAY_RECEIPT_CONFLICT');
    await expect(relayAdminReply({ ...input, replyToMessageId: 51 })).rejects.toThrow('RELAY_RECEIPT_CONFLICT');
    expect(db.__dump()).toEqual(before);
  });
  it('no mapping is not reported as customer delivery and a later mapping can still retry', async () => {
    db.__delete('inquiry_messages/50');
    expect(await relayAdminReply(input)).toEqual({ relayed: false }); expect(messages()).toHaveLength(0);
    db.__set('inquiry_messages/50', mapSeed['inquiry_messages/50']);
    expect((await relayAdminReply(input)).relayed).toBe(true);
  });
  it('translation is preserved and a changed mapping during translation cannot silently reroute', async () => {
    db.__set('inquiry_messages/50', { sessionId: 'synthetic-session', language: 'en' });
    mocks.translate.mockImplementation(async () => {
      db.__set('inquiry_messages/50', { sessionId: 'different-session', language: 'en' });
      return 'Synthetic translation';
    });
    await expect(relayAdminReply(input)).rejects.toThrow('RELAY_MAPPING_CHANGED');
    expect(messages()).toHaveLength(0);
  });
  it('translation failure retains existing Korean fallback without logging the exception content', async () => {
    db.__set('inquiry_messages/50', { sessionId: 'synthetic-session', language: 'ja' });
    mocks.translate.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_ERROR'));
    expect(await relayAdminReply(input)).toMatchObject({ translationFailed: true, translated: false, targetLang: 'ja' });
    expect(messages()[0][1]).toMatchObject({ text: input.text, translationFailed: true, language: 'ja' });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('SYNTHETIC_PRIVATE_ERROR');
  });
  it('transaction merge preserves existing customer owner-notification metadata', async () => {
    db.__set('chat_sessions/synthetic-session', { ownerNotificationEligible: true, ownerNotificationAt: 'synthetic-existing-time' });
    await relayAdminReply(input);
    expect(db.__get('chat_sessions/synthetic-session')).toMatchObject({ ownerNotificationEligible: true, ownerNotificationAt: 'synthetic-existing-time' });
  });
  it('missing DB is retryable, not a misleading missing-mapping result', async () => {
    mocks.database.mockReturnValue(null);
    await expect(relayAdminReply(input)).rejects.toThrow('RELAY_DATABASE_UNAVAILABLE');
  });
  it('keeps the legacy main-bot caller working without inventing a reply-target dedupe key', async () => {
    const legacy = { replyToMessageId: 50, text: 'Legacy reply', adminName: 'Operator' };
    expect((await relayAdminReply(legacy)).relayed).toBe(true);
    expect((await relayAdminReply(legacy)).relayed).toBe(true);
    expect(messages()).toHaveLength(2);
    expect(Object.keys(db.__dump()).some(path => path.startsWith(TELEGRAM_REPLY_RECEIPTS))).toBe(false);
  });
});

describe('Telegram optional confirmation and partial-send ambiguity', () => {
  beforeEach(async () => { await relayAdminReply(input); });
  it('two concurrent confirmation attempts send once and later retries never resend', async () => {
    const barrier = makeBarrier(2);
    db.__beforeCommit = async ({ attempt }: { attempt: number }) => {
      if (attempt === 1 && db.__get(receiptPath).confirmation === 'pending') await barrier.wait();
    };
    await Promise.all([confirm(), confirm()]);
    db.__beforeCommit = null;
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(await confirm()).toEqual({ status: 'sent', retry: false });
    expect(mocks.send).toHaveBeenCalledTimes(1); expect(messages()).toHaveLength(1);
  });
  it('a known provider rejection retries the notice only, never the customer web message', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Telegram sendMessage failed: Too Many Requests'));
    expect(await confirm()).toEqual({ status: 'pending', retry: true });
    expect((await relayAdminReply(input)).duplicate).toBe(true);
    expect(await confirm()).toEqual({ status: 'sent', retry: false });
    expect(mocks.send).toHaveBeenCalledTimes(2); expect(messages()).toHaveLength(1);
  });
  it('known rejection retries are bounded at three attempts', async () => {
    mocks.send.mockRejectedValue(new Error('Telegram sendMessage failed: Forbidden'));
    await confirm(); await confirm();
    expect(await confirm()).toEqual({ status: 'failed', retry: false });
    expect(await confirm()).toEqual({ status: 'failed', retry: false });
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });
  it('network timeout after possible acceptance records uncertainty and never blindly resends', async () => {
    mocks.send.mockRejectedValue(new Error('ETIMEDOUT SYNTHETIC_PRIVATE_ERROR'));
    expect(await confirm()).toEqual({ status: 'uncertain', retry: false });
    expect(await confirm()).toEqual({ status: 'uncertain', retry: false });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.__dump())).not.toContain('SYNTHETIC_PRIVATE_ERROR');
  });
  it('claim failure before commit allows retry without attempting a send', async () => {
    db.__beforeCommit = async () => { throw new Error('synthetic DB failure'); };
    await expect(confirm()).rejects.toThrow(); expect(mocks.send).not.toHaveBeenCalled();
    db.__beforeCommit = null;
    expect(await confirm()).toEqual({ status: 'sent', retry: false });
  });
  it('claim committed with response lost leaves uncertain, not a blindly reclaimable send lease', async () => {
    const original = db.runTransaction.bind(db);
    let first = true;
    db.runTransaction = async callback => {
      const result = await original(callback);
      if (first) { first = false; throw new Error('CLAIM_RESPONSE_LOST'); }
      return result;
    };
    await expect(confirm()).rejects.toThrow(); expect(mocks.send).not.toHaveBeenCalled();
    expect(await confirm()).toEqual({ status: 'uncertain', retry: false });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('send succeeded but receipt-finalization failure cannot trigger a duplicate send', async () => {
    let calls = 0;
    db.__beforeCommit = async () => { calls++; if (calls === 2) throw new Error('FINALIZE_RESPONSE_LOST'); };
    await expect(confirm()).rejects.toThrow();
    db.__beforeCommit = null;
    expect(await confirm()).toEqual({ status: 'uncertain', retry: false });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('bad persisted confirmation state is not reset to a new send', async () => {
    db.__patch(receiptPath, { confirmation: 'unknown-new-state' });
    await expect(confirm()).rejects.toThrow('RELAY_RECEIPT_CONFLICT'); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('a forged successful value without provider ok:true is not marked sent', async () => {
    mocks.send.mockResolvedValue(undefined);
    expect(await sendTelegramReplyConfirmation({ db, identity, send: mocks.send, timestamp: () => 'synthetic' })).toEqual({ status: 'uncertain', retry: false });
  });
});

describe('inquiry webhook auth, idempotency input and retry status', () => {
  it('valid duplicate webhook yields one web message and one confirmation', async () => {
    expect((await invoke()).statusCode).toBe(200);
    expect((await invoke()).statusCode).toBe(200);
    expect(messages()).toHaveLength(1); expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, -1, '100', 1.2])('missing/invalid update_id %s cannot fall back to the non-idempotent caller', async updateId => {
    const req = request(); req.body.update_id = updateId;
    expect((await invoke(req)).statusCode).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('DB failure returns 503 and fixed text without acknowledging permanent success', async () => {
    mocks.database.mockImplementation(() => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); });
    const result = await invoke(); expect(result.statusCode).toBe(503);
    expect(result.body).toEqual({ ok: false, error: 'INQUIRY_RETRY' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('SYNTHETIC_PRIVATE_ERROR');
  });
  it('confirmed provider rejection returns retry status but the next update retry preserves one web reply', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Telegram sendMessage failed: rate limited'));
    expect((await invoke()).statusCode).toBe(503);
    expect((await invoke()).statusCode).toBe(200);
    expect(messages()).toHaveLength(1); expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it('external send ambiguity is reported honestly, without retrying the customer message', async () => {
    mocks.send.mockRejectedValueOnce(new Error('socket closed after possible send'));
    expect((await invoke()).body).toEqual({ ok: true, confirmation: 'uncertain' });
    expect((await invoke()).body).toEqual({ ok: true, confirmation: 'uncertain' });
    expect(messages()).toHaveLength(1); expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('preserves the existing secret and pinned-admin chat gates with DB/send zero', async () => {
    const wrongSecret = request(); wrongSecret.headers['x-telegram-bot-api-secret-token'] = 'wrong';
    expect((await invoke(wrongSecret)).statusCode).toBe(401);
    const wrongChat = request(); wrongChat.body.message.chat.id = -998;
    expect((await invoke(wrongChat)).statusCode).toBe(200);
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    expect((await invoke()).statusCode).toBe(200);
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
});
