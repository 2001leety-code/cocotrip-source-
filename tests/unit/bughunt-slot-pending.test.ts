/**
 * Bug #18 regression — confirmSlotLock pending 회계 누수 → 정원 오집계 (MEDIUM).
 *
 * 버그: 기존 slot_pending[slotId] 는 슬롯당 단일 엔트리({count,expiresAt,orderId})
 * 였다. 같은 슬롯에 주문 A·B 가 pre-lock 하면 count 는 paxA+paxB 로 누적되지만
 * orderId 는 마지막 주문(B)만 보존됐다. A 가 먼저 capture(confirmSlotLock) 하면
 * rawPending.orderId(=B) !== orderId(=A) → ourPending=false → confirmed 만 +paxA
 * 되고 pending 은 차감되지 않아 paxA 가 영구 잔류. summarizeSlot 이 confirmed+pending
 * 으로 capacity 를 비교하므로, 잔류 pending 이 후속 예약을 SLOT_FULL 로 오차단
 * (매출 손실) 한다.
 *
 * 수정: slot_pending 을 orderId 별 엔트리 맵
 *   slot_pending[slotId] = { [orderId]: { count, expiresAt } }
 * 으로 구조화 → acquire/confirm/sweep/summarize 가 주문별로 정확히 가감.
 * 옛 단일 엔트리도 normalizeSlotPendingEntry 로 읽기 하위호환.
 *
 * Approach: Firestore-free. 기존 slot-capacity.test.ts 와 동일한 runTransaction
 * 모킹(in-memory doc store)으로 산술/회계 로직만 격리 검증.
 */
import { describe, it, expect } from 'vitest';
import {
  acquireSlotLock,
  confirmSlotLock,
  sweepExpiredPending,
  summarizeSlot,
  normalizeSlotPendingEntry,
} from '../../api/_shared/slot-capacity.js';

interface MockSnap {
  exists: boolean;
  data: () => Record<string, unknown>;
}

function makeMockDb(initialDocs: Record<string, Record<string, unknown> | undefined> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(initialDocs)) {
    if (data !== undefined) store.set(path, structuredClone(data));
  }

  function doc(path: string) {
    return { path };
  }

  async function runTransaction(fn: (tx: any) => Promise<unknown>) {
    const tx = {
      get(ref: { path: string }): Promise<MockSnap> {
        const cur = store.get(ref.path);
        return Promise.resolve({
          exists: cur !== undefined,
          data: () => structuredClone(cur || {}),
        });
      },
      set(ref: { path: string }, data: Record<string, unknown>, opts: { merge?: boolean } = {}) {
        if (opts.merge && store.has(ref.path)) {
          const cur = store.get(ref.path)!;
          store.set(ref.path, { ...cur, ...data });
        } else {
          store.set(ref.path, structuredClone(data));
        }
      },
    };
    return fn(tx);
  }

  return {
    doc,
    runTransaction,
    _peek: (path: string) => store.get(path),
  };
}

const PATH = 'tour_availability/test-tour/dates/2026-06-01';
const base = { adminDb: undefined as any, tourId: 'test-tour', date: '2026-06-01', slotId: 'slot-a' };
const slotPending = (db: ReturnType<typeof makeMockDb>) =>
  (db._peek(PATH)!.slot_pending as any)?.['slot-a'];

