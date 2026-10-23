/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore 문서 모킹 스캐폴딩. */
/**
 * 확정 좌석 이전 transferConfirmedSlot (2026-10-23, 후속 ②b) — api/_shared/slot-capacity.js.
 * 잠그는 것: 한 트랜잭션 5읽기→4쓰기 · 실패 시 5문서 불변 · to blackout/fully_booked/만석(대기석 포함)/활성 엔트리 ·
 *   from 원장·카운터 불일치 · 상품 비활성/정원/가격보정 무효 · 스냅샷 숫자 문자열 통과·불완전 거부 ·
 *   merge 보존(다른 주문·다른 슬롯·slot_pending·__legacy__·스냅샷 중첩 필드) · A→B→A releasedAt:null ·
 *   변경 뒤 취소 해제가 새 날짜를 푼다 · 동시 2건 중 1건 · fetchServerSlotCapacity 반환 불변.
 */
import { describe, it, expect } from 'vitest';
import { createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
import {
  transferConfirmedSlot,
  releaseSlotForCanceledOrder,
  fetchServerSlotCapacity,
  fetchOrderSlotBindingState,
  resolveSlotCapacityFromTour,
  summarizeSlot,
} from '../../api/_shared/slot-capacity.js';

const ORDER = 'ORD-1';
const TOUR = 'tour_a';
const SLOT = 's09';
const FROM = '2099-11-01';
const TO = '2099-11-05';
const NOW = new Date(Date.UTC(2099, 9, 1, 0, 0, 0));
const FUTURE = new Date(NOW.getTime() + 5 * 60_000).toISOString();
const PAST = new Date(NOW.getTime() - 5 * 60_000).toISOString();

const P = {
  booking: `bookings/${ORDER}`,
  snap: `paypal_order_snapshots/${ORDER}`,
  tour: `tours/${TOUR}`,
  from: `tour_availability/${TOUR}/dates/${FROM}`,
  to: `tour_availability/${TOUR}/dates/${TO}`,
};

function seed(over: Record<string, any> = {}) {
  return {
    [P.booking]: { status: 'CONFIRMED', tourDate: FROM, orderID: ORDER },
    [P.snap]: {
      slotBooking: { tourId: TOUR, tourSlotId: SLOT, bookingDate: FROM, slotCapacity: 8, passengers: 2 },
      amountUSD: '100.00',
    },
    [P.tour]: { maxPax: 8, slots: [{ id: SLOT, capacity: 8 }, { id: 's14', capacity: 4 }] },
    [P.from]: {
      tourId: TOUR, date: FROM, status: 'available',
      slot_bookings: { [SLOT]: 5, s14: 3 },
      slot_confirmed: { [SLOT]: { [ORDER]: { count: 2, at: 'T0', releasedAt: null }, 'ORD-OTHER': { count: 3, at: 'T0', releasedAt: null } } },
      slot_pending: { [SLOT]: { 'PEND-1': { count: 1, expiresAt: FUTURE } } },
    },
    [P.to]: {
      tourId: TOUR, date: TO, status: 'available',
      slot_bookings: { [SLOT]: 1, s14: 2 },
      slot_confirmed: { [SLOT]: { 'ORD-Z': { count: 1, at: 'T0', releasedAt: null } } },
      slot_pending: { [SLOT]: { 'PEND-2': { count: 1, expiresAt: FUTURE }, __legacy__: { count: 0, expiresAt: PAST } } },
    },
    ...over,
  };
}

function run(db: ReturnType<typeof createFakeFirestore>, opts: Record<string, any> = {}) {
  return transferConfirmedSlot({
    adminDb: db,
    orderId: ORDER,
    tourId: TOUR,
    slotId: SLOT,
    pax: 2,
    fromDate: FROM,
    toDate: TO,
    bookingRef: db.doc(P.booking),
    snapshotRef: db.doc(P.snap),
    bookingPatch: { tourDate: TO },
    verifyBooking: () => true,
    now: NOW,
    ...opts,
  });
}

const five = (db: ReturnType<typeof createFakeFirestore>) => JSON.stringify([P.booking, P.snap, P.tour, P.from, P.to].map((p) => db.__get(p)));

describe('transferConfirmedSlot — success (4 writes, merge-preserving)', () => {
  it('moves the confirmed seats, keeps other orders / slots / pending / __legacy__, rebinds the snapshot date', async () => {
    const db = createFakeFirestore(seed());
    const r = await run(db);
    // to: confirmed 1 + active pending 1 + pax 2 = 4 of 8
    expect(r).toEqual({ ok: true, capacity: 8, remaining: 4, priceModifierKrw: 0 });

    const from = db.__get(P.from)!;
    expect(from.slot_bookings).toEqual({ [SLOT]: 3, s14: 3 });
    expect(from.slot_confirmed[SLOT][ORDER]).toMatchObject({ count: 0, at: 'T0' });
    expect(typeof from.slot_confirmed[SLOT][ORDER].releasedAt).toBe('string');
    expect(from.slot_confirmed[SLOT]['ORD-OTHER']).toEqual({ count: 3, at: 'T0', releasedAt: null });
    expect(from.slot_pending).toEqual(seed()[P.from].slot_pending);

    const to = db.__get(P.to)!;
    expect(to.slot_bookings).toEqual({ [SLOT]: 3, s14: 2 });
    expect(to.slot_confirmed[SLOT][ORDER]).toMatchObject({ count: 2, releasedAt: null });
    expect(to.slot_confirmed[SLOT]['ORD-Z']).toEqual({ count: 1, at: 'T0', releasedAt: null });
    expect(to.slot_pending).toEqual(seed()[P.to].slot_pending);

    const snap = db.__get(P.snap)!;
    expect(snap.slotBooking).toEqual({ tourId: TOUR, tourSlotId: SLOT, bookingDate: TO, slotCapacity: 8, passengers: 2 });
    expect(snap).toMatchObject({ slotBookingPreviousDate: FROM, amountUSD: '100.00' });
    expect(typeof snap.slotBookingMovedAt).toBe('string');

    expect(db.__get(P.booking)!.tourDate).toBe(TO);
    expect(db.__get(P.tour)).toEqual(seed()[P.tour]);
  });

  it('creates the target date doc when it does not exist', async () => {
    const s = seed();
    delete (s as any)[P.to];
    const db = createFakeFirestore(s);
    await run(db);
    expect(db.__get(P.to)).toMatchObject({ tourId: TOUR, date: TO, status: 'available', slot_bookings: { [SLOT]: 2 } });
  });

  it('A → B → A restores the original entry (releasedAt back to null)', async () => {
    const db = createFakeFirestore(seed());
    await run(db);
    await run(db, { fromDate: TO, toDate: FROM, bookingPatch: { tourDate: FROM } });
    const from = db.__get(P.from)!;
    expect(from.slot_bookings[SLOT]).toBe(5);
    expect(from.slot_confirmed[SLOT][ORDER]).toMatchObject({ count: 2, releasedAt: null });
    const to = db.__get(P.to)!;
    expect(to.slot_bookings[SLOT]).toBe(1);
    expect(to.slot_confirmed[SLOT][ORDER].count).toBe(0);
    expect(db.__get(P.snap)!.slotBooking.bookingDate).toBe(FROM);
  });

  it('after a change, cancel-time releaseSlotForCanceledOrder frees the NEW date', async () => {
    const db = createFakeFirestore(seed());
    await run(db);
    const rel = await releaseSlotForCanceledOrder({ adminDb: db, orderId: ORDER, now: NOW });
    expect(rel).toMatchObject({ released: true, pax: 2, slot: { date: TO } });
    expect(db.__get(P.to)!.slot_bookings[SLOT]).toBe(1);
    expect(db.__get(P.from)!.slot_bookings[SLOT]).toBe(3);
  });

  it('numeric-string snapshot fields (Firestore round-trip) still bind', async () => {
    const db = createFakeFirestore(seed({
      [P.snap]: { slotBooking: { tourId: TOUR, tourSlotId: SLOT, bookingDate: FROM, slotCapacity: '8', passengers: '2' } },
    }));
    await expect(run(db)).resolves.toMatchObject({ ok: true });
  });
});

describe('transferConfirmedSlot — refusals leave all 5 docs untouched', () => {
  const cases: Array<[string, Record<string, any>, Record<string, any>, string]> = [
    ['verifyBooking false', {}, { verifyBooking: () => false }, 'BOOKING_CHANGED'],
    // PR-3 (2026-10-23): modifyBooking 의 검사는 비동기(같은 tx 로 cart_orders 를 읽는다) — Promise<false> 도 거부.
    ['async verifyBooking resolves false', {}, { verifyBooking: async () => false }, 'BOOKING_CHANGED'],
    ['async verifyBooking throws (cart order found)', {}, { verifyBooking: async () => { throw Object.assign(new Error('CART_ORDER_UNSUPPORTED'), { code: 'CART_ORDER_UNSUPPORTED' }); } }, 'CART_ORDER_UNSUPPORTED'],
    ['to blackout', { [P.to]: { status: 'blackout' } }, {}, 'DATE_UNAVAILABLE'],
    ['to fully_booked', { [P.to]: { status: 'fully_booked' } }, {}, 'DATE_UNAVAILABLE'],
    ['to full counting active pending', { [P.to]: { status: 'available', slot_bookings: { [SLOT]: 5 }, slot_pending: { [SLOT]: { X: { count: 2, expiresAt: FUTURE } } } } }, {}, 'SLOT_FULL'],
    ['to already holds an active entry for this order', { [P.to]: { slot_bookings: { [SLOT]: 2 }, slot_confirmed: { [SLOT]: { [ORDER]: { count: 2, releasedAt: null } } } } }, {}, 'SLOT_BINDING_MISMATCH'],
    ['from ledger count ≠ pax', { [P.from]: { slot_bookings: { [SLOT]: 5 }, slot_confirmed: { [SLOT]: { [ORDER]: { count: 1 } } } } }, {}, 'SLOT_BINDING_MISMATCH'],
    ['from counter < pax', { [P.from]: { slot_bookings: { [SLOT]: 1 }, slot_confirmed: { [SLOT]: { [ORDER]: { count: 2 } } } } }, {}, 'SLOT_BINDING_MISMATCH'],
    ['from ledger missing', { [P.from]: { slot_bookings: { [SLOT]: 5 } } }, {}, 'SLOT_BINDING_MISMATCH'],
    ['snapshot incomplete (no tourSlotId)', { [P.snap]: { slotBooking: { tourId: TOUR, bookingDate: FROM, slotCapacity: 8, passengers: 2 } } }, {}, 'SLOT_BINDING_MISMATCH'],
    ['snapshot date ≠ fromDate', { [P.snap]: { slotBooking: { tourId: TOUR, tourSlotId: SLOT, bookingDate: '2099-10-30', slotCapacity: 8, passengers: 2 } } }, {}, 'SLOT_BINDING_MISMATCH'],
    ['snapshot pax ≠ pax', { [P.snap]: { slotBooking: { tourId: TOUR, tourSlotId: SLOT, bookingDate: FROM, slotCapacity: 8, passengers: 3 } } }, {}, 'SLOT_BINDING_MISMATCH'],
    ['tour missing', { [P.tour]: undefined }, {}, 'SLOT_TOUR_NOT_FOUND'],
    ['slot inactive', { [P.tour]: { maxPax: 8, slots: [{ id: SLOT, capacity: 8, is_active: false }] } }, {}, 'SLOT_INACTIVE'],
    ['slot not in tour', { [P.tour]: { maxPax: 8, slots: [{ id: 'other', capacity: 8 }] } }, {}, 'SLOT_NOT_IN_TOUR'],
    ['capacity unset', { [P.tour]: { slots: [{ id: SLOT }] } }, {}, 'SLOT_CAPACITY_UNSET'],
    ['price modifier invalid', { [P.tour]: { maxPax: 8, slots: [{ id: SLOT, capacity: 8, price_modifier_krw: 1.5 }] } }, {}, 'SLOT_PRICE_MODIFIER_INVALID'],
  ];
  for (const [label, docOver, optOver, code] of cases) {
    it(`${label} → ${code}`, async () => {
      const s: Record<string, any> = seed();
      for (const [p, v] of Object.entries(docOver)) {
        if (v === undefined) delete s[p];
        else s[p] = v;
      }
      const db = createFakeFirestore(s);
      const before = five(db);
      await expect(run(db, optOver)).rejects.toMatchObject({ code });
      expect(five(db)).toBe(before);
    });
  }

  it('verifyBooking receives the fresh booking and the transaction clock', async () => {
    const db = createFakeFirestore(seed());
    const seen: any[] = [];
    await run(db, { verifyBooking: (b: any, nowMs: number) => { seen.push([b.tourDate, nowMs]); return true; } });
    expect(seen).toEqual([[FROM, NOW.getTime()]]);
  });

  it('verifyBooking gets the same transaction: its extra read is version-tracked (a concurrent change → retry)', async () => {
    const db = createFakeFirestore(seed());
    let calls = 0;
    db.__beforeCommit = ({ attempt }: { attempt: number }) => { if (attempt === 1) db.__set('cart_orders/ORD-1', { status: 'captured' }); };
    await expect(run(db, {
      verifyBooking: async (_b: any, _nowMs: number, tx: any) => {
        calls += 1;
        return !(await tx.get(db.doc('cart_orders/ORD-1'))).exists;
      },
    })).rejects.toMatchObject({ code: 'BOOKING_CHANGED' });
    expect(calls).toBe(2); // 첫 시도는 충돌로 버려지고, 재시도가 새 cart 문서를 본다
    expect(db.__stats.retries).toBe(1);
  });
});

describe('transferConfirmedSlot — concurrency', () => {
  it('two orders racing for the last seats → exactly one moves', async () => {
    const s: Record<string, any> = seed({
      [P.to]: { tourId: TOUR, date: TO, status: 'available', slot_bookings: { [SLOT]: 4 } },
      'paypal_order_snapshots/ORD-2': { slotBooking: { tourId: TOUR, tourSlotId: SLOT, bookingDate: FROM, slotCapacity: 8, passengers: 2 } },
      'bookings/ORD-2': { status: 'CONFIRMED', tourDate: FROM },
    });
    s[P.from] = {
      ...s[P.from],
      slot_bookings: { [SLOT]: 4 },
      slot_confirmed: { [SLOT]: { [ORDER]: { count: 2 }, 'ORD-2': { count: 2 } } },
      slot_pending: {},
    };
    const db = createFakeFirestore(s);
    const barrier = makeBarrier(2);
    db.__beforeCommit = async () => { await barrier.wait(); };
    // 정원 7, to 확정 4 → 2명짜리 한 건만 들어간다(4+2=6 허용, 다음 6+2=8 > 7 거부).
    db.__set(P.tour, { slots: [{ id: SLOT, capacity: 7 }] });
    const results = await Promise.allSettled([
      run(db),
      run(db, { orderId: 'ORD-2', bookingRef: db.doc('bookings/ORD-2'), snapshotRef: db.doc('paypal_order_snapshots/ORD-2') }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.code).toBe('SLOT_FULL');
    expect(db.__get(P.to)!.slot_bookings[SLOT]).toBe(6);
    expect(summarizeSlot(db.__get(P.to), SLOT, NOW.getTime()).total).toBe(6);
  });
});

describe('capacity helpers', () => {
  it('fetchServerSlotCapacity contract unchanged (reads tours/{id} → resolveSlotCapacityFromTour)', async () => {
    const db = createFakeFirestore({ [P.tour]: { maxPax: 6, slots: [{ id: SLOT, price_modifier_krw: 5000 }, { id: 'off', is_active: false }] } });
    await expect(fetchServerSlotCapacity({ adminDb: db, tourId: TOUR, slotId: SLOT })).resolves.toEqual({ ok: true, capacity: 6, priceModifierKrw: 5000 });
    await expect(fetchServerSlotCapacity({ adminDb: db, tourId: TOUR, slotId: 'off' })).resolves.toEqual({ ok: false, code: 'SLOT_INACTIVE' });
    await expect(fetchServerSlotCapacity({ adminDb: db, tourId: 'nope', slotId: SLOT })).resolves.toEqual({ ok: false, code: 'SLOT_TOUR_NOT_FOUND' });
    expect(resolveSlotCapacityFromTour(null, SLOT)).toEqual({ ok: false, code: 'SLOT_TOUR_NOT_FOUND' });
  });

  it('fetchOrderSlotBindingState: none (no snapshot / no field / null) · partial · ok', async () => {
    const db = createFakeFirestore({
      'paypal_order_snapshots/A': { amountUSD: '1' },
      'paypal_order_snapshots/B': { slotBooking: null },
      'paypal_order_snapshots/C': { slotBooking: { tourId: TOUR } },
      'paypal_order_snapshots/D': { slotBooking: { tourId: TOUR, tourSlotId: SLOT, bookingDate: FROM, slotCapacity: 8, passengers: 2 } },
    });
    await expect(fetchOrderSlotBindingState({ adminDb: db, orderId: 'MISSING' })).resolves.toEqual({ kind: 'none' });
    await expect(fetchOrderSlotBindingState({ adminDb: db, orderId: 'A' })).resolves.toEqual({ kind: 'none' });
    await expect(fetchOrderSlotBindingState({ adminDb: db, orderId: 'B' })).resolves.toEqual({ kind: 'none' });
    await expect(fetchOrderSlotBindingState({ adminDb: db, orderId: 'C' })).resolves.toEqual({ kind: 'partial' });
    await expect(fetchOrderSlotBindingState({ adminDb: db, orderId: 'D' })).resolves.toEqual({
      kind: 'ok', binding: { tourId: TOUR, date: FROM, slotId: SLOT, capacity: 8, pax: 2 },
    });
  });
});
