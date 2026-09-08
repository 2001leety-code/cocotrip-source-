import { describe, expect, it } from 'vitest';
import { adminWebchatInboxCopy } from '../../src/lib/adminWebchatInboxCopy';
import { isWebchatDetail, isWebchatOverview, isWebchatReply } from '../../src/lib/adminWebchatInboxContract';

const session = { sessionId: 'sess_synthetic_owner_preview_0_chat', lastMessageAtMs: Date.now() - 60_000, lastMessageFrom: 'customer', ownerType: 'guest', language: null };
const message = { id: 'synthetic_message', ts: session.lastMessageAtMs, from: 'customer', text: '<b>untrusted</b>', truncated: false, language: null };
const overview = () => ({ generatedAtMs: Date.now(), sessions: [{ ...session }], possiblyTruncated: false });
const detail = () => ({ generatedAtMs: Date.now(), session: { ...session }, messages: [{ ...message }], messagesPossiblyTruncated: false });
describe('webchat display contract', () => {
  it('provides every copy key and channel language in all four languages', () => {
    for (const copy of Object.values(adminWebchatInboxCopy)) {
      expect(Object.keys(copy).sort()).toEqual(Object.keys(adminWebchatInboxCopy.ko).sort());
      expect(Object.keys(copy.languageLabels).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
      for (const value of Object.values(copy)) if (typeof value === 'string') expect(value.trim()).not.toBe('');
    }
    expect(adminWebchatInboxCopy.ko.confirmSend).toBe('고객에게 보내기');
    expect(adminWebchatInboxCopy.en.saved).toContain('not confirmed');
    expect(adminWebchatInboxCopy.en.replyHint).toContain('No automatic translation');
  });
  it('accepts explicit unknown language and valid bounded lists', () => {
    expect(isWebchatOverview(overview())).toBe(true);
    expect(isWebchatDetail(detail())).toBe(true);
    expect(isWebchatOverview({ ...overview(), sessions: [] })).toBe(true);
  });
  it.each([0, -1, NaN, Infinity, 1.1, Date.now() + 86_400_000, '1000'])('rejects bad time %s', time => {
    expect(isWebchatOverview({ ...overview(), generatedAtMs: time })).toBe(false);
    expect(isWebchatDetail({ ...detail(), messages: [{ ...message, ts: time }] })).toBe(false);
  });
  it.each(['ko-KR', undefined, ['ko'], { toString: () => 'en' }])('rejects invalid language without coercion', language => {
    expect(isWebchatOverview({ ...overview(), sessions: [{ ...session, language }] })).toBe(false);
    expect(isWebchatDetail({ ...detail(), messages: [{ ...message, language }] })).toBe(false);
  });
  it('rejects duplicate identities, oversized lists, wrong owners and unsorted messages', () => {
    expect(isWebchatOverview({ ...overview(), sessions: [session, session] })).toBe(false);
    expect(isWebchatOverview({ ...overview(), sessions: Array(51).fill(session) })).toBe(false);
    expect(isWebchatOverview({ ...overview(), sessions: [{ ...session, ownerType: ['guest'] }] })).toBe(false);
    expect(isWebchatOverview({ ...overview(), sessions: [{ ...session, sessionId: '../other' }] })).toBe(false);
    expect(isWebchatDetail({ ...detail(), messages: [message, message] })).toBe(false);
    expect(isWebchatDetail({ ...detail(), messages: [message, { ...message, id: 'older', ts: message.ts - 1 }] })).toBe(false);
    expect(isWebchatDetail({ ...detail(), messages: [{ ...message, from: ['admin'] }] })).toBe(false);
  });
  it('only recognizes a matching admin storage receipt, not a generic success flag', () => {
    const response = { session: { ...session, lastMessageFrom: 'admin' }, requestId: '12345678-1234-4123-8123-123456789abc', translated: false, message: { ...message, from: 'admin' } };
    expect(isWebchatReply(response)).toBe(true);
    expect(isWebchatReply({ ...response, translated: true })).toBe(false);
    expect(isWebchatReply({ ...response, requestId: 'bad' })).toBe(false);
    expect(isWebchatReply({ ...response, message: { ...response.message, ts: message.ts + 1 } })).toBe(false);
    expect(isWebchatReply({ ok: true })).toBe(false);
  });
});
