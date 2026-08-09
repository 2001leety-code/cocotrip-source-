// @vitest-environment jsdom
//
// 회귀 잠금 (2026-08-10) — 홈 상단 "다가오는 여행" 스트립이 이전 로그인 사용자의
// 여행 제목을 다음 사용자에게 보여주던 문제 (PR #1272 Codex 독립검수 P2-1).
//
// 원인: useNextTrip 이 조회 결과만 state 에 담고 "누구를 조회한 결과인지" 를 담지
//   않았다. 같은 SPA 안에서 A 로그아웃 → B 로그인 하면 user 는 즉시 B 가 되지만
//   state 는 아직 A 의 행을 들고 있고, 렌더 가드가 `user ? nextTrip : null` 이라
//   "B 로 로그인한 화면에 A 의 여행 제목" 이 그대로 통과했다.
//
//   그 창이 닫히는 것은 B 의 Firestore 조회가 성공적으로 값을 채워 넣을 때뿐이다.
//   느린 응답이면 그 사이 내내 보이고, 빈 결과면 resolve 될 때까지 보이고,
//   오류면 catch 가 state 를 건드리지 않으므로 **영원히** 보인다.
//
// 그래서 여기서 잠그는 계약은 하나다 — 화면에 나가는 여행은 지금 로그인한 uid 로
// 조회한 결과일 때만 나간다. 조회 전/조회 중/빈 결과/오류는 전부 null.
//
// ⚠️ firebase/firestore·@/lib/firebase 를 mock 하는 이유: 실제 모듈을 끌어오면 env 가
//    없는 CI 에서 수집 단계가 통째로 죽는다(선례 PR #1172).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

void React;

type FakeUser = { uid: string } | null;

let currentUser: FakeUser = null;
const getDocsMock = vi.fn();

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, loading: false, error: null }),
}));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (...a: unknown[]) => ({ _collection: a }),
  query: (...a: unknown[]) => ({ _query: a }),
  where: (...a: unknown[]) => ({ _where: a }),
  getDocs: (...a: unknown[]) => getDocsMock(...a),
}));

const { useNextTrip } = await import('../../src/sections/home/useNextTrip');

/** Firestore QuerySnapshot stand-in — only `forEach` is used by the hook. */
function snapshotOf(rows: { title: string; startDate: string }[]) {
  return {
    forEach(cb: (d: { data: () => unknown }) => void) {
      rows.forEach((r) =>
        cb({ data: () => ({ input: { startDate: r.startDate }, itinerary: { tour_title: r.title } }) }),
      );
    },
  };
}

const A_TRIP = { title: 'A 의 부산 3일', startDate: '2030-03-01' };
const B_TRIP = { title: 'B 의 제주 5일', startDate: '2030-04-01' };

/** Never settles — stands in for a slow query / one still in flight. */
const pending = () => new Promise<never>(() => {});

beforeEach(() => {
  currentUser = null;
  getDocsMock.mockReset();
});
afterEach(() => cleanup());

describe('useNextTrip — 조회 결과는 조회한 uid 에만 속한다', () => {
  it('본인 여행은 정상 노출되고, 가장 가까운 날짜가 선택된다', async () => {
    currentUser = { uid: 'A' };
    getDocsMock.mockResolvedValue(
      snapshotOf([{ title: '먼 여행', startDate: '2030-12-01' }, A_TRIP]),
    );

    const { result } = renderHook(() => useNextTrip());
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));
  });

  it('A → B 계정 전환 중 B 의 조회가 느리면 A 의 여행이 보이지 않는다', async () => {
    currentUser = { uid: 'A' };
    getDocsMock.mockResolvedValue(snapshotOf([A_TRIP]));
    const { result, rerender } = renderHook(() => useNextTrip());
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));

    // B 로 전환 — 조회는 영원히 진행 중.
    getDocsMock.mockImplementation(pending);
    currentUser = { uid: 'B' };
    rerender();

    // 전환 직후 프레임에서 이미 A 가 사라져 있어야 한다. 나중에 사라지는 것으로는
    // 부족하다 — 그 "나중" 이 이 버그가 사는 곳이다.
    expect(result.current).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    rerender();
    expect(result.current).toBeNull();
  });

  it('B 의 조회가 빈 결과여도 A 의 여행이 보이지 않는다', async () => {
    currentUser = { uid: 'A' };
    getDocsMock.mockResolvedValue(snapshotOf([A_TRIP]));
    const { result, rerender } = renderHook(() => useNextTrip());
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));

    getDocsMock.mockResolvedValue(snapshotOf([]));
    currentUser = { uid: 'B' };
    rerender();

    expect(result.current).toBeNull();
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(2));
    rerender();
    expect(result.current).toBeNull();
  });

  it('B 의 조회가 실패해도 A 의 여행이 보이지 않는다 (catch 가 state 를 안 건드림)', async () => {
    currentUser = { uid: 'A' };
    getDocsMock.mockResolvedValue(snapshotOf([A_TRIP]));
    const { result, rerender } = renderHook(() => useNextTrip());
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));

    getDocsMock.mockRejectedValue(new Error('permission-denied'));
    currentUser = { uid: 'B' };
    rerender();

    expect(result.current).toBeNull();
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(2));
    rerender();
    expect(result.current).toBeNull();
  });

  it('B 의 조회가 끝나면 B 의 여행이 보인다 (막기만 하고 못 보여주면 회귀)', async () => {
    currentUser = { uid: 'A' };
    getDocsMock.mockResolvedValue(snapshotOf([A_TRIP]));
    const { result, rerender } = renderHook(() => useNextTrip());
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));

    getDocsMock.mockResolvedValue(snapshotOf([B_TRIP]));
    currentUser = { uid: 'B' };
    rerender();
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current?.title).toBe(B_TRIP.title));
  });

  it('로그아웃하면 즉시 사라진다', async () => {
    currentUser = { uid: 'A' };
    getDocsMock.mockResolvedValue(snapshotOf([A_TRIP]));
    const { result, rerender } = renderHook(() => useNextTrip());
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));

    currentUser = null;
    rerender();
    expect(result.current).toBeNull();
  });

  it('로그아웃 → 같은 계정 재로그인은 조회가 끝난 뒤에만 다시 보인다', async () => {
    currentUser = { uid: 'A' };
    getDocsMock.mockResolvedValue(snapshotOf([A_TRIP]));
    const { result, rerender } = renderHook(() => useNextTrip());
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));

    currentUser = null;
    rerender();
    expect(result.current).toBeNull();

    getDocsMock.mockResolvedValue(snapshotOf([A_TRIP]));
    currentUser = { uid: 'A' };
    rerender();
    await waitFor(() => expect(result.current?.title).toBe(A_TRIP.title));
  });
});
