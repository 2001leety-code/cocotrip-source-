/**
 * 장바구니(cart) 경로 투어 슬롯 정원 배선 — 단건 결제(#1255)의 형제 경로.
 *
 * 🔴 고친 문제
 *   - #1255 는 단건 결제(createPaypalOrder/capturePaypalOrder)에만 슬롯 4필드를 실었다.
 *   - 장바구니는 같은 다이얼로그(TourBookingDialog)의 "담기" 버튼에서 출발하는데
 *     booking 에 슬롯 필드를 안 실었고, api/createCartOrder.js·api/captureCartOrder.js 는
 *     slot-capacity 를 아예 호출하지 않았다 → 장바구니로 사면 정원 강제가 통째로 없다.
 *
 * 🔑 장바구니 고유 문제 = **부분 실패**. 라인이 여러 개라 3번째가 SLOT_FULL 이면
 *   이미 잡은 1·2번 pending 이 남는다(유령 점유 → 다른 손님 SLOT_FULL 오차단 = 매출손실,
 *   버그#18 과 같은 계열). → releaseSlotLock 으로 되돌린다. cron sweep(10분 TTL)은 백스톱.
 *
 * 검증 방식은 #1255 와 동일 — 순수 로직은 실행 검증, 컴포넌트/엔드포인트 배선은 소스 단언
 * (컴포넌트 import 는 lint R_Phase1_testNoFirebaseClientImport 가 막는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readSlotFields,
  releaseSlotLock,
  acquireSlotLock,
  summarizeSlot,
} from '../../api/_shared/slot-capacity.js';

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

// ── Firestore 대역 (실제 merge 의미 재현: 중첩 맵은 깊은 병합, 키 생략으로 삭제 안 됨) ──
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = isPlainObject(v) && isPlainObject(cur) ? deepMerge(cur, v) : v;
  }
  return out;
}

function makeMockDb(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(initial)) store.set(path, structuredClone(data));

  function write(path: string, data: Record<string, unknown>, opts: { merge?: boolean } = {}) {
    const cur = store.get(path);
    if (opts.merge && cur) store.set(path, deepMerge(cur, data));
    else store.set(path, structuredClone(data));
  }

  function doc(path: string) {
    return {
      path,
      set: (data: Record<string, unknown>, opts: { merge?: boolean } = {}) => {
        write(path, data, opts);
        return Promise.resolve();
      },
    };
  }

  async function runTransaction(fn: (tx: unknown) => Promise<unknown>) {
    const tx = {
      get(ref: { path: string }) {
        const cur = store.get(ref.path);
        return Promise.resolve({ exists: cur !== undefined, data: () => structuredClone(cur || {}) });
      },
      set(ref: { path: string }, data: Record<string, unknown>, opts: { merge?: boolean } = {}) {
        write(ref.path, data, opts);
      },
    };
    return fn(tx);
  }

  return { doc, runTransaction, _peek: (p: string) => store.get(p) };
}

const TOUR = 'tour-seoul-city';
const DATE = '2026-09-01';
const PATH = `tour_availability/${TOUR}/dates/${DATE}`;

describe('readSlotFields — 라인 booking → 잠금 인자 (4필드 + 인원 all-or-nothing)', () => {
  const full = {
    productType: 'charter_seoul_city',
    tourId: TOUR,
    tourSlotId: 'slot_am',
    bookingDate: DATE,
    slotCapacity: 8,
    passengers: 3,
  };

  it('전부 있으면 잠금 인자를 돌려준다', () => {
    expect(readSlotFields(full)).toEqual({
      tourId: TOUR, date: DATE, slotId: 'slot_am', capacity: 8, pax: 3,
    });
  });

  it('하나라도 없으면 null — 반쪽 잠금 금지', () => {
    for (const k of ['tourId', 'tourSlotId', 'bookingDate', 'slotCapacity', 'passengers']) {
      const partial: Record<string, unknown> = { ...full };
      delete partial[k];
      expect(readSlotFields(partial), `${k} 없으면 null`).toBeNull();
    }
    expect(readSlotFields(null)).toBeNull();
    expect(readSlotFields({})).toBeNull();
  });

  it('capacity·pax 가 0·음수·NaN 이면 null (0 capacity = 전원 차단, 0 pax = 잠금 무의미)', () => {
    for (const bad of [0, -2, Number.NaN]) {
      expect(readSlotFields({ ...full, slotCapacity: bad })).toBeNull();
      expect(readSlotFields({ ...full, passengers: bad })).toBeNull();
    }
  });

  it('문자열 숫자도 받는다 (Firestore 스냅샷 왕복 후 형 변화 방어)', () => {
    const r = readSlotFields({ ...full, slotCapacity: '8', passengers: '3' });
    expect(r).toEqual({ tourId: TOUR, date: DATE, slotId: 'slot_am', capacity: 8, pax: 3 });
  });

  it('공백 문자열은 값이 아니다', () => {
    expect(readSlotFields({ ...full, tourSlotId: '  ' })).toBeNull();
    expect(readSlotFields({ ...full, bookingDate: '' })).toBeNull();
  });
});

describe('releaseSlotLock — 부분 실패 되돌리기 (유령 pending 방지)', () => {
  it('우리 주문 pending 을 즉시 무효화해 좌석이 곧바로 풀린다', async () => {
    const db = makeMockDb();
    await acquireSlotLock({
      adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am',
      pax: 5, capacity: 6, orderId: 'CART-A',
    });
    expect(summarizeSlot(db._peek(PATH), 'slot_am').total).toBe(5);

    await releaseSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', orderId: 'CART-A' });
    expect(summarizeSlot(db._peek(PATH), 'slot_am').total).toBe(0);
  });

  it('다른 주문의 pending 은 건드리지 않는다', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', pax: 2, capacity: 9, orderId: 'CART-A' });
    await acquireSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', pax: 3, capacity: 9, orderId: 'OTHER-B' });
    expect(summarizeSlot(db._peek(PATH), 'slot_am').total).toBe(5);

    await releaseSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', orderId: 'CART-A' });
    expect(summarizeSlot(db._peek(PATH), 'slot_am').total).toBe(3);
  });

  it('🔴 확정석(slot_bookings)은 절대 줄이지 않는다', async () => {
    const db = makeMockDb({ [PATH]: { tourId: TOUR, date: DATE, status: 'available', slot_bookings: { slot_am: 4 } } });
    await acquireSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', pax: 2, capacity: 9, orderId: 'CART-A' });
    await releaseSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', orderId: 'CART-A' });
    const after = summarizeSlot(db._peek(PATH), 'slot_am');
    expect(after.confirmed).toBe(4);
    expect(after.pending).toBe(0);
  });

  it('해제 후 그 좌석으로 다른 손님이 바로 예약된다 (TTL 10분 대기 없음)', async () => {
    const db = makeMockDb();
    await acquireSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', pax: 6, capacity: 6, orderId: 'CART-A' });
    await expect(
      acquireSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', pax: 1, capacity: 6, orderId: 'NEXT' }),
    ).rejects.toMatchObject({ code: 'SLOT_FULL' });

    await releaseSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', orderId: 'CART-A' });
    await expect(
      acquireSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', pax: 1, capacity: 6, orderId: 'NEXT' }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('없는 잠금 해제는 조용히 성공한다 (sweep 이 먼저 치웠을 때 재시도 안전)', async () => {
    const db = makeMockDb();
    await expect(
      releaseSlotLock({ adminDb: db, tourId: TOUR, date: DATE, slotId: 'slot_am', orderId: 'GONE' }),
    ).resolves.toMatchObject({ ok: true });
    expect(summarizeSlot(db._peek(PATH), 'slot_am').total).toBe(0);
  });
});

describe('createCartOrder 배선 (소스 잠금)', () => {
  const cart = src('api/createCartOrder.js');

  it('라인마다 잠금을 건다 — 공유 헬퍼 재사용(사본 금지)', () => {
    expect(cart).toMatch(/from '\.\/_shared\/slot-capacity\.js'/);
    expect(cart).toMatch(/readSlotFields\(/);
    expect(cart).toMatch(/await acquireSlotLock\(/);
  });

  it('🔴 PayPal 주문 생성 **전**에 잠근다 (뒤면 정원 초과 주문이 만들어진다)', () => {
    const acquire = cart.indexOf('acquireSlotLock(');
    const paypal = cart.indexOf('/v2/checkout/orders');
    expect(acquire).toBeGreaterThan(-1);
    expect(paypal).toBeGreaterThan(-1);
    expect(acquire, '잠금이 PayPal 주문 생성 뒤로 밀렸다').toBeLessThan(paypal);
  });

  it('🔴 한 라인이 막히면 이미 잡은 잠금을 되돌린다 (유령 pending 금지)', () => {
    expect(cart).toMatch(/releaseSlotLock\(/);
    // import 줄이 아니라 **실제 호출 지점** 으로 비교한다 (indexOf 가 import 를 먼저 잡는다).
    const acquire = cart.indexOf('await acquireSlotLock(');
    expect(acquire, '취득 호출 없음').toBeGreaterThan(-1);
    const rollback = cart.indexOf('releaseAcquiredSlotLocks(', acquire);
    expect(rollback, '취득 실패 경로에서 되돌리지 않는다').toBeGreaterThan(acquire);
  });

  it('막힌 아이템을 손님이 식별할 수 있게 index 를 돌려준다', () => {
    expect(cart).toMatch(/itemIndex/);
  });
});

describe('captureCartOrder 배선 (소스 잠금)', () => {
  const cap = src('api/captureCartOrder.js');

  it('라인마다 confirm 으로 pending → confirmed 전환', () => {
    expect(cap).toMatch(/confirmSlotLock/);
    expect(cap).toMatch(/readSlotFields\(/);
    expect(cap).toMatch(/await confirmSlotLock\(/);
  });

  it('🔴 예약 doc 저장 성공(batchOk) 뒤에만 확정한다 (단건 bookingWriteOk 게이트와 동형)', () => {
    const batchOk = cap.indexOf('batchOk = true');
    // import 줄이 아니라 실제 호출 지점으로 비교.
    const confirm = cap.indexOf('await confirmSlotLock(');
    expect(batchOk).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(batchOk);
    expect(cap.slice(batchOk, confirm)).toMatch(/if \(batchOk\)/);
  });

  it('확정 실패는 응답을 깨지 않고 운영자 알림으로 남긴다 (돈은 이미 캡처됨)', () => {
    const confirm = cap.indexOf('await confirmSlotLock(');
    const alertIdx = cap.indexOf('throttledTelegramAlert', confirm);
    expect(alertIdx, '슬롯 확정 실패 알림 없음').toBeGreaterThan(-1);
  });
});

describe('CartCheckout 오류 노출 (소스 잠금)', () => {
  const co = src('src/components/CartCheckout.tsx');

  it('4언어 안내는 firebase-free 모듈에서 가져온다 (사본 금지)', () => {
    expect(co).toMatch(/import \{ SLOT_REJECT_LABELS \} from '@\/lib\/tourSlotBooking'/);
  });

  it('🔴 SLOT_FULL 분기가 generic setError 보다 앞 (뒤면 손님이 서버 진단 영어를 본다)', () => {
    const branch = co.indexOf("json.code === 'SLOT_FULL'");
    const generic = co.indexOf("setError(json.error");
    expect(branch, 'SLOT_FULL 분기 없음').toBeGreaterThan(-1);
    expect(co).toContain("json.code === 'DATE_UNAVAILABLE'");
    expect(generic).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(generic);
  });

  it('어떤 아이템이 막혔는지 이름으로 알려준다', () => {
    expect(co).toMatch(/itemIndex/);
    expect(co).toMatch(/displayName/);
  });
});

describe('TourBookingDialog 장바구니 담기 배선 (소스 잠금)', () => {
  const dialog = src('src/components/tours/TourBookingDialog.tsx');

  it('담기 booking 에도 같은 헬퍼로 슬롯 4필드를 싣는다 (결제 경로와 동일 규칙)', () => {
    expect(dialog).toMatch(/tourSlotBody/);
    const cartBtn = dialog.indexOf('<CartAddButton');
    expect(cartBtn).toBeGreaterThan(-1);
    const tail = dialog.slice(cartBtn, cartBtn + 1200);
    expect(tail, '담기 booking 에 슬롯 조각이 없다').toMatch(/\.\.\.cartSlotFields|\.\.\.tourSlotBody\(/);
  });

  it('🔴 슬롯이 다르면 장바구니 라인도 달라야 한다 (같은 id 면 10시/14시가 서로를 덮는다)', () => {
    const cartBtn = dialog.indexOf('<CartAddButton');
    const tail = dialog.slice(cartBtn, cartBtn + 400);
    expect(tail).toMatch(/id=\{`\$\{tour\.id\}-\$\{date\}-\$\{pax\}\$\{[^}]*Slot[^}]*\}`\}/);
  });
});
