/* eslint-disable @typescript-eslint/no-explicit-any -- Vercel handler mocks. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const holders = vi.hoisted(() => ({
  auth: { result: { ok: true, email: 'admin@example.com', uid: 'admin-1' } as any },
  db: { value: {} as any },
}));
const spies = vi.hoisted(() => ({
  verifyAdminToken: vi.fn(async () => holders.auth.result),
  initAdminDb: vi.fn(() => holders.db.value),
  generate: vi.fn(),
  send: vi.fn(),
  retry: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: spies.verifyAdminToken }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: spies.initAdminDb }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: spies.captureError }));
vi.mock('../../api/_shared/cors.js', () => ({
  buildAdminCors: () => ({}),
  buildAdminJsonCors: () => ({ 'Content-Type': 'application/json' }),
}));
vi.mock('../../api/_shared/inquiry-response-workflow.js', () => ({
  generateAndStoreInquiryDraft: spies.generate,
}));
vi.mock('../../api/_shared/inquiry-response-delivery.js', () => ({
  approveAndSendInquiryResponse: spies.send,
  retryApprovedInquiryResponse: spies.retry,
  validInquiryResponseEmail: (value: unknown) => String(value || '').includes('@') ? String(value) : null,
}));

const { default: handler } = await import('../../api/admin-inquiry-response.js');

function mockResponse() {
  const output = { status: 0, body: '', headers: {} as Record<string, string> };
  return {
    output,
    writeHead(status: number, headers: Record<string, string>) {
      output.status = status;
      output.headers = headers;
    },
    end(body = '') { output.body = body; },
  };
}

async function call(body: Record<string, unknown>, method = 'POST') {
  const res = mockResponse();
  await handler({ method, headers: {}, body } as any, res as any);
  return {
    ...res.output,
    json: res.output.body ? JSON.parse(res.output.body) : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.auth.result = { ok: true, email: 'admin@example.com', uid: 'admin-1' };
  holders.db.value = {};
});

describe('admin inquiry response API', () => {
  it('rejects an unauthenticated request before Firestore or delivery is touched', async () => {
    holders.auth.result = { ok: false, status: 403, error: 'Not admin' };
    const result = await call({ inquiryId: 'inquiry-1', action: 'send' });
    expect(result.status).toBe(403);
    expect(result.json.code).toBe('AUTH_FAILED');
    expect(spies.initAdminDb).not.toHaveBeenCalled();
    expect(spies.send).not.toHaveBeenCalled();
  });

  it('allows POST only and rejects malformed inquiry ids before an action runs', async () => {
    const methodResult = await call({}, 'GET');
    expect(methodResult.status).toBe(405);

    const idResult = await call({ inquiryId: 'nested/document', action: 'send' });
    expect(idResult.status).toBe(400);
    expect(idResult.json.code).toBe('INVALID_REQUEST');
    expect(spies.send).not.toHaveBeenCalled();
  });

  it('returns only the admin UI workflow fields after delivery', async () => {
    spies.send.mockResolvedValue({
      ok: true,
      code: 'SENT',
      inquiryId: 'inquiry-1',
      workflow: {
        draftStatus: 'ready',
        draftSubject: 'Draft subject',
        draftBody: 'Draft body long enough for this fixture.',
        draftRevision: 2,
        reviewStatus: 'approved',
        approvedSubject: 'Approved subject',
        approvedBody: 'Approved body long enough for this fixture.',
        approvedRevision: 2,
        deliveryStatus: 'sent',
        approvedBy: 'internal-admin@example.com',
        providerMessageId: 'private-provider-id',
      },
    });
    const result = await call({
      inquiryId: 'inquiry-1',
      action: 'send',
      expectedDraftRevision: 2,
      subject: 'Approved subject',
      body: 'Approved body long enough for this fixture.',
    });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      ok: true,
      code: 'SENT',
      workflow: {
        approvedSubject: 'Approved subject',
        approvedBody: 'Approved body long enough for this fixture.',
        deliveryStatus: 'sent',
      },
    });
    expect(result.body).not.toContain('internal-admin@example.com');
    expect(result.body).not.toContain('private-provider-id');
  });
});
