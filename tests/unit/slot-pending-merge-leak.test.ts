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
  sweepExpiredPending,
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

function makeFirestoreLikeDb(initial?: DocData) {
  const store = new Map<string, DocData>();
  if (initial) store.set(PATH, structuredClone(initial));
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

// ─────────────────────────────────────────────────────────────────────────────
// 구형 단일 pending 구조(버그#18 이전) — merge 는 루트 스칼라 키도 못 지운다.
//
//   구형: slot_pending[slotId] = { count, expiresAt, orderId }
//   신규: slot_pending[slotId] = { [orderId]: { count, expiresAt } }
//
// merge 로 신규 엔트리를 쓰면 두 구조가 **한 맵에 섞인 hybrid** 가 된다. 삭제가 불가능한
// 이상 hybrid 는 피할 수 없는 상태이므로, 읽기(normalize)와 쓰기(confirm) 둘 다 이를
// 다뤄야 한다. 못 다루면 두 방향으로 모두 틀린다:
//   - 루트 count 가 살아남아 confirm 뒤에도 10분 오차단(매출손실)
//   - 반대로 루트가 만료되면 nested 신규 pending 이 통째로 안 보여 과소집계(오버부킹)
// ─────────────────────────────────────────────────────────────────────────────
describe('구형 단일 pending 구조 — confirm 뒤 회계 0 (hybrid 문서)', () => {
  const future = () => new Date(Date.now() + 9 * 60_000).toISOString();

  it('구형 doc: PRELOCK 없이 실 orderId 로 confirm → pending 잔류 0', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: { 'slot-a': { count: 4, expiresAt: future(), orderId: 'PRELOCK-OLD' } },
    });
    await confirmSlotLock({ ...base, adminDb: db, pax: 4, capacity: 7, orderId: 'PAYPAL-ORDER-1' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 4, pending: 0, total: 4 });
  });

  it('구형 doc: confirm 뒤 남은 정원으로 다음 손님이 예약된다', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: { 'slot-a': { count: 4, expiresAt: future(), orderId: 'PRELOCK-OLD' } },
    });
    await confirmSlotLock({ ...base, adminDb: db, pax: 4, capacity: 7, orderId: 'PAYPAL-ORDER-1' });

    const next = await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'PRELOCK-2' });
    expect(next.ok).toBe(true);
    expect(next.remaining).toBe(0);
  });

  it('구형 doc + 같은 orderId 매칭 confirm → pending 잔류 0', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: { 'slot-a': { count: 2, expiresAt: future(), orderId: 'ORD-1' } },
    });
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-1' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 2, pending: 0, total: 2 });
  });

  it('구형 doc 부분 confirm → 나머지는 pending 으로 보존', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: { 'slot-a': { count: 5, expiresAt: future(), orderId: 'PRELOCK-OLD' } },
    });
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 10, orderId: 'PAYPAL-ORDER-1' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 2, pending: 3, total: 5 });
  });

  it('hybrid doc: 구형 루트 + 신규 다른 주문 엔트리 — 내 것만 소비, 남의 것 보존', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: {
        'slot-a': {
          count: 2, expiresAt: future(), orderId: 'PRELOCK-OLD', // 구형 루트(내 주문 2명)
          'PRELOCK-NEW': { count: 3, expiresAt: future() },       // 신규 구조 다른 주문 3명
        },
      },
    });
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 10, orderId: 'PAYPAL-ORDER-1' });

    // 구형 루트 2명만 소비, 다른 주문 3명은 계속 좌석 보유.
    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 2, pending: 3, total: 5 });
  });

  it('구형 doc confirm 이 다른 slotId 의 활성 pending 을 건드리지 않는다', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: {
        'slot-a': { count: 2, expiresAt: future(), orderId: 'PRELOCK-OLD' },
        'slot-b': { count: 3, expiresAt: future(), orderId: 'PRELOCK-B' },       // 구형
        'slot-c': { 'PRELOCK-C': { count: 1, expiresAt: future() } },            // 신규
      },
    });
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 10, orderId: 'PAYPAL-ORDER-1' });

    const doc = db._peek();
    expect(summarizeSlot(doc, 'slot-a', Date.now())).toEqual({ confirmed: 2, pending: 0, total: 2 });
    expect(summarizeSlot(doc, 'slot-b', Date.now())).toEqual({ confirmed: 0, pending: 3, total: 3 });
    expect(summarizeSlot(doc, 'slot-c', Date.now())).toEqual({ confirmed: 0, pending: 1, total: 1 });
  });

  it('구형 doc 에 acquire 하면 옛 좌석과 새 좌석이 각각 한 번씩만 세어진다', async () => {
    // acquire 도 활성 엔트리를 orderId 키로 재방출한다 — 루트를 무력화하지 않으면
    // 같은 2명이 루트와 nested 양쪽에서 세어져 정원이 조기 소진된다.
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: { 'slot-a': { count: 2, expiresAt: future(), orderId: 'PRELOCK-OLD' } },
    });
    await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'PRELOCK-NEW' });

    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 0, pending: 5, total: 5 });
    // 남은 2자리는 실제로 팔려야 한다.
    const next = await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'PRELOCK-3' });
    expect(next.ok).toBe(true);
  });

  it('sweep 이 구형 doc 의 활성 pending 을 두 번 세게 만들지 않는다', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: {
        'slot-a': { count: 2, expiresAt: future(), orderId: 'PRELOCK-OLD' },              // 활성 구형
        'slot-z': { count: 1, expiresAt: new Date(Date.now() - 60_000).toISOString() },   // 만료 → sweep 발동
      },
    });
    const r = await sweepExpiredPending({ adminDb: db, tourId: 't1', date: '2026-09-01' });
    expect(r.swept).toBeGreaterThan(0);

    // 활성 구형 슬롯은 그대로 2명 — sweep 이 nested 사본을 만들어 4명이 되면 안 된다.
    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 0, pending: 2, total: 2 });
  });

  it('hybrid doc: 구형 루트가 만료돼도 신규 엔트리 pending 이 보인다 (과소집계=오버부킹 차단)', async () => {
    const db = makeFirestoreLikeDb({
      tourId: 't1', date: '2026-09-01', status: 'available',
      slot_pending: {
        'slot-a': {
          count: 4, expiresAt: new Date(Date.now() - 60_000).toISOString(), orderId: 'OLD-EXPIRED',
          'PRELOCK-LIVE': { count: 6, expiresAt: future() },
        },
      },
    });
    // 만료된 구형 루트는 0, 살아있는 신규 6명은 반드시 보여야 한다.
    expect(summarizeSlot(db._peek(), 'slot-a', Date.now()))
      .toEqual({ confirmed: 0, pending: 6, total: 6 });
    // 정원 7 에 6명이 잡혀 있으므로 2명은 거절돼야 한다.
    await expect(
      acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'PRELOCK-X' }),
    ).rejects.toThrow(/Slot full/);
  });
});
