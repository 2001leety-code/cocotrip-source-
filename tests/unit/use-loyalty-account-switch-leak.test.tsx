// @vitest-environment jsdom
//
// 🔴 FAIL-13 회귀 잠금 (2026-07-29) — 계정 전환 시 이전 계정 개인정보 잔상.
//
// 이전 구조: 회원 문서 하나만 `loadedUid` 로 추적했다.
//   A 로 로그인해 전부 로드된 상태에서 B 로 바뀌면,
//   B 의 회원 문서만 먼저 도착해도 ready 가 켜졌다.
//   그 순간 쿠폰·적립 이력 상태에는 아직 **A 의 값**이 들어 있었다.
//   B 의 회원 문서가 아예 없으면 setLoyalty 가 호출되지 않아 A 의 등급·코인도 남았다.
//
// 고친 방식: 값마다 "어느 uid 에서 받았는지"를 함께 저장하고,
//   세 갈래가 전부 현재 uid 것일 때만 노출한다.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

void React;

const authHolder: { user: { uid: string; email?: string } | null; loading: boolean } = {
  user: null, loading: false,
};

type Cb = (snap: unknown) => void;
type ErrCb = (e: unknown) => void;
/** uid + 갈래별로 콜백을 보관해 **도착 순서를 테스트가 직접 정한다.** */
const subs: Array<{ uid: string; kind: string; cb: Cb; err: ErrCb; live: boolean }> = [];

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ ...authHolder }) }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('../../src/lib/admin', () => ({ isAdminEmail: () => false }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _c: string, uid: string) => ({ _kind: 'user', uid }),
  collection: (_db: unknown, _c: string, uid: string, sub: string) => ({ _kind: sub, uid }),
  query: (ref: unknown) => ref,
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (ref: { _kind: string; uid: string }, cb: Cb, err: ErrCb) => {
    const entry = { uid: ref.uid, kind: ref._kind, cb, err, live: true };
    subs.push(entry);
    return () => { entry.live = false; };
  },
}));

const { useLoyalty } = await import('../../src/hooks/useLoyalty');

const USERS: Record<string, Record<string, unknown>> = {
  A: { tier: 'Platinum', tripCoins: 756986, totalSpentUSD: 253204.54, bookingCount: 260 },
  B: { tier: 'Silver', tripCoins: 120, totalSpentUSD: 300, bookingCount: 2 },
};
const FAR_FUTURE = Date.now() + 86_400_000;
const COUPONS: Record<string, Array<Record<string, unknown>>> = {
  A: [
    { id: 'a-live', code: 'A-LIVE', expiresAt: FAR_FUTURE, isUsed: false },
    { id: 'a-revoked', code: 'A-REV', expiresAt: FAR_FUTURE, isUsed: false, isRevoked: true },
  ],
  B: [{ id: 'b-live', code: 'B-LIVE', expiresAt: FAR_FUTURE, isUsed: false }],
};
const HISTORY: Record<string, Array<Record<string, unknown>>> = {
  A: [{ id: 'a-h1', type: 'earn', amount: 2829, description: 'AI Plan: Seoul ($942.86)' }],
  B: [{ id: 'b-h1', type: 'earn', amount: 10, description: 'AI Planner' }],
};

/** 한 갈래만 골라 발화시킨다 — 도착 순서 조합을 만들기 위해서. */
function emit(uid: string, kind: 'user' | 'coupons' | 'pointHistory') {
  act(() => {
    for (const s of subs) {
      if (!s.live || s.uid !== uid || s.kind !== kind) continue;
      if (kind === 'user') s.cb({ id: uid, data: () => USERS[uid] });
      else {
        const rows = kind === 'coupons' ? COUPONS[uid] : HISTORY[uid];
        s.cb({ docs: (rows || []).map(r => ({ id: r.id as string, data: () => r })) });
      }
    }
  });
}

/** 회원 문서가 **없는** 계정. */
function emitMissingUserDoc(uid: string) {
  act(() => {
    for (const s of subs) {
      if (s.live && s.uid === uid && s.kind === 'user') s.cb({ id: uid, data: () => undefined });
    }
  });
}

function emitError(uid: string, kind: string) {
  act(() => {
    for (const s of subs) {
      if (s.live && s.uid === uid && s.kind === kind) s.err(new Error('permission-denied'));
    }
  });
}

const ORDERS: Array<Array<'user' | 'coupons' | 'pointHistory'>> = [
  ['user', 'coupons', 'pointHistory'],
  ['user', 'pointHistory', 'coupons'],
  ['coupons', 'user', 'pointHistory'],
  ['coupons', 'pointHistory', 'user'],
  ['pointHistory', 'user', 'coupons'],
  ['pointHistory', 'coupons', 'user'],
];

beforeEach(() => {
  authHolder.user = null;
  authHolder.loading = false;
  subs.length = 0;
});

/** A 로 로그인해 세 갈래가 전부 도착한 상태를 만든다. */
function loadFullyAsA() {
  authHolder.user = { uid: 'A' };
  const h = renderHook(() => useLoyalty());
  for (const k of ORDERS[0]) emit('A', k);
  return h;
}

