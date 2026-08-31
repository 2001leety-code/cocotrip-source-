/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore transaction test scaffolding. */
import { describe, expect, it, vi } from 'vitest';
import {
  buildFallbackInquiryDraft,
  buildInquiryDraftPrompt,
  generateInquiryResponseDraft,
  inquiryDraftSource,
  redactInquiryText,
  validateInquiryDraft,
} from '../../api/_shared/inquiry-response.js';
import {
  approveAndSendInquiryResponse,
  buildInquiryResponseHtml,
  INQUIRY_DELIVERY_CLAIM_MS,
  retryApprovedInquiryResponse,
} from '../../api/_shared/inquiry-response-delivery.js';
import {
  generateAndStoreInquiryDraft,
  shouldGenerateInquiryDraft,
} from '../../api/_shared/inquiry-response-workflow.js';
import { markManualSent, resolveOutcome } from '../../api/admin-inquiry-response.js';

type StoredDocs = Map<string, Record<string, any>>;

function fakeDb(initial: Record<string, Record<string, any>>) {
  const docs: StoredDocs = new Map(Object.entries(initial).map(([id, value]) => [id, structuredClone(value)]));
  const refFor = (id: string) => ({ id });
  const db = {
    collection: vi.fn(() => ({ doc: (id: string) => refFor(id) })),
    runTransaction: async (fn: any) => {
      const updates: Array<{ id: string; patch: Record<string, any> }> = [];
      const tx = {
        get: async (ref: { id: string }) => ({
          exists: docs.has(ref.id),
          data: () => structuredClone(docs.get(ref.id) || {}),
        }),
        update: (ref: { id: string }, patch: Record<string, any>) => updates.push({ id: ref.id, patch }),
      };
      const result = await fn(tx);
      for (const update of updates) {
        docs.set(update.id, { ...(docs.get(update.id) || {}), ...structuredClone(update.patch) });
      }
      return result;
    },
  };
  return { db: db as any, docs };
}

const BASE_INQUIRY = {
  vehicle: 'tour_custom',
  language: 'en',
  email: 'stored@example.com',
  details: 'Two travelers. Email me at guest@example.com or +82 10-1234-5678. https://bad.example',
  eventDate: '2026-10-10',
  pax: 2,
  status: 'NEW',
};

