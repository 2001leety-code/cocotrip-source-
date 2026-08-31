/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore transaction test scaffolding. */
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  automaticInquiryAckEligibility,
  automaticallyAcknowledgeInquiry,
  AUTO_ACK_DELIVERY_CLAIM_MS,
  recoverStaleAutomaticInquiryAck,
  retryAutomaticInquiryAck,
} from '../../api/_shared/inquiry-auto-ack.js';
import {
  INQUIRY_AUTO_ACK_ELIGIBILITY_VERSION,
  INQUIRY_SUBMISSION_PROVENANCE,
} from '../../api/_shared/inquiry-auto-ack-constants.js';
import { approveAndSendInquiryResponse } from '../../api/_shared/inquiry-response-delivery.js';

type StoredDocs = Map<string, Record<string, any>>;
type Ref = { id: string; key: string };

const NOW = Date.UTC(2026, 7, 31, 6, 0, 0, 0);
const OPTIONS = {
  gateEnabled: true,
  activationAtMs: NOW - 60_000,
  maxAgeMs: 30 * 60 * 1000,
  dailyCap: 20,
  now: NOW,
};

function fakeDb(
  initial: Record<string, Record<string, any>>,
  options: { failTransactions?: boolean; failTransactionCalls?: number[] } = {},
) {
  const docs: StoredDocs = new Map(Object.entries(initial).map(([id, value]) => [id, structuredClone(value)]));
  const refFor = (collection: string, id: string): Ref => ({
    id,
    key: collection === 'charter_inquiries' ? id : `${collection}/${id}`,
  });
  let transactionQueue = Promise.resolve();
  let transactionCall = 0;
  const db = {
    collection: vi.fn((collection: string) => ({ doc: (id: string) => refFor(collection, id) })),
    runTransaction: (fn: any) => {
      const run = transactionQueue.then(async () => {
        transactionCall += 1;
        if (options.failTransactions || options.failTransactionCalls?.includes(transactionCall)) {
          throw new Error('Firestore unavailable');
        }
        const writes: Array<{ kind: 'update' | 'set'; ref: Ref; patch: Record<string, any>; merge?: boolean }> = [];
        const tx = {
          get: async (ref: Ref) => ({
            exists: docs.has(ref.key),
            data: () => structuredClone(docs.get(ref.key) || {}),
          }),
          update: (ref: Ref, patch: Record<string, any>) => writes.push({ kind: 'update', ref, patch }),
          set: (ref: Ref, patch: Record<string, any>, setOptions?: { merge?: boolean }) => {
            writes.push({ kind: 'set', ref, patch, merge: setOptions?.merge === true });
          },
        };
        const result = await fn(tx);
        for (const write of writes) {
          const previous = docs.get(write.ref.key) || {};
          docs.set(write.ref.key, write.kind === 'update' || write.merge
            ? { ...previous, ...structuredClone(write.patch) }
            : structuredClone(write.patch));
        }
        return result;
      });
      transactionQueue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db: db as any, docs };
}

function inquiry(extra: Record<string, any> = {}) {
  return {
    vehicle: 'tour_custom',
    language: 'en',
    email: 'stored@example.com',
    details: 'Please help with a local itinerary and tell me the price.',
    status: 'NEW',
    createdAt: Timestamp.fromMillis(NOW - 1_000),
    contractVersion: 'inquiry.v1',
    source: 'tour_custom_modal',
    submissionProvenance: INQUIRY_SUBMISSION_PROVENANCE,
    autoAckEligibilityVersion: INQUIRY_AUTO_ACK_ELIGIBILITY_VERSION,
    rateLimitVerifiedForAutoAck: true,
    recipientVerifiedForAutoAck: true,
    autoAckCandidate: true,
    responseWorkflow: {
      draftStatus: 'ready',
      draftRevision: 2,
      draftSubject: 'Operator draft subject',
      draftBody: 'This operator-reviewed final response is separate from the automatic receipt.',
      deliveryStatus: 'not_sent',
    },
    ...extra,
  };
}

describe('inquiry automatic receipt safety', () => {
  it('supports a real Admin Timestamp, sends the exact policy receipt, and reserves both caps atomically', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    const send = vi.fn(async () => ({ messageId: 'provider-auto-1' }));
    expect(automaticInquiryAckEligibility(inquiry(), OPTIONS).code).toBe('AUTO_ACK_ELIGIBLE');

    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send });

    expect(result.code).toBe('SENT');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      to: 'stored@example.com',
      subject: 'We received your CocoTrip inquiry',
    });
    expect(send.mock.calls[0][0].text).toContain('automatic confirmation');
    expect(send.mock.calls[0][0].text).toContain('pricing question was also received');
    expect(send.mock.calls[0][0].text).not.toMatch(/[$₩¥€]\s*\d/);
    expect(docs.get('inquiry1')).toMatchObject({
      status: 'NEW',
      responseWorkflow: { deliveryStatus: 'not_sent' },
      ackWorkflow: {
        deliveryStatus: 'sent',
        deliveryAttempts: 1,
        policyVersion: 'inquiry-auto-ack.policy.v1',
      },
    });
    expect(docs.get('inquiry_auto_ack_limits/2026-08-31')).toMatchObject({ count: 1, configuredCap: 20 });
    const recipientReservations = [...docs.entries()]
      .filter(([key]) => key.startsWith('inquiry_auto_ack_recipients/'));
    expect(recipientReservations).toHaveLength(1);
    expect(recipientReservations[0][1]).toEqual({ day: '2026-08-31', reservedAtMs: NOW });
  });

  it('keeps the inquiry open so an operator can send the final response exactly once afterward', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    await automaticallyAcknowledgeInquiry(db, 'inquiry1', {
      ...OPTIONS,
      send: vi.fn(async () => ({ messageId: 'ack-1' })),
    });
    const finalSend = vi.fn(async () => ({ messageId: 'final-1' }));
    const final = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Operator approved subject',
      body: 'This is the final quotation response reviewed by the operator before sending.',
      approvedBy: 'admin@example.com',
      now: NOW + 1_000,
      send: finalSend,
    });
    const duplicate = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Operator approved subject',
      body: 'This is the final quotation response reviewed by the operator before sending.',
      approvedBy: 'admin@example.com',
      now: NOW + 2_000,
      send: finalSend,
    });

    expect(final.code).toBe('SENT');
    expect(duplicate.code).toBe('ALREADY_SENT');
    expect(finalSend).toHaveBeenCalledOnce();
    expect(docs.get('inquiry1')).toMatchObject({
      status: 'responded',
      ackWorkflow: { deliveryStatus: 'sent' },
      responseWorkflow: { deliveryStatus: 'sent' },
    });
  });

  it('allows only one concurrent claim and therefore one SMTP handoff', async () => {
    const { db } = fakeDb({ inquiry1: inquiry() });
    const send = vi.fn(async () => ({ messageId: 'only-once' }));
    const results = await Promise.all([
      automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send }),
      automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send }),
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(results.some(result => result.code === 'SENT')).toBe(true);
    expect(results.some(result => ['SEND_IN_PROGRESS', 'ALREADY_ACKNOWLEDGED'].includes(result.code))).toBe(true);
  });

  it.each([
    ['kill switch off', inquiry(), { ...OPTIONS, gateEnabled: false }],
    ['activation missing', inquiry(), { ...OPTIONS, activationAtMs: Number.NaN }],
    ['old backlog', inquiry({ createdAt: Timestamp.fromMillis(NOW - 31 * 60 * 1000) }), OPTIONS],
    ['future over one minute', inquiry({ createdAt: Timestamp.fromMillis(NOW + 60_001) }), OPTIONS],
    ['legacy numeric timestamp', inquiry({ createdAt: NOW - 1_000 }), OPTIONS],
    ['legacy number string timestamp', inquiry({ createdAt: String(NOW - 1_000) }), OPTIONS],
    ['unknown type', inquiry({ vehicle: 'limousine' }), OPTIONS],
    ['unsupported language', inquiry({ language: 'fr' }), OPTIONS],
    ['wrong contract', inquiry({ contractVersion: 'inquiry.v2' }), OPTIONS],
    ['wrong source', inquiry({ source: 'charter_wizard' }), OPTIONS],
    ['missing provenance', inquiry({ submissionProvenance: null }), OPTIONS],
    ['wrong eligibility version', inquiry({ autoAckEligibilityVersion: 'forged' }), OPTIONS],
    ['rate limiter degraded', inquiry({ rateLimitVerifiedForAutoAck: false }), OPTIONS],
    ['recipient email not verified', inquiry({ recipientVerifiedForAutoAck: false }), OPTIONS],
    ['not selected by the server queue', inquiry({ autoAckCandidate: false }), OPTIONS],
    ['invalid email', inquiry({ email: 'not-an-email' }), OPTIONS],
    ['closed inquiry', inquiry({ status: 'closed' }), OPTIONS],
    ['invalid daily cap', inquiry(), { ...OPTIONS, dailyCap: 0 }],
  ])('fails closed without SMTP: %s', async (_label, data, options) => {
    const { db } = fakeDb({ inquiry1: data });
    const send = vi.fn();
    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...options, send });
    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not trust a legacy anonymous Firestore pending document', async () => {
    const legacy = {
      email: 'victim@example.com',
      status: 'pending',
      createdAt: Timestamp.fromMillis(NOW - 1_000),
      notes: 'legacy direct write',
    };
    const { db } = fakeDb({ legacy });
    const send = vi.fn();
    const result = await automaticallyAcknowledgeInquiry(db, 'legacy', { ...OPTIONS, send });
    expect(result.code).toBe('AUTO_ACK_NOT_CANDIDATE');
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    'victim@example.com,other@example.com',
    'Name<a@example.com>',
    'a@b.com\r\nBcc:x@y.com',
    'a@@b.com',
    'a@b.com;other@x.com',
  ])('rejects a non-single-mailbox recipient before SMTP: %s', async (email) => {
    const { db } = fakeDb({ inquiry1: inquiry({ email }) });
    const send = vi.fn();
    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send });
    expect(result.code).toBe('AUTO_ACK_EMAIL_REQUIRED');
    expect(send).not.toHaveBeenCalled();
  });

  it('normalizes one valid ASCII mailbox to a single lower-case recipient', async () => {
    const { db } = fakeDb({ inquiry1: inquiry({ email: 'Stored.User+Trip@Example.COM' }) });
    const send = vi.fn(async () => ({ messageId: 'normalized' }));
    expect((await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send })).code).toBe('SENT');
    expect(send.mock.calls[0][0].to).toBe('stored.user+trip@example.com');
  });

  it.each([
    ['approved draft', { reviewStatus: 'approved', deliveryStatus: 'not_sent' }],
    ['sending final response', { deliveryStatus: 'sending' }],
    ['retryable final response', { deliveryStatus: 'retryable' }],
    ['unknown final outcome', { deliveryStatus: 'outcome_unknown' }],
    ['manual final handling', { deliveryStatus: 'manual_required' }],
    ['already-sent final response', { deliveryStatus: 'sent' }],
  ])('never sends an automatic receipt once the final-response workflow is active: %s', async (_label, responseWorkflow) => {
    const { db, docs } = fakeDb({ inquiry1: inquiry({ responseWorkflow }) });
    const send = vi.fn();
    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send });
    expect(result.code).toBe('AUTO_ACK_FINAL_RESPONSE_ACTIVE');
    expect(send).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.autoAckCandidate).toBe(false);
  });

  it('fails closed when the quota transaction cannot be read', async () => {
    const { db } = fakeDb({ inquiry1: inquiry() }, { failTransactions: true });
    const send = vi.fn();
    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send });
    expect(result.code).toBe('AUTO_ACK_GUARD_UNAVAILABLE');
    expect(send).not.toHaveBeenCalled();
  });

  it('stops at the global daily cap and marks the inquiry for operator handling', async () => {
    const { db, docs } = fakeDb({
      inquiry1: inquiry(),
      'inquiry_auto_ack_limits/2026-08-31': { count: 20 },
    });
    const send = vi.fn();
    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send });
    expect(result).toMatchObject({ code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_DAILY_CAP_REACHED' });
    expect(send).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.ackWorkflow).toMatchObject({
      deliveryStatus: 'manual_required',
      lastDeliveryErrorCode: 'AUTO_ACK_DAILY_CAP_REACHED',
    });
  });

  it('allows only one automatic receipt to the same email per UTC day', async () => {
    const firstInquiry = inquiry();
    const secondInquiry = inquiry({ createdAt: Timestamp.fromMillis(NOW - 500) });
    const { db, docs } = fakeDb({ inquiry1: firstInquiry, inquiry2: secondInquiry });
    const send = vi.fn(async () => ({ messageId: 'provider-ok' }));
    expect((await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send })).code).toBe('SENT');
    const second = await automaticallyAcknowledgeInquiry(db, 'inquiry2', { ...OPTIONS, send });
    expect(second).toMatchObject({ code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_RECIPIENT_DAILY_CAP_REACHED' });
    expect(send).toHaveBeenCalledOnce();
    expect(docs.get('inquiry2')?.ackWorkflow.deliveryStatus).toBe('manual_required');
  });

  it('retries only a confirmed pre-send failure and reuses the original cap reservation', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    const preSend = Object.assign(new Error('quota before SMTP'), { preSend: true, code: 'QUOTA' });
    const first = await automaticallyAcknowledgeInquiry(db, 'inquiry1', {
      ...OPTIONS,
      send: vi.fn(async () => { throw preSend; }),
    });
    const due = docs.get('inquiry1')?.ackWorkflow.nextDeliveryAttemptAtMs;
    const retrySend = vi.fn(async () => ({ messageId: 'retry-ok' }));
    const retried = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...OPTIONS,
      now: due,
      send: retrySend,
    });
    expect(first.code).toBe('RETRY_SCHEDULED');
    expect(retried.code).toBe('SENT');
    expect(retrySend).toHaveBeenCalledOnce();
    expect(docs.get('inquiry_auto_ack_limits/2026-08-31')?.count).toBe(1);
  });

  it('retries only the success-state write after SMTP and never hands the same receipt to SMTP twice', async () => {
    const { db, docs } = fakeDb(
      { inquiry1: inquiry() },
      { failTransactionCalls: [2] },
    );
    const send = vi.fn(async () => ({ messageId: 'one-smtp-handoff' }));

    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send });

    expect(result.code).toBe('SENT');
    expect(send).toHaveBeenCalledOnce();
    expect(docs.get('inquiry1')?.ackWorkflow).toMatchObject({
      deliveryStatus: 'sent',
      providerMessageId: 'one-smtp-handoff',
    });
  });

  it('quarantines repeated post-SMTP state-write failure without another SMTP handoff', async () => {
    const { db, docs } = fakeDb(
      { inquiry1: inquiry() },
      { failTransactionCalls: [2, 3] },
    );
    const send = vi.fn(async () => ({ messageId: 'uncertain-state' }));
    const result = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send });
    const retrySend = vi.fn();
    const retry = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...OPTIONS,
      now: NOW + 5 * 60 * 1000,
      send: retrySend,
    });

    expect(result.code).toBe('OUTCOME_UNKNOWN');
    expect(send).toHaveBeenCalledOnce();
    expect(docs.get('inquiry1')?.ackWorkflow.deliveryStatus).toBe('outcome_unknown');
    expect(retry.code).toBe('OUTCOME_UNKNOWN');
    expect(retrySend).not.toHaveBeenCalled();
  });

  it('stops after three confirmed pre-SMTP failures and requires manual handling', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    const preSend = Object.assign(new Error('before SMTP'), { preSend: true, code: 'PRE_SEND' });
    const send = vi.fn(async () => { throw preSend; });

    expect((await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send })).code)
      .toBe('RETRY_SCHEDULED');
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      const due = docs.get('inquiry1')?.ackWorkflow.nextDeliveryAttemptAtMs;
      const result = await retryAutomaticInquiryAck(db, 'inquiry1', {
        ...OPTIONS,
        now: due,
        send,
      });
      expect(result.code).toBe(attempt < 3 ? 'RETRY_SCHEDULED' : 'MANUAL_REQUIRED');
    }
    const fourthSend = vi.fn();
    const fourth = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...OPTIONS,
      now: NOW + 30 * 60 * 1000,
      send: fourthSend,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(fourth.code).toBe('MANUAL_REQUIRED');
    expect(fourthSend).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.ackWorkflow).toMatchObject({
      deliveryStatus: 'manual_required',
      deliveryAttempts: 3,
    });
  });

  it('quarantines a retry when the configured daily cap changed after reservation', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    const preSend = Object.assign(new Error('before SMTP'), { preSend: true });
    await automaticallyAcknowledgeInquiry(db, 'inquiry1', {
      ...OPTIONS,
      send: vi.fn(async () => { throw preSend; }),
    });
    const due = docs.get('inquiry1')?.ackWorkflow.nextDeliveryAttemptAtMs;
    const retrySend = vi.fn();
    const result = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...OPTIONS,
      dailyCap: 1,
      now: due,
      send: retrySend,
    });
    expect(result).toMatchObject({ code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_RETRY_CAP_CHANGED' });
    expect(retrySend).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.ackWorkflow).toMatchObject({
      deliveryStatus: 'manual_required',
      configuredDailyCap: 20,
      lastDeliveryErrorCode: 'AUTO_ACK_RETRY_CAP_CHANGED',
    });
  });

  it.each(['responded', 'rejected', 'closed', 'converted'])(
    'cancels a pending retry when the inquiry becomes terminal: %s',
    async (status) => {
      const { db, docs } = fakeDb({ inquiry1: inquiry() });
      const preSend = Object.assign(new Error('before SMTP'), { preSend: true });
      await automaticallyAcknowledgeInquiry(db, 'inquiry1', {
        ...OPTIONS,
        send: vi.fn(async () => { throw preSend; }),
      });
      docs.set('inquiry1', { ...docs.get('inquiry1'), status });
      const retrySend = vi.fn();
      const result = await retryAutomaticInquiryAck(db, 'inquiry1', {
        ...OPTIONS,
        now: NOW + 5 * 60 * 1000,
        send: retrySend,
      });
      expect(result.code).toBe('INQUIRY_CLOSED');
      expect(retrySend).not.toHaveBeenCalled();
      expect(docs.get('inquiry1')?.ackWorkflow).toMatchObject({
        deliveryStatus: 'cancelled',
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: 'INQUIRY_CLOSED',
      });
    },
  );

  it('turns off automatic-policy retry immediately when the gate is disabled', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    const preSend = Object.assign(new Error('before SMTP'), { preSend: true });
    await automaticallyAcknowledgeInquiry(db, 'inquiry1', {
      ...OPTIONS,
      send: vi.fn(async () => { throw preSend; }),
    });
    const retrySend = vi.fn();
    const result = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...OPTIONS,
      gateEnabled: false,
      now: NOW + 5 * 60 * 1000,
      send: retrySend,
    });
    expect(result.code).toBe('AUTO_ACK_DISABLED');
    expect(retrySend).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.responseWorkflow.deliveryStatus).toBe('not_sent');
  });

  it('does not carry a pre-send reservation across a UTC day boundary', async () => {
    const firstNow = Date.UTC(2026, 7, 31, 23, 59, 0, 0);
    const firstOptions = {
      ...OPTIONS,
      now: firstNow,
      activationAtMs: firstNow - 60_000,
    };
    const { db, docs } = fakeDb({
      inquiry1: inquiry({ createdAt: Timestamp.fromMillis(firstNow - 1_000) }),
    });
    const preSend = Object.assign(new Error('before SMTP'), { preSend: true });
    await automaticallyAcknowledgeInquiry(db, 'inquiry1', {
      ...firstOptions,
      send: vi.fn(async () => { throw preSend; }),
    });
    const retrySend = vi.fn();
    const result = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...firstOptions,
      now: firstNow + 5 * 60 * 1000,
      send: retrySend,
    });
    expect(result).toMatchObject({ code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_RETRY_DAY_CHANGED' });
    expect(retrySend).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.ackWorkflow.deliveryStatus).toBe('manual_required');
  });

  it('invalidates a retry when the recipient or exact template source changes', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    const preSend = Object.assign(new Error('before SMTP'), { preSend: true });
    await automaticallyAcknowledgeInquiry(db, 'inquiry1', {
      ...OPTIONS,
      send: vi.fn(async () => { throw preSend; }),
    });
    docs.set('inquiry1', { ...docs.get('inquiry1'), email: 'changed@example.com' });
    const retrySend = vi.fn();
    const result = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...OPTIONS,
      now: NOW + 5 * 60 * 1000,
      send: retrySend,
    });
    expect(result).toMatchObject({ code: 'AUTO_ACK_RETRY_SNAPSHOT_CHANGED' });
    expect(retrySend).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.ackWorkflow.deliveryStatus).toBe('manual_required');
  });

  it('quarantines an SMTP-handoff uncertainty and never retries it automatically', async () => {
    const { db, docs } = fakeDb({ inquiry1: inquiry() });
    const firstSend = vi.fn(async () => { throw new Error('timeout after handoff'); });
    const first = await automaticallyAcknowledgeInquiry(db, 'inquiry1', { ...OPTIONS, send: firstSend });
    const retrySend = vi.fn();
    const retry = await retryAutomaticInquiryAck(db, 'inquiry1', {
      ...OPTIONS,
      now: NOW + 60_000,
      send: retrySend,
    });
    expect(first.code).toBe('OUTCOME_UNKNOWN');
    expect(retry.code).toBe('OUTCOME_UNKNOWN');
    expect(retrySend).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')).toMatchObject({
      status: 'NEW',
      responseWorkflow: { deliveryStatus: 'not_sent' },
      ackWorkflow: { deliveryStatus: 'outcome_unknown' },
    });
  });

  it('recovers only a stale ack claim and leaves the final-response workflow untouched', async () => {
    const data = inquiry({
      ackWorkflow: {
        deliveryStatus: 'sending',
        deliveryAttemptId: 'stale',
        deliveryClaimedAtMs: NOW - AUTO_ACK_DELIVERY_CLAIM_MS - 1,
      },
    });
    const { db, docs } = fakeDb({ inquiry1: data });
    expect(await recoverStaleAutomaticInquiryAck(db, 'inquiry1', NOW)).toBe(true);
    expect(docs.get('inquiry1')).toMatchObject({
      status: 'NEW',
      responseWorkflow: { deliveryStatus: 'not_sent' },
      ackWorkflow: { deliveryStatus: 'outcome_unknown' },
    });
  });
});
