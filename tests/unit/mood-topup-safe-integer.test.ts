import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyUserToken: vi.fn(),
  getMoodAllowlist: vi.fn(),
  isAdminEmail: vi.fn(),
  initAdminDb: vi.fn(),
}));

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: mocks.verifyUserToken }));
vi.mock('../../api/_shared/mood-allowlist.js', () => ({
  getMoodAllowlist: mocks.getMoodAllowlist,
  isAdminEmail: mocks.isAdminEmail,
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: mocks.initAdminDb }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));

import handler from '../../api/mood-topup.js';

function makeResponse() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { res.statusCode = status; },
    end(body = '') { res.body = body; },
  };
  return res;
}

type ClientRecord = { balanceKRW: unknown; name: string };
type MockTransaction = {
  get: (_ref: unknown) => Promise<{ exists: boolean; data: () => ClientRecord }>;
  update: (_ref: unknown, value: Record<string, unknown>) => void;
  set: (_ref: unknown, value: Record<string, unknown>) => void;
};

function makeWorld(balanceKRW: unknown) {
  const client = { balanceKRW, name: 'synthetic client' };
  const writes: Array<{ kind: string; value: Record<string, unknown> }> = [];
  let transactionCount = 0;
  const db = {
    collection() {
      return { doc: (id?: string) => ({ id: id || 'synthetic-topup-id' }) };
    },
    async runTransaction(work: (tx: MockTransaction) => Promise<unknown>) {
      transactionCount += 1;
      return work({
        async get() { return { exists: true, data: () => client }; },
        update(_ref: unknown, value: Record<string, unknown>) {
          writes.push({ kind: 'update', value });
          Object.assign(client, value);
        },
        set(_ref: unknown, value: Record<string, unknown>) {
          writes.push({ kind: 'set', value });
        },
      });
    },
  };
  return { client, db, writes, transactionCount: () => transactionCount };
}

async function callTopup(amountKRW: unknown, balanceKRW: unknown, note?: string) {
  const world = makeWorld(balanceKRW);
  mocks.initAdminDb.mockReturnValue(world.db);
  const res = makeResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-token' },
    body: { clientId: 'synthetic-client', amountKRW, ...(note ? { note } : {}) },
  } as Parameters<typeof handler>[0], res as Parameters<typeof handler>[1]);
  return { ...world, res, body: JSON.parse(res.body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyUserToken.mockResolvedValue({
    ok: true,
    email: 'synthetic-admin@example.invalid',
    emailVerified: true,
  });
  mocks.getMoodAllowlist.mockResolvedValue({ admins: ['synthetic-admin@example.invalid'] });
  mocks.isAdminEmail.mockReturnValue(true);
});

describe('mood-topup money range checks', () => {
  it('records a normal top-up and keeps the same-transaction audit fields', async () => {
    const { res, body, client, writes } = await callTopup(250, 1000, ' bank receipt ');

    expect(res.statusCode).toBe(200);
    expect(body.data.balanceKRW).toBe(1250);
    expect(client.balanceKRW).toBe(1250);
    expect(writes).toHaveLength(2);
    expect(writes.find((write) => write.kind === 'set')?.value).toMatchObject({
      clientId: 'synthetic-client',
      amountKRW: 250,
      previousBalanceKRW: 1000,
      newBalanceKRW: 1250,
      byEmail: 'synthetic-admin@example.invalid',
      note: 'bank receipt',
    });
    expect(Number.isSafeInteger(writes.find((write) => write.kind === 'set')?.value.at)).toBe(true);
  });

  it('rejects an unsafe top-up amount before opening a Firestore transaction', async () => {
    const { res, body, writes, transactionCount } = await callTopup(Number.MAX_VALUE, 1000);

    expect(res.statusCode).toBe(400);
    expect(body.error).toContain('양의 정수');
    expect(writes).toHaveLength(0);
    expect(transactionCount()).toBe(0);
  });

  it('rejects a balance addition beyond the safe integer range without writes', async () => {
    const { res, body, writes, transactionCount } = await callTopup(1, Number.MAX_SAFE_INTEGER);

    expect(res.statusCode).toBe(409);
    expect(body.error).toBe('BALANCE_OVERFLOW');
    expect(writes).toHaveLength(0);
    expect(transactionCount()).toBe(1);
  });

  it('rejects a damaged existing balance instead of coercing it to zero', async () => {
    const { res, body, writes, transactionCount } = await callTopup(100, Number.MAX_SAFE_INTEGER + 1);

    expect(res.statusCode).toBe(409);
    expect(body.error).toBe('INVALID_BALANCE');
    expect(writes).toHaveLength(0);
    expect(transactionCount()).toBe(1);
  });
});
