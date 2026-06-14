/**
 * 버그헌트 #8 회귀 테스트 — confirmBookingAsPaid 원자적 멱등 게이트.
 *
 * 버그: read → status 확인 → update 가 트랜잭션 없이 수행되어, PayPal webhook
 *      (자동)과 admin mark-paid(운영자 클릭)가 동시에 호출되면 둘 다
 *      status!=='CONFIRMED' 를 읽고 각자 부수효과(booking-processor / AI 플래너 /
 *      확정 이메일)를 실행 → 이중 처리.
 *
 * fix: read+상태확인+update 를 db.runTransaction 으로 감싸 'PENDING→CONFIRMED'
 *      전이를 단 한 호출만 통과하게 하고, 전이를 성사시킨 호출만 부수효과 실행.
 *      이미 CONFIRMED 였던 호출은 alreadyConfirmed:true 로 멱등 응답(부수효과 0).
 *
 * 검증 전략: 낙관적 동시성(optimistic concurrency)을 모사한 in-memory Firestore.
 *   트랜잭션이 read 한 문서가 commit 시점에 바뀌어 있으면(version mismatch)
 *   Firestore 처럼 콜백을 재시도. 두 confirm 호출을 Promise.all 로 경합시켜
 *   부수효과(bookings mirror .set / booking-processor 트리거)가 정확히 1회만
 *   일어나는지 확인 — 비원자 구버전이면 2회 발생해 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 부수효과 모듈 모킹 — 실제 네트워크/이메일/텔레그램 없이 "몇 번 불렸나"만 셈.
const triggerBookingProcessor = vi.fn();
const triggerAiPlanner = vi.fn();
const sendCustomerEmailWithAlert = vi.fn(async () => ({ ok: true }));
const notify = vi.fn(async () => {});
const throttledTelegramAlert = vi.fn(async () => {});

vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({
  triggerBookingProcessor: (...a: unknown[]) => triggerBookingProcessor(...a),
}));
vi.mock('../../api/_shared/ai-planner-trigger.js', () => ({
  triggerAiPlanner: (...a: unknown[]) => triggerAiPlanner(...a),
}));
vi.mock('../../api/_shared/customer-email-trigger.js', () => ({
  sendCustomerEmailWithAlert: (...a: unknown[]) => sendCustomerEmailWithAlert(...a),
}));
vi.mock('../../api/_shared/notify.js', () => ({
  notify: (...a: unknown[]) => notify(...a),
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: (...a: unknown[]) => throttledTelegramAlert(...a),
}));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({
  buildManualPaymentEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}));
// FieldValue.serverTimestamp() 만 필요 — sentinel 객체로 대체.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__SERVER_TS__' },
}));

import { confirmBookingAsPaid } from '../../api/_shared/booking-confirm.js';

/**
 * 낙관적 동시성 in-memory Firestore.
 * - pending_bookings/{ref} 한 문서에 version 카운터 유지.
 * - runTransaction(cb): cb 안의 tx.get 이 읽은 문서의 version 을 기록 →
 *   tx.update 는 staged 만 해두고 commit 시점에 version 이 그대로면 적용,
 *   바뀌었으면(다른 트랜잭션이 먼저 commit) READ-한-것이 stale → cb 재실행.
 *   이것이 실제 Firestore 트랜잭션의 핵심 보장(serializable)이며 버그를 잡는다.
 */
function makeFakeDb(initial: Record<string, any>) {
  const store = new Map<string, { data: any; version: number }>();
  store.set('pending_bookings/REF', { data: { ...initial }, version: 0 });

  const setCalls: { path: string; data: any }[] = [];

  function docRef(path: string) {
    return {
      __path: path,
      async get() {
        const e = store.get(path);
        return { exists: !!e, data: () => (e ? { ...e.data } : undefined) };
      },
      async set(data: any) {
        setCalls.push({ path, data });
      },
      async update(patch: any) {
        const e = store.get(path);
        if (!e) throw new Error('update on missing doc');
        e.data = { ...e.data, ...patch };
        e.version += 1;
      },
    };
  }

  const db = {
    collection(name: string) {
      return { doc: (id: string) => docRef(`${name}/${id}`) };
    },
    async runTransaction(cb: (tx: any) => Promise<any>) {
      // 최대 몇 회 재시도 (Firestore 기본 5회와 동일한 정신).
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, number>(); // path -> version read
        const staged: { ref: any; patch: any }[] = [];
        const tx = {
          async get(ref: any) {
            const e = store.get(ref.__path);
            reads.set(ref.__path, e ? e.version : -1);
            return { exists: !!e, data: () => (e ? { ...e.data } : undefined) };
          },
          update(ref: any, patch: any) {
            staged.push({ ref, patch });
          },
        };
        const result = await cb(tx);

        // commit: 읽은 모든 문서 version 이 그대로인지 확인.
        let conflict = false;
        for (const [path, ver] of reads) {
          const e = store.get(path);
          const cur = e ? e.version : -1;
          if (cur !== ver) { conflict = true; break; }
        }
        if (conflict) {
          // 살짝 양보 후 재시도 (경합 상대가 commit 끝내도록).
          await Promise.resolve();
          continue;
        }
        // apply staged writes
        for (const w of staged) {
          const e = store.get(w.ref.__path)!;
          e.data = { ...e.data, ...w.patch };
          e.version += 1;
        }
        return result;
      }
      throw new Error('runTransaction: too many retries');
    },
  };

  return { db, store, setCalls };
}