describe('inquiry response draft policy', () => {
  it('redacts contact details and links before the AI prompt', () => {
    const redacted = redactInquiryText(BASE_INQUIRY.details);
    expect(redacted).toContain('[email removed]');
    expect(redacted).toContain('[phone removed]');
    expect(redacted).toContain('[link removed]');
    expect(redacted).not.toContain('guest@example.com');
    expect(redacted).not.toContain('10-1234');
  });

  it('does not send plan-charter notes or an amount to AI', () => {
    const source = inquiryDraftSource({
      vehicle: 'charter', language: 'ko', notes: 'private note 600000 KRW',
      quotedKRW: 600000, contractVersion: 'inquiry.v2',
    });
    const prompt = buildInquiryDraftPrompt({
      vehicle: 'charter', language: 'ko', notes: 'private note 600000 KRW',
      quotedKRW: 600000, contractVersion: 'inquiry.v2',
    });
    expect(source.request).toBe('');
    expect(source.hasServerReferenceEstimate).toBe(true);
    expect(prompt).not.toContain('600000');
    expect(prompt).not.toContain('private note');
    expect(prompt).toContain('Do not state any amount');
  });

  it('never sends free-form customer text or unknown structured values to AI', () => {
    const inquiry = {
      vehicle: 'tour_custom',
      language: 'en',
      details: 'My name is Test Person. Pick me up at 12 Private Road. Booking ABC-123. How much?',
      region: '12 Private Road',
      theme: 'Food, Test Person',
      travelStyle: 'Test Person',
      duration: 'my private schedule',
      budget: '$500-1000',
    };
    const source = inquiryDraftSource(inquiry);
    const prompt = buildInquiryDraftPrompt(inquiry);
    expect(source).toMatchObject({
      region: null,
      themes: ['Food'],
      travelStyle: null,
      duration: null,
      hasPriceQuestion: true,
      hasUnstructuredRequest: true,
      request: '',
    });
    expect(prompt).not.toContain('Test Person');
    expect(prompt).not.toContain('Private Road');
    expect(prompt).not.toContain('ABC-123');
    expect(prompt).not.toContain('$500-1000');
  });

  it('acknowledges a price question without inventing an amount or response deadline', () => {
    const draft = buildFallbackInquiryDraft({
      vehicle: 'tour_custom', language: 'en', details: 'How much will it cost?',
    });
    expect(draft.body).toContain('pricing details');
    expect(draft.body).toContain('verify the final quote');
    expect(draft.body).not.toMatch(/[$₩¥€]\s*\d/);
    expect(draft.body).not.toMatch(/within\s+\d+\s+(?:hours?|days?)/i);
  });

  it.each(['What are your rates?', '요금이 얼마인가요?', 'いくらですか？'])(
    'detects common price wording: %s',
    (details) => {
      expect(inquiryDraftSource({ vehicle: 'tour_custom', details }).hasPriceQuestion).toBe(true);
    },
  );

  it('uses the approved policy template for price questions instead of AI free text', async () => {
    const generateText = vi.fn(async () => JSON.stringify({
      subject: 'Your CocoTrip inquiry',
      body: 'The amount will be 500 after review.',
    }));
    const draft = await generateInquiryResponseDraft({
      vehicle: 'tour_custom', language: 'en', details: 'What are your rates?',
    }, {
      apiKey: 'test-key',
      model: 'test-model',
      generateText,
    });
    expect(draft.source).toBe('policy_template');
    expect(draft.body).toContain('pricing details');
    expect(draft.body).toContain('verify the final quote');
    expect(draft.body).not.toContain('500');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('never calls AI for price questions even when the proposed output spells the amount', async () => {
    const generateText = vi.fn(async () => JSON.stringify({
      subject: 'Your CocoTrip inquiry',
      body: 'Five hundred dollars is the expected cost.',
    }));
    const draft = await generateInquiryResponseDraft({
      vehicle: 'tour_custom', language: 'en', details: 'What are your rates?',
    }, {
      apiKey: 'test-key',
      model: 'test-model',
      generateText,
    });
    expect(draft.source).toBe('policy_template');
    expect(draft.body).not.toContain('dollars');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('mentions a reference estimate only when the server contract says one exists', () => {
    const withoutEstimate = buildFallbackInquiryDraft({ vehicle: 'charter', language: 'en' });
    const withEstimate = buildFallbackInquiryDraft({
      vehicle: 'charter', language: 'en', contractVersion: 'inquiry.v2',
    });
    expect(withoutEstimate.body).not.toContain('reference estimate');
    expect(withEstimate.body).toContain('reference estimate');
  });

  it.each([
    'The estimate shown in your inquiry form is provisional.',
    'Your initial estimate will be reviewed.',
    'The quoted estimate is not final.',
  ])('uses a deterministic charter template instead of an invented estimate: %s', async (body) => {
    const generateText = vi.fn(async () => JSON.stringify({
      subject: 'Your CocoTrip inquiry', body,
    }));
    const draft = await generateInquiryResponseDraft({ vehicle: 'charter', language: 'en' }, {
      apiKey: 'test-key', model: 'test-model', generateText,
    });
    expect(draft.source).toBe('policy_template');
    expect(draft.body).not.toContain('reference estimate');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('does not turn a missing passenger count into a made-up one-person fact', () => {
    expect(inquiryDraftSource({ pax: null }).passengerCount).toBeNull();
    expect(inquiryDraftSource({}).passengerCount).toBeNull();
    expect(inquiryDraftSource({ pax: '' }).passengerCount).toBeNull();
    expect(inquiryDraftSource({ pax: '2.9' }).passengerCount).toBe(2);
  });

  it.each(['ko', 'en', 'ja', 'zh'])('has a usable %s fallback', (language) => {
    const draft = buildFallbackInquiryDraft({ vehicle: 'bus', language });
    expect(draft.subject.length).toBeGreaterThan(4);
    expect(draft.body.length).toBeGreaterThan(20);
    expect(draft.language).toBe(language);
    expect(draft.body).not.toMatch(/24\s*(시간|hours?|時間|小时)/i);
  });

  it('rejects HTML and invented links in model output', () => {
    expect(validateInquiryDraft({ subject: 'Hello there', body: '<b>unsafe answer text here</b>' }, 'en')).toBeNull();
    expect(validateInquiryDraft({ subject: 'Hello there', body: 'Please open https://invented.example for the answer.' }, 'en')).toBeNull();
    expect(validateInquiryDraft({ subject: 'Your quote', body: 'The price will be $500 after review.' }, 'en')).toBeNull();
    expect(validateInquiryDraft({ subject: 'Your quote', body: 'The total price is 500 dollars after review.' }, 'en')).toBeNull();
    expect(validateInquiryDraft({ subject: 'Your quote', body: 'Five hundred dollars is the expected cost.' }, 'en')).toBeNull();
    expect(validateInquiryDraft({ subject: 'Your quote', body: 'The amount will be 500 after review.' }, 'en')).toBeNull();
    expect(validateInquiryDraft({ subject: 'Your inquiry', body: 'We will reply within 24 hours after review.' }, 'en')).toBeNull();
  });

  it.each([
    ['bus', 'What will I pay?'],
    ['tour_custom', 'お値段を教えてください'],
    ['bus', '怎么收费？'],
    ['tour_custom', 'Please help with my itinerary'],
  ])('keeps every current quote-consultation type on the policy template: %s / %s', async (vehicle, details) => {
    const generateText = vi.fn(async () => JSON.stringify({
      subject: 'Your CocoTrip inquiry',
      body: 'The price is five hundred after review.',
    }));
    const draft = await generateInquiryResponseDraft({ vehicle, language: 'en', details }, {
      apiKey: 'test-key', model: 'test-model', generateText,
    });
    expect(draft.source).toBe('policy_template');
    expect(draft.body).toContain('pricing details');
    expect(draft.body).not.toContain('five hundred');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('stores a draft with a revision and policy state', async () => {
    const { db, docs } = fakeDb({ inquiry1: BASE_INQUIRY });
    const result = await generateAndStoreInquiryDraft(db, 'inquiry1', {
      now: 1000,
      actor: 'test',
      generate: async () => ({
        subject: 'Your CocoTrip inquiry',
        body: 'A coordinator will review the request and reply within 24 hours.',
        language: 'en', source: 'ai', model: 'test', retryable: false, errorCode: null,
      }),
    });
    expect(result.code).toBe('DRAFT_READY');
    expect(docs.get('inquiry1')?.responseWorkflow).toMatchObject({
      draftStatus: 'ready', draftRevision: 1, draftSource: 'ai', deliveryStatus: 'not_sent',
    });
    expect(shouldGenerateInquiryDraft(docs.get('inquiry1'), 2000)).toBe(false);
  });

  it('regenerates an unapproved ready draft when the policy version changes', () => {
    expect(shouldGenerateInquiryDraft({
      ...BASE_INQUIRY,
      responseWorkflow: {
        draftStatus: 'ready',
        draftRevision: 1,
        deliveryStatus: 'not_sent',
        policyVersion: 'inquiry-response.v3',
      },
    }, 2000)).toBe(true);
  });

  it.each(['rejected', 'responded', 'closed', 'converted'])('never force-generates for a terminal %s inquiry', async (status) => {
    const { db } = fakeDb({ inquiry1: { ...BASE_INQUIRY, status } });
    const generate = vi.fn();
    const result = await generateAndStoreInquiryDraft(db, 'inquiry1', {
      force: true,
      now: 1000,
      generate,
    });
    expect(result.code).toBe('INQUIRY_CLOSED');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('inquiry response delivery safety', () => {
  function approvedDraft(extra: Record<string, any> = {}) {
    return {
      ...BASE_INQUIRY,
      responseWorkflow: {
        draftStatus: 'ready',
        draftRevision: 2,
        draftSubject: 'Your CocoTrip inquiry',
        draftBody: 'A coordinator reviewed your request and is ready to help with the next step.',
        deliveryStatus: 'not_sent',
        ...extra,
      },
    };
  }

  it('escapes the approved body in HTML', () => {
    const html = buildInquiryResponseHtml('Hello <script>alert(1)</script>\nNext line');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<br>');
  });

  it('sends only to the stored email and records responded once', async () => {
    const { db, docs } = fakeDb({ inquiry1: approvedDraft() });
    const send = vi.fn(async () => ({ messageId: 'provider-1' }));
    const first = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send,
    });
    expect(first.code).toBe('SENT');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].to).toBe('stored@example.com');
    expect(docs.get('inquiry1')).toMatchObject({ status: 'responded' });

    const second = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 2000,
      send,
    });
    expect(second.code).toBe('ALREADY_SENT');
    expect(send).toHaveBeenCalledOnce();
  });

  it('retries only a confirmed pre-send failure', async () => {
    const { db, docs } = fakeDb({ inquiry1: approvedDraft() });
    const preSendError = Object.assign(new Error('quota'), { preSend: true, code: 'QUOTA' });
    const firstSend = vi.fn(async () => { throw preSendError; });
    const first = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send: firstSend,
    });
    expect(first.code).toBe('RETRY_SCHEDULED');
    const due = docs.get('inquiry1')?.responseWorkflow.nextDeliveryAttemptAtMs;
    expect(docs.get('inquiry1')?.responseWorkflow.deliveryStatus).toBe('retryable');

    const retrySend = vi.fn(async () => ({ messageId: 'provider-2' }));
    const retry = await retryApprovedInquiryResponse(db, 'inquiry1', { now: due, send: retrySend });
    expect(retry.code).toBe('SENT');
    expect(retrySend).toHaveBeenCalledOnce();
  });

  it('quarantines an SMTP outcome-unknown failure and never retries it', async () => {
    const { db, docs } = fakeDb({ inquiry1: approvedDraft() });
    const send = vi.fn(async () => { throw new Error('connection lost after SMTP handoff'); });
    const first = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send,
    });
    expect(first.code).toBe('OUTCOME_UNKNOWN');
    expect(docs.get('inquiry1')?.responseWorkflow.deliveryStatus).toBe('outcome_unknown');

    const retry = await retryApprovedInquiryResponse(db, 'inquiry1', { now: 999999, send });
    expect(retry.code).toBe('OUTCOME_UNKNOWN');
    expect(send).toHaveBeenCalledOnce();
  });

  it('rejects a stale draft revision before sending', async () => {
    const { db } = fakeDb({ inquiry1: approvedDraft() });
    const send = vi.fn();
    const result = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 1,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send,
    });
    expect(result.code).toBe('STALE_DRAFT');
    expect(send).not.toHaveBeenCalled();
  });

  it('quarantines an expired sending claim instead of taking it over and sending twice', async () => {
    const now = INQUIRY_DELIVERY_CLAIM_MS + 2000;
    const { db, docs } = fakeDb({
      inquiry1: approvedDraft({
        reviewStatus: 'approved',
        deliveryStatus: 'sending',
        deliveryClaimedAtMs: 1000,
        deliveryAttemptId: 'old-attempt',
      }),
    });
    const send = vi.fn();
    const result = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now,
      send,
    });
    expect(result.code).toBe('OUTCOME_UNKNOWN');
    expect(send).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.responseWorkflow).toMatchObject({
      deliveryStatus: 'outcome_unknown',
      lastDeliveryErrorCode: 'STALE_SEND_OUTCOME_UNKNOWN',
    });
  });

  it.each(['rejected', 'responded', 'closed', 'converted'])('never sends a terminal %s inquiry', async (status) => {
    const { db } = fakeDb({ inquiry1: { ...approvedDraft(), status } });
    const send = vi.fn();
    const result = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send,
    });
    expect(result.code).toBe('INQUIRY_CLOSED');
    expect(send).not.toHaveBeenCalled();
  });

  it('retries only the state write when the first post-SMTP Firestore completion fails', async () => {
    const { db } = fakeDb({ inquiry1: approvedDraft() });
    const runTransaction = db.runTransaction.bind(db);
    let transactionCount = 0;
    db.runTransaction = vi.fn(async (fn: any) => {
      transactionCount += 1;
      if (transactionCount === 2) throw new Error('firestore unavailable after smtp');
      return runTransaction(fn);
    });
    const send = vi.fn(async () => ({ messageId: 'provider-1' }));
    const result = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, code: 'SENT' });
  });

  it('does not overwrite a terminal inquiry status when SMTP finishes during a rejection race', async () => {
    const { db, docs } = fakeDb({ inquiry1: approvedDraft() });
    const send = vi.fn(async () => {
      docs.set('inquiry1', { ...docs.get('inquiry1'), status: 'rejected' });
      return { messageId: 'provider-1' };
    });
    const result = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send,
    });
    expect(result.code).toBe('SENT');
    expect(docs.get('inquiry1')?.status).toBe('rejected');
    expect(docs.get('inquiry1')?.responseWorkflow.deliveryStatus).toBe('sent');
  });

  it('stops automatic delivery after the configured attempt cap', async () => {
    const { db, docs } = fakeDb({ inquiry1: approvedDraft({ deliveryAttempts: 3 }) });
    const send = vi.fn();
    const result = await approveAndSendInquiryResponse(db, 'inquiry1', {
      expectedDraftRevision: 2,
      subject: 'Reviewed subject',
      body: 'This reviewed response is long enough to send to the customer.',
      approvedBy: 'admin@example.com',
      now: 1000,
      send,
    });
    expect(result.code).toBe('MANUAL_REQUIRED');
    expect(send).not.toHaveBeenCalled();
    expect(docs.get('inquiry1')?.responseWorkflow.deliveryStatus).toBe('manual_required');
  });

  it('does not let manual completion overwrite sending or outcome-unknown states', async () => {
    for (const deliveryStatus of ['sending', 'outcome_unknown']) {
      const { db, docs } = fakeDb({ inquiry1: approvedDraft({ deliveryStatus }) });
      const result = await markManualSent(db, 'inquiry1', { email: 'admin@example.com' }, 1000);
      expect(result.code).toBe(deliveryStatus === 'sending' ? 'SEND_IN_PROGRESS' : 'OUTCOME_UNKNOWN');
      expect(docs.get('inquiry1')?.status).toBe('NEW');
    }
  });

  it('allows manual completion only for a manual-required path', async () => {
    const ordinary = fakeDb({ inquiry1: approvedDraft() });
    const blocked = await markManualSent(ordinary.db, 'inquiry1', { email: 'admin@example.com' }, 1000);
    expect(blocked.code).toBe('MANUAL_NOT_ALLOWED');

    const manual = fakeDb({ inquiry1: approvedDraft({ deliveryStatus: 'manual_required' }) });
    const completed = await markManualSent(manual.db, 'inquiry1', { email: 'admin@example.com' }, 1000);
    expect(completed.code).toBe('MANUAL_SENT_CONFIRMED');
    expect(manual.docs.get('inquiry1')).toMatchObject({ status: 'responded' });
  });

  it('requires an explicit outcome resolution before a confirmed not-sent response can be sent again', async () => {
    const { db, docs } = fakeDb({ inquiry1: approvedDraft({ deliveryStatus: 'outcome_unknown' }) });
    const resolved = await resolveOutcome(db, 'inquiry1', { email: 'admin@example.com' }, 'not_sent', 1000);
    expect(resolved.code).toBe('NOT_SENT_CONFIRMED');
    expect(docs.get('inquiry1')?.responseWorkflow).toMatchObject({
      deliveryStatus: 'not_sent',
      outcomeUnknown: false,
      deliveryAttemptId: null,
    });
  });

  it.each(['rejected', 'responded', 'closed', 'converted'])(
    'does not resolve an outcome-unknown record over terminal %s status',
    async (status) => {
      const { db, docs } = fakeDb({
        inquiry1: { ...approvedDraft({ deliveryStatus: 'outcome_unknown' }), status },
      });
      const result = await resolveOutcome(db, 'inquiry1', { email: 'admin@example.com' }, 'sent', 1000);
      expect(result.code).toBe('INQUIRY_CLOSED');
      expect(docs.get('inquiry1')?.status).toBe(status);
      expect(docs.get('inquiry1')?.responseWorkflow.deliveryStatus).toBe('outcome_unknown');
    },
  );
});