describe('useLoyalty — 계정 전환 개인정보 잔상 (FAIL-13)', () => {
  it('A 전부 로드 → B 회원 문서만 도착: A 쿠폰·이력이 0개로 보인다', async () => {
    const { result, rerender } = loadFullyAsA();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.coupons).toHaveLength(2);
    expect(result.current.pointHistory).toHaveLength(1);

    authHolder.user = { uid: 'B' };
    rerender();
    emit('B', 'user');           // 🔴 회원 문서만 도착

    expect(result.current.coupons).toHaveLength(0);
    expect(result.current.activeCoupons).toHaveLength(0);
    expect(result.current.pointHistory).toHaveLength(0);
    expect(result.current.loading).toBe(true);
  });

  it('B 회원 문서가 없어도 A 의 등급·코인이 남지 않는다', async () => {
    const { result, rerender } = loadFullyAsA();
    await waitFor(() => expect(result.current.loyalty?.tripCoins).toBe(756986));

    authHolder.user = { uid: 'B' };
    rerender();
    emitMissingUserDoc('B');
    emit('B', 'coupons');
    emit('B', 'pointHistory');

    // 세 갈래 모두 B 것으로 도착 → 노출은 되지만 값은 "없음"이어야 한다.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loyalty).toBeNull();
    expect(result.current.coupons.map(c => c.id)).toEqual(['b-live']);
  });

  it.each(ORDERS)('도착 순서 %s 에서도 계정 혼용이 없다', async (...order) => {
    const { result, rerender } = loadFullyAsA();
    await waitFor(() => expect(result.current.loading).toBe(false));

    authHolder.user = { uid: 'B' };
    rerender();
    for (const kind of order) {
      emit('B', kind);
      // 마지막 갈래 전까지는 A 자료가 단 하나도 새면 안 된다.
      const isLast = kind === order[order.length - 1];
      if (!isLast) {
        expect(result.current.coupons.some(c => c.id.startsWith('a-'))).toBe(false);
        expect(result.current.pointHistory.some(h => h.id.startsWith('a-'))).toBe(false);
        expect(result.current.loyalty?.tripCoins).not.toBe(756986);
      }
    }
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loyalty?.tier).toBe('Silver');
    expect(result.current.coupons.map(c => c.id)).toEqual(['b-live']);
    expect(result.current.pointHistory.map(h => h.id)).toEqual(['b-h1']);
  });

  it('A → 로그아웃 → B 경유도 A 자료가 남지 않는다', async () => {
    const { result, rerender } = loadFullyAsA();
    await waitFor(() => expect(result.current.loading).toBe(false));

    authHolder.user = null;                       // 로그아웃
    rerender();
    expect(result.current.loyalty).toBeNull();
    expect(result.current.coupons).toHaveLength(0);
    expect(result.current.pointHistory).toHaveLength(0);
    expect(result.current.loading).toBe(false);   // 비로그인 확정 — 무한 스켈레톤 금지

    authHolder.user = { uid: 'B' };
    rerender();
    expect(result.current.coupons).toHaveLength(0);
    for (const k of ORDERS[0]) emit('B', k);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loyalty?.tier).toBe('Silver');
  });

  it('구독 오류가 나도 이전 계정 자료가 노출되지 않는다', async () => {
    const { result, rerender } = loadFullyAsA();
    await waitFor(() => expect(result.current.coupons).toHaveLength(2));

    authHolder.user = { uid: 'B' };
    rerender();
    emit('B', 'user');
    emitError('B', 'coupons');          // 🔴 쿠폰 구독 실패
    emit('B', 'pointHistory');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.coupons).toHaveLength(0);      // A 것으로 대체되지 않는다
    expect(result.current.loyalty?.tier).toBe('Silver');
  });

  it('구독 해제 뒤 늦게 도착한 A 콜백이 B 를 덮지 못한다', async () => {
    const { result, rerender } = loadFullyAsA();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const staleA = subs.find(s => s.uid === 'A' && s.kind === 'coupons');

    authHolder.user = { uid: 'B' };
    rerender();
    for (const k of ORDERS[0]) emit('B', k);
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 해제된 A 구독이 뒤늦게 발화 — B 화면은 그대로여야 한다.
    act(() => {
      staleA?.cb({ docs: COUPONS.A.map(r => ({ id: r.id as string, data: () => r })) });
    });
    expect(result.current.coupons.map(c => c.id)).toEqual(['b-live']);
    expect(result.current.loading).toBe(false);
  });

  it('회수(isRevoked) 쿠폰은 사용 가능 목록에서 계속 빠진다', async () => {
    const { result } = loadFullyAsA();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.coupons.map(c => c.id)).toEqual(['a-live', 'a-revoked']);
    expect(result.current.activeCoupons.map(c => c.id)).toEqual(['a-live']);
  });

  it('Bronze·0 깜빡임 방지 유지 — 인증 복원 중에는 loading', () => {
    authHolder.user = null;
    authHolder.loading = true;
    const { result } = renderHook(() => useLoyalty());
    expect(result.current.loading).toBe(true);
    expect(result.current.loyalty).toBeNull();
  });
});