// ─────────────────────────────────────────────────────────────────────────────
// normalizeSlotPendingEntry — 옛/신 구조 정규화
// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeSlotPendingEntry — 하위호환 정규화', () => {
  it('옛 단일 엔트리(orderId 보유)를 orderId 키 맵으로 변환', () => {
    const out = normalizeSlotPendingEntry({ count: 2, expiresAt: '2026-06-01T00:10:00.000Z', orderId: 'ORD-1' });
    expect(out).toEqual({ 'ORD-1': { count: 2, expiresAt: '2026-06-01T00:10:00.000Z' } });
  });
  it('옛 단일 엔트리(orderId 미보유)를 LEGACY 키로 보존', () => {
    const out = normalizeSlotPendingEntry({ count: 3 });
    expect(Object.values(out)).toEqual([{ count: 3, expiresAt: undefined }]);
  });
  it('이미 신규 맵 구조면 얕은 복제로 그대로 반환', () => {
    const src = { 'ORD-1': { count: 2, expiresAt: 'x' }, 'ORD-2': { count: 1, expiresAt: 'y' } };
    const out = normalizeSlotPendingEntry(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
  it('미존재/비객체 → 빈 맵', () => {
    expect(normalizeSlotPendingEntry(undefined)).toEqual({});
    expect(normalizeSlotPendingEntry(null)).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// summarizeSlot — 주문별 pending 합산 + 옛 구조 호환
// ─────────────────────────────────────────────────────────────────────────────
describe('summarizeSlot — orderId 별 pending 합산', () => {
  const now = 1_700_000_000_000;
  const future = new Date(now + 60_000).toISOString();
  const past = new Date(now - 60_000).toISOString();

  it('신규 구조: 여러 orderId 활성 pending 전부 합산', () => {
    const data = {
      slot_bookings: { 'slot-a': 1 },
      slot_pending: {
        'slot-a': {
          'ORD-A': { count: 2, expiresAt: future },
          'ORD-B': { count: 3, expiresAt: future },
        },
      },
    };
    expect(summarizeSlot(data, 'slot-a', now)).toEqual({ confirmed: 1, pending: 5, total: 6 });
  });

  it('신규 구조: 만료된 엔트리는 합산 제외', () => {
    const data = {
      slot_pending: {
        'slot-a': {
          'ORD-A': { count: 2, expiresAt: future },
          'ORD-B': { count: 9, expiresAt: past }, // 만료 → 제외
        },
      },
    };
    expect(summarizeSlot(data, 'slot-a', now)).toEqual({ confirmed: 0, pending: 2, total: 2 });
  });

  it('옛 단일 엔트리 구조도 동일하게 합산(하위호환)', () => {
    const data = {
      slot_bookings: { 'slot-a': 3 },
      slot_pending: { 'slot-a': { count: 2, expiresAt: future, orderId: 'ORD-1' } },
    };
    expect(summarizeSlot(data, 'slot-a', now)).toEqual({ confirmed: 3, pending: 2, total: 5 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// acquireSlotLock — orderId 별 격리 누적
// ─────────────────────────────────────────────────────────────────────────────
describe('acquireSlotLock — 주문별 엔트리 격리', () => {
  it('같은 슬롯 두 주문 → 서로 다른 orderId 키로 분리 저장(누적 합 = 정원반영)', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-A' });
    await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'ORD-B' });
    const entry = slotPending(db);
    expect(entry['ORD-A'].count).toBe(2);
    expect(entry['ORD-B'].count).toBe(3);
    // summarizeSlot 으로 본 pending 총합 = 5 (두 주문 모두 정원 반영).
    expect(summarizeSlot(db._peek(PATH)!, 'slot-a').pending).toBe(5);
  });

  it('같은 orderId 재acquire 는 해당 키만 누적(덮어쓰기 아님)', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-A' });
    await acquireSlotLock({ ...base, adminDb: db, pax: 1, capacity: 7, orderId: 'ORD-A' });
    expect(slotPending(db)['ORD-A'].count).toBe(3);
  });

  it('capacity 게이트는 모든 주문 pending 합으로 판정(2+3+pax>7 차단)', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-A' });
    await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'ORD-B' });
    await expect(
      acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'ORD-C' }),
    ).rejects.toThrow(/Slot full/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// confirmSlotLock — 버그 #18 핵심: 먼저 capture 한 주문이 pending 을 정확히 차감
// ─────────────────────────────────────────────────────────────────────────────
describe('confirmSlotLock — 주문별 정확한 pending 차감 (버그 #18)', () => {
  it('두 주문 동시 pre-lock 후 A 먼저 capture → A pending 만 소비, B pending 잔류, A 잔류 누수 0', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-A' });
    await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'ORD-B' });

    // A capture (실제 orderId 키 매칭).
    const r = await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-A' });
    expect(r.confirmed).toBe(2);

    const summary = summarizeSlot(db._peek(PATH)!, 'slot-a');
    // 핵심: confirmed=2(A 확정), pending=3(B 만 남음). 버그였다면 pending=5(A 누수)였음.
    expect(summary.confirmed).toBe(2);
    expect(summary.pending).toBe(3);
    expect(summary.total).toBe(5);

    const entry = slotPending(db);
    // A 완전 차감 — 키 제거가 아니라 만료 표시(count 0)다. Firestore set(merge) 는 중첩
    // 맵 키를 못 지우므로 삭제로 표현하면 문서에는 원래 pending 이 그대로 남는다.
    expect(entry['ORD-A'].count).toBe(0);
    expect(entry['ORD-B'].count).toBe(3); // B 무손상
  });

  it('A·B 모두 capture 후 pending 0, confirmed=합계 (overbooking/오차단 없음)', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-A' });
    await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'ORD-B' });
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-A' });
    await confirmSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'ORD-B' });
    const summary = summarizeSlot(db._peek(PATH)!, 'slot-a');
    expect(summary.confirmed).toBe(5);
    expect(summary.pending).toBe(0);
    // 두 엔트리 모두 만료 표시로 남는다(키 제거 X — merge 로는 못 지운다). 회계는 0.
    expect(Object.values(slotPending(db)).every((e) => e.count === 0)).toBe(true);
  });

  it('정상 PRELOCK 흐름: acquire=PRELOCK 키, capture=실제 PayPal orderId → 키 불일치여도 활성 pending 소비(누수 0)', async () => {
    // createPaypalOrder.js 의 실제 호출 패턴: acquire 는 PRELOCK-* 합성 키,
    // capture 는 실제 PayPal orderID. 버그였다면 pending 이 영구 잔류했음.
    const db = makeMockDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'PRELOCK-123-slot-a' });
    const r = await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'PAYPAL-REAL-1' });
    expect(r.confirmed).toBe(2);
    const summary = summarizeSlot(db._peek(PATH)!, 'slot-a');
    expect(summary.confirmed).toBe(2);
    expect(summary.pending).toBe(0); // PRELOCK pending 소비됨 — 누수 없음
    expect(slotPending(db)['PRELOCK-123-slot-a'].count).toBe(0); // 만료 표시로 무력화
  });

  it('PRELOCK 흐름 + 다른 활성 주문: capture pax 만큼만 활성 pending 소비, 나머지 잔류', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'PRELOCK-A' });
    await acquireSlotLock({ ...base, adminDb: db, pax: 3, capacity: 7, orderId: 'PRELOCK-B' });
    // 키 불일치 capture(pax=2) → 활성 pending(총 5)에서 2 소비 → 3 잔류.
    await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'PAYPAL-REAL' });
    const summary = summarizeSlot(db._peek(PATH)!, 'slot-a');
    expect(summary.confirmed).toBe(2);
    expect(summary.pending).toBe(3); // 5 - 2
  });

  it('lost-lock(전부 만료) + capacity 여유 → confirmed += pax, 만료 엔트리 정리', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_bookings: { 'slot-a': 3 },
        slot_pending: { 'slot-a': { 'ORD-1': { count: 2, expiresAt: past } } },
      },
    });
    const r = await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-1' });
    expect(r.confirmed).toBe(5);
    // 만료 pending 정리됨(회계 0). 키 자체는 만료 표시로 남는다 — merge 로는 못 지운다.
    expect(summarizeSlot(db._peek(PATH)!, 'slot-a').pending).toBe(0);
  });

  it('lost-lock + capacity 소진 → SLOT_FULL_AT_CAPTURE', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_bookings: { 'slot-a': 6 },
        slot_pending: { 'slot-a': { 'ORD-1': { count: 2, expiresAt: past } } },
      },
    });
    await expect(
      confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 7, orderId: 'ORD-1' }),
    ).rejects.toThrow(/Slot full at capture/);
  });

  it('하위호환: 옛 단일 엔트리 구조에서 capture(같은 orderId) → 정확히 차감', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        // 옛 구조: 슬롯당 단일 엔트리(count/expiresAt/orderId).
        slot_pending: { 'slot-a': { count: 5, expiresAt: future, orderId: 'ORD-1' } },
      },
    });
    const r = await confirmSlotLock({ ...base, adminDb: db, pax: 2, capacity: 10, orderId: 'ORD-1' });
    expect(r.confirmed).toBe(2);
    const summary = summarizeSlot(db._peek(PATH)!, 'slot-a');
    expect(summary.pending).toBe(3); // 5 - 2 (잔여 부분 capture)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sweepExpiredPending — orderId 엔트리 단위 만료 정리