const BASE_PENDING = {
  status: 'sent',
  productType: 'tour_hourly',
  customerEmail: 'buyer@example.com',
  priceKRW: 138320,
  priceUSD: '99.00',
  language: 'en',
};

describe('버그헌트 #8 — confirmBookingAsPaid 동시 confirm 멱등 (원자 게이트)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('동시 webhook + admin confirm → 부수효과 정확히 1회 (이중 처리 차단)', async () => {
    const { db, store, setCalls } = makeFakeDb(BASE_PENDING);

    const [r1, r2] = await Promise.all([
      confirmBookingAsPaid({ db, bookingRef: 'REF', paypalTransactionId: 'TX-WEB', source: 'webhook' }),
      confirmBookingAsPaid({ db, bookingRef: 'REF', source: 'admin', adminUid: 'admin-1', adminEmail: 'a@x.com' }),
    ]);

    // 둘 다 ok
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // 정확히 한 호출만 전이(부수효과), 다른 하나는 alreadyConfirmed
    const winners = [r1, r2].filter((r: any) => !r.alreadyConfirmed);
    const losers = [r1, r2].filter((r: any) => r.alreadyConfirmed);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as any).alreadyConfirmed).toBe(true);

    // 핵심: booking-processor(부수효과) 1회 · bookings mirror set 1회.
    expect(triggerBookingProcessor).toHaveBeenCalledTimes(1);
    expect(setCalls.filter((c) => c.path.startsWith('bookings/'))).toHaveLength(1);

    // 최종 문서는 CONFIRMED, 단 한 번 전이.
    expect(store.get('pending_bookings/REF')!.data.status).toBe('CONFIRMED');
  });

  it('이미 CONFIRMED 인 doc → 부수효과 0, alreadyConfirmed:true, bookingId 유지', async () => {
    const { db, setCalls } = makeFakeDb({
      ...BASE_PENDING,
      status: 'CONFIRMED',
      paypalTransactionId: 'EXISTING-TX',
    });

    const r = await confirmBookingAsPaid({ db, bookingRef: 'REF', paypalTransactionId: 'TX-NEW', source: 'webhook' });

    expect(r).toMatchObject({ ok: true, alreadyConfirmed: true, bookingId: 'EXISTING-TX' });
    expect(triggerBookingProcessor).not.toHaveBeenCalled();
    expect(triggerAiPlanner).not.toHaveBeenCalled();
    expect(sendCustomerEmailWithAlert).not.toHaveBeenCalled();
    expect(setCalls.filter((c) => c.path.startsWith('bookings/'))).toHaveLength(0);
  });

  it('단일 confirm(경합 없음) → 정상 전이 + 부수효과 1회 + 기존 응답 형태', async () => {
    const { db, store, setCalls } = makeFakeDb(BASE_PENDING);

    const r = await confirmBookingAsPaid({ db, bookingRef: 'REF', paypalTransactionId: 'TX-1', source: 'webhook' });

    expect(r.ok).toBe(true);
    expect(r.alreadyConfirmed).toBeUndefined();
    expect(r.bookingId).toBe('TX-1'); // paypalTransactionId || bookingRef
    expect(triggerBookingProcessor).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1); // 텔레그램 booking #2
    expect(sendCustomerEmailWithAlert).toHaveBeenCalledTimes(1);
    expect(setCalls.filter((c) => c.path.startsWith('bookings/'))).toHaveLength(1);
    expect(store.get('pending_bookings/REF')!.data.status).toBe('CONFIRMED');
  });

  it('NOT_FOUND — pending doc 없으면 부수효과 0, 기존 코드/응답 유지', async () => {
    const { db, setCalls } = makeFakeDb(BASE_PENDING);
    const r = await confirmBookingAsPaid({ db, bookingRef: 'MISSING', source: 'webhook' });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(triggerBookingProcessor).not.toHaveBeenCalled();
    expect(setCalls.filter((c) => c.path.startsWith('bookings/'))).toHaveLength(0);
  });

  it('AI 플래너 동시 confirm → AI 플래너 트리거도 1회만 (이중 플랜 생성 차단)', async () => {
    const { db } = makeFakeDb({
      ...BASE_PENDING,
      productType: 'ai-planner-full',
      itineraryData: { regions: ['seoul'] },
    });

    const [r1, r2] = await Promise.all([
      confirmBookingAsPaid({ db, bookingRef: 'REF', paypalTransactionId: 'TX-WEB', source: 'webhook' }),
      confirmBookingAsPaid({ db, bookingRef: 'REF', source: 'admin', adminUid: 'admin-1' }),
    ]);

    expect(r1.ok && r2.ok).toBe(true);
    expect([r1, r2].filter((r: any) => r.alreadyConfirmed)).toHaveLength(1);
    expect(triggerAiPlanner).toHaveBeenCalledTimes(1);
    expect(triggerBookingProcessor).not.toHaveBeenCalled();
  });
});
