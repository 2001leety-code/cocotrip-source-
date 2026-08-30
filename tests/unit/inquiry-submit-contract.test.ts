import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
const verifyIdentity = vi.fn();

vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: () => ({
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>) => { writes.push({ id, data }); },
      }),
    }),
  }),
}));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: async () => ({ ok: true }),
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
  verifyIdentity.mockReset();
  for (const key of telegramKeys) {
    oldTelegramEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of telegramKeys) {
    const value = oldTelegramEnv.get(key);
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  }
  oldTelegramEnv.clear();
});

describe('POST /api/inquiry-submit canonical contract', () => {
  it('accepts the plan-detail charter shape and writes canonical NEW plus legacy aliases', async () => {
    const result = await call({
      email: 'Guest@Example.com',
      name: '',
      phone: '+82 10 1234 5678',
      eventDate: '',
      pax: 2,
      vehicle: 'charter',
      details: 'Hotel pickup',
      notes: 'Hotel pickup',
      language: 'en',
      planId: 'plan-123',
      recommendedTour: 'Seoul highlights',
      quotedKRW: 330000,
      hours: 8,
      startDate: '2026-09-02',
      dayCount: 3,
      itinerarySummary: [{ day: 1, theme: 'Seoul', stopCount: 5 }],
      source: 'plan_detail_charter_banner',
    });

    expect(result).toMatchObject({ status: 200, json: { success: true, status: 'NEW' } });
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toMatchObject({
      status: 'NEW',
      vehicle: 'charter',
      email: 'guest@example.com',
      details: 'Hotel pickup',
      notes: 'Hotel pickup',
      planId: 'plan-123',
      recommendedTour: 'Seoul highlights',
      quotedKRW: 330000,
      quoteContextTrusted: false,
      contractVersion: 'inquiry.v1',
      source: 'plan_detail_charter_banner',
    });
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
