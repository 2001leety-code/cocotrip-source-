import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ records: [] as { id: string; value: Record<string, unknown> }[], getDocs: vi.fn(), setDoc: vi.fn() }));
vi.mock('../../src/lib/firebase-app.js', () => ({ app: {}, getGuestApp: vi.fn() }));
vi.mock('../../src/lib/firebase-auth.js', () => ({}));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), signInAnonymously: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), serverTimestamp: vi.fn(), doc: vi.fn(), setDoc: fake.setDoc,
  collection: (_db: unknown, ...path: string[]) => path,
  where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
  query: (path: string[], ...filters: { field: string; value: unknown }[]) => ({ path, filters }),
  getDocs: fake.getDocs,
}));
import { getAvailableAiCoupon, getRequestedAiCoupon } from '../../src/lib/firebase.js';
import { createBinding } from '../../api/_shared/ai-coupon-persistence.js';

const normal = { code: 'NORMAL', type: 'free', productScope: 'ai-plan', isUsed: false, maxDays: 3, expiresAt: Date.UTC(2099, 0, 1) };
const restoredBinding = createBinding({
  consumerUid: 'owner-a', couponDocId: 'second', consumptionId: 'old-attempt',
  requestProjection: { durationDays: 3 }, planOwnerUid: 'owner-a', verifiedHistoryUid: null, forceGuestToken: false,
});
beforeEach(() => {
  vi.clearAllMocks();
  fake.records = [{ id: 'first', value: normal }];
  fake.getDocs.mockImplementation(async ({ filters }: { filters: { field: string; value: unknown }[] }) => ({
    docs: fake.records.filter(record => filters.every(f => record.value[f.field] === f.value))
      .map(record => ({ id: record.id, data: () => record.value })),
  }));
});

describe('read-only exact requested coupon selection', () => {
  it('finds the requested legacy second code instead of substituting a normal first coupon', async () => {
    fake.records.push({ id: 'second', value: { ...normal, code: 'LEGACY', restoredAt: 0 } });
    const before = JSON.stringify(fake.records);
    expect(await getRequestedAiCoupon('owner-a', 'LEGACY', 3)).toEqual({ state: 'review' });
    expect(fake.getDocs).toHaveBeenCalledWith({ path: ['users', 'owner-a', 'coupons'], filters: [{ field: 'code', operator: '==', value: 'LEGACY' }] });
    expect(JSON.stringify(fake.records)).toBe(before);
    expect(fake.setDoc).not.toHaveBeenCalled();
  });
  it('finds a normal requested second code and retains the old nullable API', async () => {
    fake.records.push({ id: 'second', value: { ...normal, code: 'SECOND' } });
    expect(await getRequestedAiCoupon('owner-a', 'SECOND', 3)).toEqual({ state: 'available', coupon: { code: 'SECOND', maxDays: 3, expiresAt: normal.expiresAt } });
    expect(await getAvailableAiCoupon('owner-a', 3)).toEqual({ code: 'NORMAL', maxDays: 3 });
    expect(await getAvailableAiCoupon('', 3)).toBeNull();
  });
  it('keeps a structurally supported binding-backed restore as a candidate, not a completed-plan claim', async () => {
    fake.records = [{ id: 'second', value: { ...normal, restoredAt: 0, consumptionId: null, aiPlanBindingState: 'restored', aiPlanBinding: restoredBinding } }];
    expect(await getRequestedAiCoupon('owner-a', 'NORMAL', 3)).toEqual({ state: 'available', coupon: { code: 'NORMAL', maxDays: 3, expiresAt: normal.expiresAt } });
    expect(await getRequestedAiCoupon('owner-b', 'NORMAL', 3)).toEqual({ state: 'unavailable' });
  });
  it.each([
    { isUsed: true }, { isUsed: undefined }, { isRevoked: true }, { productScope: 'tour-package' },
    { type: 'percent' }, { type: 'fixed' }, { type: undefined },
    { expiresAt: 0 }, { expiresAt: 'tomorrow' }, { maxDays: 2 }, { maxDays: '3' },
    { aiPlanBinding: {} }, { aiPlanBinding: false }, { aiPlanBindingState: 'active' },
    { pendingCapture: true }, { pendingCapture: null }, { usedOrderID: 'OTHER' }, { consumptionId: 'OLD' },
    { aiPlanBinding: restoredBinding, aiPlanBindingState: 'active' },
  ])('does not advertise unusable/malformed metadata %j', patch => {
    fake.records = [{ id: 'first', value: { ...normal, ...patch } }];
    return expect(getRequestedAiCoupon('owner-a', 'NORMAL', 3)).resolves.toEqual({ state: 'unavailable' });
  });
  it.each(['', ' ', 'MISSING'])('never turns explicit code %j into none', async code => {
    expect(await getRequestedAiCoupon('owner-a', code, 3)).toEqual({ state: 'unavailable' });
  });
  it('rejects ambiguous duplicate codes', async () => {
    fake.records.push({ id: 'second', value: { ...normal } });
    expect(await getRequestedAiCoupon('owner-a', 'NORMAL', 3)).toEqual({ state: 'unavailable' });
  });
  it('keeps read failures distinct from absence without writes', async () => {
    fake.getDocs.mockRejectedValue(new Error('offline'));
    expect(await getRequestedAiCoupon('owner-a', 'NORMAL', 3)).toEqual({ state: 'error' });
    expect(fake.setDoc).not.toHaveBeenCalled();
  });
});
