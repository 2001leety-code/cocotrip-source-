import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
const verifyIdentity = vi.fn();
const planDocs = new Map<string, Record<string, unknown>>();
let forcedCollisions = 0;
let rateLimitResult: Record<string, unknown> = { ok: true };

vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: (collectionName: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = planDocs.get(id);
          return { exists: !!data, data: () => data };
        },
        create: async (data: Record<string, unknown>) => {
          if (collectionName !== 'charter_inquiries') throw new Error('unexpected create');
          if (forcedCollisions > 0) {
            forcedCollisions -= 1;
            const error = new Error('already exists') as Error & { code: number };
            error.code = 6;
            throw error;
          }
          writes.push({ id, data });
        },
      }),
    }),
  }),
}));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: async () => rateLimitResult,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_shared/translator.js', () => ({
  detectAndTranslate: async () => ({ sourceLang: 'en', isOriginal: true, translation: null }),
}));
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyFirebaseIdentityToken: (...args: unknown[]) => verifyIdentity(...args),
}));
vi.mock('../../api/_shared/sentry.js', () => ({
  captureError: async () => undefined,
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

const { default: handler } = await import('../../api/inquiry-submit.js');

function call(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  let status = 0;
  let payload = '';
  const req = { method: 'POST', body, headers, socket: { remoteAddress: '127.0.0.1' } };
  const res = {
    writeHead(code: number) { status = code; },
    end(value = '') { payload = value; },
  };
  return Promise.resolve(handler(req, res)).then(() => ({ status, json: JSON.parse(payload) }));
}

const telegramKeys = [
  'TELEGRAM_INQUIRY_BOT_TOKEN', 'INQUIRY_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_INQUIRY_CHAT_ID', 'INQUIRY_CHAT_ID', 'TELEGRAM_CHAT_ID',
];
const oldTelegramEnv = new Map<string, string | undefined>();

beforeEach(() => {
  writes.length = 0;
  planDocs.clear();
  forcedCollisions = 0;
  rateLimitResult = { ok: true };
  verifyIdentity.mockReset();
  planDocs.set('public-seoul-plan', {
    isPublic: true,
    input: { startDate: '2026-09-10', adults: 3 },
    itinerary: {
      days: [
        { day: 1, theme: 'Palaces', stops: [{ display_name: 'Gyeongbokgung Palace' }] },
        { day: 2, theme: 'Markets', stops: [{ name_ko: '광장시장' }] },
      ],
    },
  });
  for (const key of telegramKeys) {
    oldTelegramEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const key of telegramKeys) {
    const value = oldTelegramEnv.get(key);
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  }
  oldTelegramEnv.clear();
});

describe('POST /api/inquiry-submit canonical contract', () => {
  it('accepts the bus inquiry shape and writes bounded canonical NEW fields', async () => {
    verifyIdentity.mockResolvedValue({
      ok: true,
      uid: 'guest-1',
      email: 'guest@example.com',
      emailVerified: true,
    });
    const result = await call({
      email: 'Guest@Example.com',
      name: 'Guest User',
      phone: '+82 10 1234 5678',
      eventDate: '2026-09-02',
      pax: 20,
      vehicle: 'bus',
      details: 'Airport group transfer',
      language: 'en',
      source: 'charter_wizard',
      wizardSnapshot: {
        origin: 'Incheon Airport',
        service: 'airport-transfer',
        destinationKey: 'seoul',
        destinationCustom: 'Hotel',
      },
    }, { authorization: 'Bearer verified-user-token' });

    expect(result).toMatchObject({ status: 200, json: { success: true, status: 'NEW' } });
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toMatchObject({
      status: 'NEW',
      vehicle: 'bus',
      email: 'guest@example.com',
      details: 'Airport group transfer',
      contractVersion: 'inquiry.v1',
      submissionProvenance: 'api:inquiry-submit.v1',
      autoAckEligibilityVersion: 'inquiry-auto-ack.eligibility.v1',
      rateLimitVerifiedForAutoAck: true,
      recipientVerifiedForAutoAck: true,
      autoAckCandidate: true,
      source: 'charter_wizard',
      wizardSnapshot: {
        origin: 'Incheon Airport',
        service: 'airport-transfer',
        destinationKey: 'seoul',
        destinationCustom: 'Hotel',
      },
    });
  });

  it('accepts a PlanDetail charter request and stores only the server-derived quote/context', async () => {
    const result = await call({
      email: 'Guest@Example.com',
      name: '',
      phone: '',
      vehicle: 'charter',
      details: 'Baby seat please',
      planId: 'public-seoul-plan',
      expectedTourKey: 'seoul-city',
      expectedAmountKRW: 330000,
      expectedHours: 8,
      quotedKRW: 1,
      recommendedTour: 'FORGED',
      hours: 1,
      startDate: '2099-01-01',
      pax: 999,
      source: 'plan_detail_charter_inquiry',
      language: 'en',
    });

    expect(result).toMatchObject({
      status: 200,
      json: {
        success: true,
        status: 'NEW',
        quote: { tourKey: 'seoul-city', amountKRW: 330000, hours: 8, currency: 'KRW' },
      },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toMatchObject({
      status: 'NEW',
      vehicle: 'charter',
      contractVersion: 'inquiry.v2',
      name: '',
      email: 'guest@example.com',
      notes: 'Baby seat please',
      planId: 'public-seoul-plan',
      recommendedTour: 'Seoul City Tour',
      quotedKRW: 330000,
      hours: 8,
      startDate: '2026-09-10',
      eventDate: '2026-09-10',
      pax: 3,
      dayCount: 2,
      quote: {
        currency: 'KRW',
        pricingKey: 'seoul-city',
        pricingVersion: '2.0.0',
        amountKRW: 330000,
        hours: 8,
        provenance: 'server_pricing_spec',
        kind: 'reference',
      },
    });
    expect(JSON.stringify(writes[0].data)).not.toContain('FORGED');
    expect(JSON.stringify(writes[0].data)).not.toContain('2099-01-01');
  });

  it('returns QUOTE_CHANGED without writing when the displayed amount is tampered or stale', async () => {
    const result = await call({
      email: 'guest@example.com',
      vehicle: 'charter',
      planId: 'public-seoul-plan',
      expectedTourKey: 'seoul-city',
      expectedAmountKRW: 1,
      expectedHours: 8,
    });

    expect(result).toMatchObject({
      status: 409,
      json: { success: false, code: 'QUOTE_CHANGED', quote: { amountKRW: 330000 } },
    });
    expect(writes).toHaveLength(0);
  });

  it('returns QUOTE_CHANGED without writing when the displayed duration is stale', async () => {
    const result = await call({
      email: 'guest@example.com',
      vehicle: 'charter',
      planId: 'public-seoul-plan',
      expectedTourKey: 'seoul-city',
      expectedAmountKRW: 330000,
      expectedHours: 10,
    });

    expect(result).toMatchObject({
      status: 409,
      json: { success: false, code: 'QUOTE_CHANGED', quote: { hours: 8 } },
    });
    expect(writes).toHaveLength(0);
  });

  it('allows a private owner or matching guest token, but never stores the access token', async () => {
    planDocs.set('private-owner-plan', {
      uid: 'owner-1',
      accessToken: 'guest-secret',
      input: {},
      itinerary: { days: [{ stops: [{ name: 'Seoul' }] }] },
    });
    verifyIdentity.mockResolvedValue({ ok: true, uid: 'owner-1' });
    const owner = await call({
      email: 'owner@example.com', vehicle: 'charter', planId: 'private-owner-plan',
      expectedTourKey: 'seoul-city', expectedAmountKRW: 330000, expectedHours: 8,
    }, { authorization: 'Bearer valid-owner-token' });
    expect(owner.status).toBe(200);
    expect(JSON.stringify(writes[0].data)).not.toContain('guest-secret');

    writes.length = 0;
    const guest = await call({
      email: 'guest@example.com', vehicle: 'charter', planId: 'private-owner-plan',
      accessToken: 'guest-secret', expectedTourKey: 'seoul-city', expectedAmountKRW: 330000, expectedHours: 8,
    });
    expect(guest.status).toBe(200);
    expect(JSON.stringify(writes[0].data)).not.toContain('guest-secret');
  });

  it('rejects another user private plan and a plan without a charter recommendation', async () => {
    planDocs.set('private-plan', {
      uid: 'someone-else',
      itinerary: { days: [{ stops: [{ name: 'Seoul' }] }] },
    });
    const denied = await call({
      email: 'guest@example.com', vehicle: 'charter', planId: 'private-plan',
      expectedTourKey: 'seoul-city', expectedAmountKRW: 330000, expectedHours: 8,
    });
    expect(denied).toMatchObject({ status: 403, json: { code: 'PLAN_ACCESS_DENIED' } });

    planDocs.set('public-no-match', {
      isPublic: true,
      itinerary: { days: [{ stops: [{ name: 'Unknown place' }] }] },
    });
    const noMatch = await call({
      email: 'guest@example.com', vehicle: 'charter', planId: 'public-no-match',
      expectedTourKey: 'seoul-city', expectedAmountKRW: 330000, expectedHours: 8,
    });
    expect(noMatch).toMatchObject({ status: 422, json: { code: 'NO_CHARTER_RECOMMENDATION' } });
    expect(writes).toHaveLength(0);
  });

  it('retries an inquiry id collision without overwriting an existing document', async () => {
    forcedCollisions = 1;
    const result = await call({
      email: 'guest@example.com', vehicle: 'charter', planId: 'public-seoul-plan',
      expectedTourKey: 'seoul-city', expectedAmountKRW: 330000, expectedHours: 8,
    });
    expect(result.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it('fails closed for a PlanDetail inquiry when rate-limit protection is unavailable', async () => {
    rateLimitResult = { ok: true, degraded: true };
    const result = await call({
      email: 'guest@example.com', vehicle: 'charter', planId: 'public-seoul-plan',
      expectedTourKey: 'seoul-city', expectedAmountKRW: 330000, expectedHours: 8,
    });
    expect(result).toMatchObject({ status: 503, json: { code: 'RATE_LIMIT_UNAVAILABLE' } });
    expect(writes).toHaveLength(0);
  });

  it('never marks a phone-only inquiry as an automatic-email candidate', async () => {
    const result = await call({
      name: 'Phone Guest',
      email: '',
      phone: '+82 10 1234 5678',
      pax: 2,
      vehicle: 'tour_custom',
      language: 'en',
    });

    expect(result.status).toBe(200);
    expect(writes[0].data).toMatchObject({
      email: null,
      rateLimitVerifiedForAutoAck: true,
      recipientVerifiedForAutoAck: false,
      autoAckCandidate: false,
    });
  });

  it.each([
    ['guest without a token', undefined],
    ['unverified matching email', { ok: true, uid: 'guest-2', email: 'guest@example.com', emailVerified: false }],
    ['verified different email', { ok: true, uid: 'guest-3', email: 'other@example.com', emailVerified: true }],
  ])('stores %s for manual handling without an automatic-email candidate', async (_label, identity) => {
    const headers = identity ? { authorization: 'Bearer user-token' } : {};
    if (identity) verifyIdentity.mockResolvedValue(identity);
    const result = await call({
      name: 'Guest User',
      email: 'guest@example.com',
      eventDate: '2026-09-02',
      pax: 2,
      vehicle: 'bus',
      details: 'Airport group transfer',
      language: 'en',
    }, headers);

    expect(result.status).toBe(200);
    expect(writes[0].data).toMatchObject({
      autoAckEligibilityVersion: null,
      recipientVerifiedForAutoAck: false,
      autoAckCandidate: false,
    });
  });

  it.each([
    'victim@example.com,other@example.com',
    'Name<a@example.com>',
    'a@b.com;other@example.com',
  ])('rejects a non-single-mailbox inquiry address: %s', async (email) => {
    const result = await call({
      name: 'Guest User',
      email,
      eventDate: '2026-09-02',
      pax: 2,
      vehicle: 'bus',
      details: 'Airport group transfer',
      language: 'en',
    });
    expect(result).toMatchObject({ status: 400, json: { code: 'INVALID_EMAIL' } });
    expect(writes).toHaveLength(0);
  });

  it('stores a degraded guest inquiry for manual handling but makes it ineligible for auto-ack', async () => {
    rateLimitResult = { ok: true, degraded: true };
    const result = await call({
      name: 'Guest User',
      email: 'guest@example.com',
      eventDate: '2026-09-02',
      pax: 20,
      vehicle: 'bus',
      details: 'Airport group transfer',
      language: 'en',
    });
    expect(result.status).toBe(200);
    expect(writes[0].data).toMatchObject({
      submissionProvenance: 'api:inquiry-submit.v1',
      autoAckEligibilityVersion: null,
      rateLimitVerifiedForAutoAck: false,
      recipientVerifiedForAutoAck: false,
      autoAckCandidate: false,
    });
  });

  it('sends a charter-specific Telegram message with the server reference quote only', async () => {
    process.env.TELEGRAM_INQUIRY_BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_INQUIRY_CHAT_ID = 'test-chat-id';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    } as Response);

    const result = await call({
      email: 'guest@example.com', vehicle: 'charter', planId: 'public-seoul-plan',
      accessToken: 'must-not-leak', expectedTourKey: 'seoul-city', expectedAmountKRW: 330000, expectedHours: 8,
    });
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    const telegramBody = JSON.parse(String(request.body));
    expect(telegramBody.text).toContain('새 플랜 차터 견적 문의');
    expect(telegramBody.text).toContain('서버 계산 참고견적:</b> ₩330,000 / 8시간');
    expect(telegramBody.text).not.toContain('대형버스');
    expect(telegramBody.text).not.toContain('must-not-leak');
  });

  it('keeps guest submission open but rejects a supplied invalid Firebase token', async () => {
    verifyIdentity.mockResolvedValue({ ok: false, status: 401, error: 'bad token' });
    const result = await call({
      name: 'Guest User',
      email: 'guest@example.com',
      eventDate: '2026-09-02',
      pax: 20,
      vehicle: 'bus',
      details: 'Airport group transfer',
      language: 'en',
    }, { authorization: 'Bearer forged' });

    expect(result).toMatchObject({ status: 401, json: { success: false, code: 'AUTH_INVALID' } });
    expect(writes).toHaveLength(0);
  });
});
