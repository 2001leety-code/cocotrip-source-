/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * GET /api/admin-all-bookings — PayPal bookings 포함 (2026-10-23).
 * 잠그는 것: 세 소스 합산·최신순 · 연결 pending 중복 제거(pending 대표, limit 밖 포함, 동일 id 경로,
 *   명시 테스트 신호만 OR) · 연결 조회 실패 → 전부 refundable:false · refundable 계산 · partialErrors.paypal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Seed = Record<string, Record<string, any>>;
let seed: Seed;
let fail: { paypal?: boolean; link?: boolean };

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => ({ ok: true, uid: 'admin1', email: 'a@x' }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminCors: () => ({}), buildAdminJsonCors: () => ({}) }));

function makeDb() {
  const snapOf = (path: string) => {
    const id = path.split('/')[1];
    return seed[path]
      ? { id, exists: true, data: () => ({ ...seed[path] }) }
      : { id, exists: false, data: () => undefined };
  };
  const docsOf = (col: string) => Object.keys(seed)
    .filter((p) => p.startsWith(`${col}/`) && p.split('/').length === 2)
    .map((p) => snapOf(p));
  const query = (col: string, filter: any = null, max: number | null = null): any => ({
    orderBy: () => query(col, filter, max),
    limit: (n: number) => query(col, filter, n),
    where: (field: string, op: string, value: any) => query(col, { field, op, value }, max),
    get: async () => {
      if (col === 'bookings' && fail.paypal) throw new Error('bookings read down');
      if (col === 'pending_bookings' && filter && fail.link) throw new Error('link query down');
      let docs = docsOf(col);
      if (filter) {
        docs = docs.filter((d) => (filter.op === 'in'
          ? filter.value.includes(d.data()![filter.field])
          : d.data()![filter.field] === filter.value));
      }
      docs.sort((a, b) => (Number(b.data()!.createdAt) || 0) - (Number(a.data()!.createdAt) || 0));
      if (max !== null) docs = docs.slice(0, max);
      return { docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
    },
  });
  return {
    collection: (col: string) => ({ ...query(col), doc: (id: string) => ({ path: `${col}/${id}`, get: async () => snapOf(`${col}/${id}`) }) }),
    getAll: async (...refs: { path: string }[]) => {
      if (fail.link) throw new Error('getAll down');
      return refs.map((r) => snapOf(r.path));
    },
  };
}
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => makeDb() }));

const { default: handler } = await import('../../api/admin-all-bookings.js');

