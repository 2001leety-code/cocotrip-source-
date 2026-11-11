// @vitest-environment jsdom
// Onboarding r1 D2 — a restored session (no new sign-in) still self-recovers missing signup coupons:
// useLoyalty's member-document subscription asks ensureOnboardingCoupons for the current non-anonymous user.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

void React;

const h = vi.hoisted(() => ({
  user: { uid: 'u1' } as { uid: string } | null,
  currentUser: { uid: 'u1', isAnonymous: false } as { uid: string; isAnonymous: boolean } | null,
  ensure: vi.fn(async () => undefined),
  userDocCbs: [] as Array<(s: unknown) => void>,
}));

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock('../../src/lib/admin', () => ({ isAdminEmail: () => false }));
vi.mock('../../src/lib/firebase', () => ({
  db: {},
  get auth() { return { currentUser: h.currentUser }; },
  ensureOnboardingCoupons: h.ensure,
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({ _kind: 'userDoc' }),
  collection: () => ({}), query: (r: unknown) => r, orderBy: () => ({}), limit: () => ({}),
  onSnapshot: (ref: { _kind?: string }, cb: (s: unknown) => void) => {
    if (ref?._kind === 'userDoc') h.userDocCbs.push(cb);
    return () => {};
  },
}));

const { useLoyalty } = await import('../../src/hooks/useLoyalty');

async function emit(data: Record<string, unknown>) {
  renderHook(() => useLoyalty());
  await act(async () => { await vi.dynamicImportSettled(); });
  act(() => { h.userDocCbs.forEach(cb => cb({ data: () => data })); });
  await act(async () => { await vi.dynamicImportSettled(); });
}

beforeEach(() => {
  h.ensure.mockClear();
  h.userDocCbs.length = 0;
  h.user = { uid: 'u1' };
  h.currentUser = { uid: 'u1', isAnonymous: false };
});

describe('useLoyalty signup coupon self-recovery', () => {
  it('member doc without the marker → ensureOnboardingCoupons(currentUser), not awaited by the UI', async () => {
    await emit({ tier: 'Bronze' });
    expect(h.ensure).toHaveBeenCalledExactlyOnceWith(h.currentUser);
  });

  it('marker true → no call', async () => {
    await emit({ tier: 'Bronze', onboardingCouponsIssued: true });
    expect(h.ensure).not.toHaveBeenCalled();
  });

  it('auth user changed to a different uid before the import settled → no call', async () => {
    h.currentUser = { uid: 'someone-else', isAnonymous: false };
    await emit({ tier: 'Bronze' });
    expect(h.ensure).not.toHaveBeenCalled();
  });
});