// ─────────────────────────────────────────────────────────────────────────────
describe('sweepExpiredPending — 주문 엔트리 단위 sweep', () => {
  it('한 슬롯 안에서 만료 주문만 무력화, 활성 주문 보존', async () => {
    const now = Date.now();
    const db = makeMockDb({
      [PATH]: {
        slot_pending: {
          'slot-a': {
            'ORD-EXP': { count: 2, expiresAt: new Date(now - 1000).toISOString() }, // 만료
            'ORD-OK': { count: 3, expiresAt: new Date(now + 60_000).toISOString() }, // 활성
          },
          'slot-b': {
            'ORD-X': { count: 1, expiresAt: new Date(now - 1000).toISOString() }, // 만료
          },
        },
      },
    });
    const r = await sweepExpiredPending({ ...base, adminDb: db });
    expect(r.swept).toBe(2); // ORD-EXP + ORD-X
    const pending = db._peek(PATH)!.slot_pending as any;
    // 만료 엔트리는 tombstone(count 0)으로 무력화 — Firestore merge 는 중첩 키를 못 지운다.
    expect(pending['slot-a']['ORD-EXP'].count).toBe(0);
    expect(pending['slot-a']['ORD-OK'].count).toBe(3);
    expect(summarizeSlot(db._peek(PATH)!, 'slot-b').pending).toBe(0); // 슬롯 전부 만료 → 집계 0

    // idempotent: 2차 sweep = 0.
    const r2 = await sweepExpiredPending({ ...base, adminDb: db });
    expect(r2.swept).toBe(0);
  });

  it('하위호환: 옛 단일 엔트리 만료도 sweep, 활성은 유지', async () => {
    const now = Date.now();
    const db = makeMockDb({
      [PATH]: {
        slot_pending: {
          'slot-a': { count: 2, expiresAt: new Date(now - 1000).toISOString(), orderId: 'OLD-EXP' },
          'slot-b': { count: 1, expiresAt: new Date(now + 60_000).toISOString(), orderId: 'OLD-OK' },
        },
      },
    });
    const r = await sweepExpiredPending({ ...base, adminDb: db });
    expect(r.swept).toBe(1);
    // 옛 단일 엔트리는 슬롯 루트째 무력화된다(정규화가 루트를 우선 읽으므로).
    expect(summarizeSlot(db._peek(PATH)!, 'slot-a').pending).toBe(0);
    // 활성 옛 엔트리는 그대로 보존됨.
    expect(summarizeSlot(db._peek(PATH)!, 'slot-b').pending).toBe(1);
  });
});
