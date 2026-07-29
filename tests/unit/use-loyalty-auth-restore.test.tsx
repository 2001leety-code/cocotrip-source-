// @vitest-environment jsdom
//
// 회귀 잠금 (2026-07-28) — 마이페이지가 Bronze·0코인·0예약을 먼저 보여주던 문제.
//
// 원인: useAuth 는 컴포넌트마다 새 인스턴스라 항상 user=null, loading=true 로 시작한다.
//   useLoyalty 는 그 구간을 "비로그인"으로 보고 loading=false 를 켰고, 호출부가
//   loyalty=null 을 Bronze·0 으로 대신 그렸다. 회원 문서가 도착하면 값이 튀었다.
//
// 고친 방식: loading 을 상태로 들지 않고 파생한다.
//   loading = authLoading || (로그인했는데 그 uid 문서가 아직 안 옴)
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

void React;

const authHolder: { user: { uid: string; email?: string } | null; loading: boolean } = {
  user: null, loading: true,
};
/** onSnapshot 구독 콜백을 테스트가 직접 발화시키기 위한 보관소. */
const snapCallbacks: Array<(snap: unknown) => void> = [];
/** FAIL-13 이후 세 갈래(회원문서·쿠폰·이력)가 모두 도착해야 노출된다 — 나머지도 발화시킨다. */
const subCallbacks: Array<(snap: unknown) => void> = [];

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ ...authHolder }) }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('../../src/lib/admin', () => ({ isAdminEmail: () => false }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _c: string, uid: string) => ({ _kind: 'userDoc', uid }),
  collection: (_db: unknown, _c: string, uid: string, sub: string) => ({ _kind: sub, uid }),
  query: (ref: unknown) => ref,
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (ref: { _kind?: string; uid?: string }, cb: (s: unknown) => void) => {
    if (ref?._kind === 'userDoc') snapCallbacks.push(cb);
    else subCallbacks.push(cb);
    return () => {};
  },
}));

const { useLoyalty } = await import('../../src/hooks/useLoyalty');

/** 회원 문서 + 빈 하위 컬렉션 도착을 흉내 낸다(이 파일의 관심사는 등급 표시다). */
function emitUserDoc(uid: string, data: Record<string, unknown> | undefined) {
  act(() => {
    for (const cb of snapCallbacks) cb({ id: uid, data: () => data });
    for (const cb of subCallbacks) cb({ docs: [] });
  });
}

beforeEach(() => {
  authHolder.user = null;
  authHolder.loading = true;
  snapCallbacks.length = 0;
  subCallbacks.length = 0;
});

describe('useLoyalty — 인증 복원 중 잘못된 값 노출 금지', () => {
  it('인증 복원 중에는 loading 이 유지된다 (Bronze·0 을 그릴 틈을 주지 않는다)', () => {
    const { result } = renderHook(() => useLoyalty());
    expect(result.current.loading).toBe(true);
    expect(result.current.loyalty).toBeNull();
  });

  it('로그인 확정 후 문서가 오기 전까지도 loading 이다', async () => {
    const { result, rerender } = renderHook(() => useLoyalty());
    authHolder.user = { uid: 'u1' };
    authHolder.loading = false;
    rerender();
    expect(result.current.loading).toBe(true);   // 문서 미도착
    expect(result.current.loyalty).toBeNull();

    emitUserDoc('u1', { tier: 'Platinum', tripCoins: 756986, totalSpentUSD: 253205, bookingCount: 260 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loyalty?.tier).toBe('Platinum');
    expect(result.current.loyalty?.tripCoins).toBe(756986);
  });

  it('비로그인 확정이면 loading 이 끝난다 (무한 스켈레톤 방지)', () => {
    authHolder.user = null;
    authHolder.loading = false;
    const { result } = renderHook(() => useLoyalty());
    expect(result.current.loading).toBe(false);
    expect(result.current.loyalty).toBeNull();
  });

  it('회원 문서가 아직 없는 신규 계정도 로딩이 끝난다', async () => {
    authHolder.user = { uid: 'new1' };
    authHolder.loading = false;
    const { result } = renderHook(() => useLoyalty());
    emitUserDoc('new1', undefined);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('계정이 바뀌면 이전 계정 값을 그대로 보여주지 않는다', async () => {
    authHolder.user = { uid: 'u1' };
    authHolder.loading = false;
    const { result, rerender } = renderHook(() => useLoyalty());
    emitUserDoc('u1', { tier: 'Platinum', tripCoins: 999 });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 계정 전환 — 새 uid 문서가 오기 전에는 다시 로딩이어야 한다.
    snapCallbacks.length = 0;
    subCallbacks.length = 0;
    authHolder.user = { uid: 'u2' };
    rerender();
    expect(result.current.loading).toBe(true);
  });
});