async function list(limit?: number) {
  const out = { statusCode: 0, body: '' };
  const res = { writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
  await handler({ method: 'GET', url: `/api/admin-all-bookings${limit ? `?limit=${limit}` : ''}`, headers: { host: 'unit.test' } } as any, res as any);
  return JSON.parse(out.body).data;
}
const paypal = (over: Record<string, any> = {}) => ({
  status: 'CONFIRMED', captureID: 'CAP-1', amountUSD: '100.00', amountKRW: 135000, paymentVerified: true,
  paypalEnvironment: 'live', userEmail: 'cust@x.com', productType: 'airport_seoul', createdAt: 300, ...over,
});

beforeEach(() => {
  fail = {};
  seed = {
    'pending_bookings/CT-9': { productType: 'tour', priceKRW: 50000, status: 'AWAITING_VERIFICATION', createdAt: 200 },
    'mood_bookings/M-1': { serviceType: 'vehicle', durationHours: 3, amountKRW: 90000, status: 'confirmed', createdAt: 100 },
    'bookings/ORD-1': paypal(),
  };
});

describe('admin-all-bookings — PayPal bookings', () => {
  it('merges the three sources newest first and counts paypal', async () => {
    const data = await list();
    expect(data.items.map((x: any) => `${x.kind}:${x.id}`)).toEqual(['paypal:ORD-1', 'pending:CT-9', 'mood:M-1']);
    expect(data.counts).toMatchObject({ paypal: 1, mood: 1, cocotrip: 2 });
    expect(data.items[0]).toMatchObject({ source: 'cocotrip', kind: 'paypal', bookingRef: 'ORD-1', priceUSD: 100, refundable: true, isTest: false, linkedPendingRef: null });
  });

  it('a linked pending (paypalTransactionId) represents the booking — one row, no PayPal row; no paymentVerified leak into isTest', async () => {
    seed['bookings/ORD-1'] = paypal({ paymentVerified: undefined });
    seed['pending_bookings/CT-1'] = { productType: 'tour', priceKRW: 135000, status: 'CONFIRMED', paypalTransactionId: 'ORD-1', createdAt: 250 };
    const data = await list();
    const rows = data.items.filter((x: any) => x.id === 'ORD-1' || x.id === 'CT-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'pending', id: 'CT-1', isTest: false });
  });

  it('an explicit test signal on the PayPal doc is ORed into the representative pending row', async () => {
    seed['bookings/ORD-1'] = paypal({ paypalEnvironment: 'sandbox' });
    seed['pending_bookings/CT-1'] = { productType: 'tour', priceKRW: 135000, status: 'CONFIRMED', paypalTransactionId: 'ORD-1', createdAt: 250 };
    const data = await list();
    expect(data.items.find((x: any) => x.id === 'CT-1')).toMatchObject({ kind: 'pending', isTest: true });
  });

  it('a linked pending outside the list limit is still included (reverse lookup independent of limit)', async () => {
    seed['pending_bookings/CT-NEW'] = { productType: 'tour', priceKRW: 1, status: 'AWAITING_VERIFICATION', createdAt: 999 };
    seed['pending_bookings/CT-OLD'] = { productType: 'tour', priceKRW: 135000, status: 'CONFIRMED', paypalTransactionId: 'ORD-1', createdAt: 1 };
    const data = await list(1);
    const ids = data.items.map((x: any) => x.id);
    expect(ids).toContain('CT-OLD');
    expect(ids).not.toContain('ORD-1');
  });

  it('same-id link path: pending_bookings/{bookingsId} exists → pending row only', async () => {
    seed['pending_bookings/ORD-1'] = { productType: 'tour', priceKRW: 135000, status: 'CONFIRMED', createdAt: 5 };
    const data = await list();
    const rows = data.items.filter((x: any) => x.id === 'ORD-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('pending');
  });

  it('link lookup failure → every PayPal row refundable:false + linkLookupFailed, partialErrors.pendingLink', async () => {
    fail.link = true;
    const data = await list();
    const row = data.items.find((x: any) => x.kind === 'paypal');
    expect(row).toMatchObject({ refundable: false, linkLookupFailed: true });
    expect(data.partialErrors.pendingLink).toBeTruthy();
  });

  it('refundable is false for test / unverified / refund history (refundEvents object only) / cart child / non-CONFIRMED', async () => {
    const cases: [Record<string, any>, boolean][] = [
      [{ paypalEnvironment: 'sandbox' }, true],
      [{ paymentVerified: undefined }, false],
      [{ refundEvents: { R1: { usd: 10 } } }, false],
      [{ refundID: 'R-OLD' }, false],
      [{ parentOrderID: 'CART-1' }, false],
      [{ status: 'CANCELED' }, false],
      [{ provider: 'braintree' }, false],
    ];
    for (const [over, expectTest] of cases) {
      seed['bookings/ORD-1'] = paypal(over);
      const row = (await list()).items.find((x: any) => x.kind === 'paypal');
      expect(row.refundable, JSON.stringify(over)).toBe(false);
      expect(row.isTest, JSON.stringify(over)).toBe(expectTest);
    }
  });

  it('a failed bookings read → partialErrors.paypal, other sources still listed', async () => {
    fail.paypal = true;
    const data = await list();
    expect(data.partialErrors.paypal).toBeTruthy();
    expect(data.items.map((x: any) => x.kind).sort()).toEqual(['mood', 'pending']);
  });
});
