/**
 * confirmSlotLock 이 소비한 pending 을 실제 Firestore 문서에서도 없애는지 검증.
 *
 * 🔴 왜 별도 파일인가 — slot-capacity.test.ts / bughunt-slot-pending.test.ts 의 mock 은
 *   set(merge) 를 얕은 spread({...cur, ...data})로 흉내낸다. 실제 Firestore 는 **중첩 맵을
 *   깊게 병합**하므로 JS 객체에서 키를 빼도 문서에서는 안 지워진다(slot-capacity.js 의
 *   releaseSlotLock 헤더가 이미 문서화한 성질). 얕은 mock 은 slot_pending 을 통째로 갈아끼워
 *   그 차이를 감춘다 → 여기서는 깊은 병합 mock 으로 "실제 문서에 무엇이 남는가" 를 본다.
 *
 * 잠그는 불변식(구조가 아니라 회계로 단언 — 구현 형태가 바뀌어도 유효):
 *   confirm 이 성공하면 그 주문의 pax 는 confirmed 에 **한 번만** 잡힌다.
 *   pending 에 그대로 남으면 같은 좌석을 두 번 세어 남은 정원이 사라진다(오차단 매출손실).
 */
import { describe, it, expect } from 'vitest';
import {
  acquireSlotLock,
  confirmSlotLock,
  summarizeSlot,
} from '../../api/_shared/slot-capacity.js';

const PATH = 'tour_availability/t1/dates/2026-09-01';
const base = { tourId: 't1', date: '2026-09-01', slotId: 'slot-a' };

type DocData = Record<string, unknown>;
interface DocRef { path: string }
interface MockTx {
  get(ref: DocRef): Promise<{ exists: boolean; data: () => DocData }>;
  set(ref: DocRef, data: DocData, opts?: { merge?: boolean }): void;
}

function isPlainObject(v: unknown): v is DocData {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Firestore set(data, {merge:true}) 의 중첩 맵 깊은 병합. 키 삭제는 일어나지 않는다. */
function deepMerge(target: DocData, patch: DocData): DocData {
  const out: DocData = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function makeFirestoreLikeDb() {
  const store = new Map<string, DocData>();
  return {
    doc: (path: string): DocRef => ({ path }),
    async runTransaction(fn: (tx: MockTx) => Promise<unknown>) {
      const tx: MockTx = {
        get: (ref) => {
          const cur = store.get(ref.path);
          return Promise.resolve({
            exists: cur !== undefined,
            data: () => structuredClone(cur || {}),
          });
        },
        set: (ref, data, opts = {}) => {
          const cur = store.get(ref.path);
          store.set(
            ref.path,
            opts.merge && cur ? deepMerge(cur, structuredClone(data)) : structuredClone(data),
          );
        },
      };
      return fn(tx);
    },
    _peek: (): DocData => store.get(PATH) || {},
  };
}

describe('confirmSlotLock — 소비한 pending 이 실제 문서에서도 사라진다 (깊은 병합)', () => {
  it('PRELOCK → 실제 orderId confirm 후 pending 잔류 0 (단건·cart 공통 흐름)', async () => {
    const db = makeFirestoreLikeDb();
    // createPaypalOrder / createCartOrder 는 PayPal orderId 가 아직 없어 PRELOCK 키로 잡는다.
    await acquireSlotLock({ ...base, adminDb: db, pax: 4, capacity: 7, orderId: 'PRELOCK-1' });
    // capture 는 실제 PayPal orderId 로 confirm → 키 불일치 경로(활성 pending 소비).
    await confirmSlotLock({ ...base, adminDb: db, pax: 4, capacity: 7, orderId: 'PAYPAL-ORDER-1' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 4, pending: 0, total: 4 });
  });

  it('confirm 뒤 남은 정원으로 다음 손님이 예약된다 (오차단 없음)', async () => {
    const db = makeFirestoreLikeDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 4, capacity: 7, orderId: 'PRELOCK-1' });
    await confirmSlotLock({ ...base, adminDb: db, pax: 4, capacity: 7, orderId: 'PAYPAL-ORDER-1' });

    // 정원 7 - 확정 4 = 3 자리. 다음 손님 3명은 통과해야 한다.
    const next = await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'PRELOCK-2' });
    expect(next.ok).toBe(true);
    expect(next.remaining).toBe(0);
  });

  it('같은 orderId 로 전량 confirm 해도 pending 잔류 0', async () => {
    const db = makeFirestoreLikeDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-1' });
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-1' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 2, pending: 0, total: 2 });
  });

  it('부분 confirm 은 나머지 pending 을 보존한다 (기존 동작 회귀 가드)', async () => {
    const db = makeFirestoreLikeDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 5, capacity: 10, orderId: 'ORD-1' });
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 10, orderId: 'ORD-1' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 2, pending: 3, total: 5 });
  });

  it('다른 주문의 활성 pending 은 confirm 이 건드리지 않는다', async () => {
    const db = makeFirestoreLikeDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 10, orderId: 'PRELOCK-A' });
    await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 10, orderId: 'PRELOCK-B' });
    // A 만 결제 완료 — B(3명)는 아직 결제 중이라 좌석을 계속 잡고 있어야 한다.
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 10, orderId: 'PAYPAL-A' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 2, pending: 3, total: 5 });
  });
});
