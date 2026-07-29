/**
 * 환불 원장 — **경쟁 조건 행위 테스트** (2026-07-29).
 *
 * 지금까지 환불 테스트는 소스 문자열 검사였다. 문자열은 "transaction 을 쓴다" 는 보여주지만
 * **두 환불이 동시에 들어왔을 때 최종 금액이 맞는가** 는 못 본다. 돈은 그게 전부다.
 *
 * 여기서는 낙관적 동시성을 흉내낸 가짜 Firestore(tests/helpers/fake-firestore.js)로
 * 실제 경쟁을 **결정적으로** 재현한다. 두 실행이 둘 다 읽기를 마친 뒤에 커밋하도록
 * 게이트를 걸어, 타이밍 운에 기대지 않는다.
 *
 * 고치는 결함 (전부 이전 구조에서 실제로 가능했던 것):
 *   · 서로 다른 부분환불 2건 동시 수신 → 갱신 유실로 누계가 한쪽만 남음
 *   · 예약 갱신 성공 후 log 기록 전 죽음 → 재전송 때 **또** 더함
 *   · 같은 환불(refundId)이 다른 eventId 로 재전송 → 두 번 누적
 *   · pending_bookings 만 성공하고 bookings 실패 → 두 저장소 영구 불일치
 *   · 전액환불 뒤 늦게 온 부분환불 이벤트 → 상태가 PARTIALLY_REFUNDED 로 되돌아감
 */
import { describe, it, expect } from 'vitest';
import { createFakeFirestore, makeBarrier, FieldValue } from '../helpers/fake-firestore.js';
import {
  applyRefundEvent,
  decideRefundStatus,
  REFUND_EVENT_IN_FLIGHT_MS,
} from '../../api/_shared/refund-ledger.js';

const ORDER = 'ORDER-XYZ';
const CAPTURE = 'CAP-1';

function seedBooking(extra: Record<string, unknown> = {}) {
  return {
    [`bookings/${ORDER}`]: {
      bookingRef: 'CT-20260729-001',
      captureID: CAPTURE,
      amountUSD: 9.9,
      amountKRW: 13300,
      status: 'CONFIRMED',
      ...extra,
    },
  };
}

const ev = (over: Record<string, unknown> = {}) => ({
  db: null as never,
  FieldValue,
  eventType: 'PAYMENT.CAPTURE.REFUNDED',
  // 2026-07-29: 검증된 웹훅 환경은 **필수**다. 생략하면(=unverified) 어떤 문서도 건드리지 않는다.
  webhookEnvironment: 'live',
  captureId: CAPTURE,
  bookingsDocId: ORDER,
  bookingRef: 'CT-20260729-001',
  refundedKRW: 0,
  ...over,
});

describe('동시 부분환불 — 갱신 유실이 없어야 한다', () => {
  it('$5 와 $4.90 을 동시에 처리하면 누계가 정확히 $9.90', async () => {
    const db = createFakeFirestore(seedBooking());
    const barrier = makeBarrier(2);
    // 두 transaction 이 **둘 다 읽기를 끝낸 뒤** 커밋하도록 강제 → 진짜 경쟁 재현.
    db.__beforeCommit = async ({ attempt }) => { if (attempt === 1) await barrier.wait(); };

    const [a, b] = await Promise.all([
      applyRefundEvent(ev({ db, eventId: 'EVT-A', refundId: 'REF-A', refundedUSD: 5.0 })),
      applyRefundEvent(ev({ db, eventId: 'EVT-B', refundId: 'REF-B', refundedUSD: 4.9 })),
    ]);

    expect(a.applied).toBe(true);
    expect(b.applied).toBe(true);
    const booking = db.__get(`bookings/${ORDER}`)!;
    expect(booking.refundedUSDTotal).toBe(9.9);
    // 재실행이 실제로 일어났다 = 낙관적 동시성이 작동했다는 증거.
    expect(db.__stats.retries).toBeGreaterThanOrEqual(1);
  });

  it('동시 처리 결과가 순차 처리 결과와 같다 (상태까지)', async () => {
    const seq = createFakeFirestore(seedBooking());
    await applyRefundEvent(ev({ db: seq, eventId: 'E1', refundId: 'R1', refundedUSD: 5.0 }));
    await applyRefundEvent(ev({ db: seq, eventId: 'E2', refundId: 'R2', refundedUSD: 4.9 }));

    const par = createFakeFirestore(seedBooking());
    const barrier = makeBarrier(2);
    par.__beforeCommit = async ({ attempt }) => { if (attempt === 1) await barrier.wait(); };
    await Promise.all([
      applyRefundEvent(ev({ db: par, eventId: 'E1', refundId: 'R1', refundedUSD: 5.0 })),
      applyRefundEvent(ev({ db: par, eventId: 'E2', refundId: 'R2', refundedUSD: 4.9 })),
    ]);

    const s = seq.__get(`bookings/${ORDER}`)!;
    const p = par.__get(`bookings/${ORDER}`)!;
    expect(p.refundedUSDTotal).toBe(s.refundedUSDTotal);
    expect(p.status).toBe(s.status);
    expect(p.status).toBe('REFUNDED');
  });

  it('순서가 뒤바뀌어도 최종 누계·상태가 같다', async () => {
    const fwd = createFakeFirestore(seedBooking());
    await applyRefundEvent(ev({ db: fwd, eventId: 'E1', refundId: 'R1', refundedUSD: 2.0 }));
    await applyRefundEvent(ev({ db: fwd, eventId: 'E2', refundId: 'R2', refundedUSD: 7.9 }));

    const rev = createFakeFirestore(seedBooking());
    await applyRefundEvent(ev({ db: rev, eventId: 'E2', refundId: 'R2', refundedUSD: 7.9 }));
    await applyRefundEvent(ev({ db: rev, eventId: 'E1', refundId: 'R1', refundedUSD: 2.0 }));

    expect(rev.__get(`bookings/${ORDER}`)!.refundedUSDTotal)
      .toBe(fwd.__get(`bookings/${ORDER}`)!.refundedUSDTotal);
    expect(rev.__get(`bookings/${ORDER}`)!.status).toBe('REFUNDED');
  });
});

describe('이벤트 멱등 — 같은 이벤트/같은 환불은 한 번만', () => {
  it('같은 eventId 를 동시에 2번 받아도 1번만 반영', async () => {
    const db = createFakeFirestore(seedBooking());
    const barrier = makeBarrier(2);
    db.__beforeCommit = async ({ attempt }) => { if (attempt === 1) await barrier.wait(); };

    const results = await Promise.all([
      applyRefundEvent(ev({ db, eventId: 'SAME', refundId: 'REF-1', refundedUSD: 5 })),
      applyRefundEvent(ev({ db, eventId: 'SAME', refundId: 'REF-1', refundedUSD: 5 })),
    ]);

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.find((r) => !r.applied)!.reason).toBe('duplicate_event');
    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBe(5);
  });

  it('다른 eventId 지만 같은 refundId 면 두 번 누적하지 않는다', async () => {
    const db = createFakeFirestore(seedBooking());
    const first = await applyRefundEvent(ev({ db, eventId: 'EVT-1', refundId: 'REF-SAME', refundedUSD: 5 }));
    const second = await applyRefundEvent(ev({ db, eventId: 'EVT-2', refundId: 'REF-SAME', refundedUSD: 5 }));

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('duplicate_refund');
    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBe(5);
    // 재전송을 계속 재처리하지 않도록 이벤트 자체는 처리 완료로 닫는다.
    expect(db.__get('paypal_webhook_log/EVT-2')!.status).toBe('processed');
  });

  it('다른 실행이 처리 중인 이벤트는 건드리지 않는다 (in_flight)', async () => {
    const db = createFakeFirestore({
      ...seedBooking(),
      'paypal_webhook_log/EVT-X': { status: 'in_progress', claimedAtMs: 1_000_000 },
    });
    const r = await applyRefundEvent(ev({
      db, eventId: 'EVT-X', refundId: 'R', refundedUSD: 5,
      nowMs: 1_000_000 + REFUND_EVENT_IN_FLIGHT_MS - 1,
    }));
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('in_flight');
    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBeUndefined();
  });

  it('선점이 만료된(죽은) 이벤트는 다시 처리한다', async () => {
    const db = createFakeFirestore({
      ...seedBooking(),
      'paypal_webhook_log/EVT-X': { status: 'in_progress', claimedAtMs: 1_000_000 },
    });
    const r = await applyRefundEvent(ev({
      db, eventId: 'EVT-X', refundId: 'R', refundedUSD: 5,
      nowMs: 1_000_000 + REFUND_EVENT_IN_FLIGHT_MS + 1,
    }));
    expect(r.applied).toBe(true);
  });
});

describe('실패 주입 — 부분 갱신이 남지 않는다', () => {
  it('커밋 직전 실패하면 예약도 로그도 안 바뀐다 (재시도 가능)', async () => {
    const db = createFakeFirestore({
      ...seedBooking(),
      'pending_bookings/CT-20260729-001': { status: 'CONFIRMED', priceKRW: 13300 },
    });
    db.__beforeCommit = async () => { throw new Error('firestore down'); };

    await expect(applyRefundEvent(ev({ db, eventId: 'E-FAIL', refundId: 'R-FAIL', refundedUSD: 5 })))
      .rejects.toThrow('firestore down');

    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBeUndefined();
    expect(db.__get('pending_bookings/CT-20260729-001')!.refundedUSDTotal).toBeUndefined();
    expect(db.__get('paypal_webhook_log/E-FAIL')).toBeUndefined();   // processed 로 안 남는다
  });

  it('실패 후 재시도하면 정확히 한 번만 반영된다', async () => {
    const db = createFakeFirestore({
      ...seedBooking(),
      'pending_bookings/CT-20260729-001': { status: 'CONFIRMED', priceKRW: 13300 },
    });
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    await expect(applyRefundEvent(ev({ db, eventId: 'E1', refundId: 'R1', refundedUSD: 9.9 })))
      .rejects.toThrow();

    db.__beforeCommit = null;   // 복구
    const retry = await applyRefundEvent(ev({ db, eventId: 'E1', refundId: 'R1', refundedUSD: 9.9 }));

    expect(retry.applied).toBe(true);
    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBe(9.9);
    expect(db.__get('pending_bookings/CT-20260729-001')!.refundedUSDTotal).toBe(9.9);
  });

  it('예약 2벌은 항상 함께 갱신된다 (한쪽만 갱신된 채 processed 불가)', async () => {
    const db = createFakeFirestore({
      ...seedBooking(),
      'pending_bookings/CT-20260729-001': { status: 'CONFIRMED', priceKRW: 13300 },
    });
    await applyRefundEvent(ev({ db, eventId: 'E1', refundId: 'R1', refundedUSD: 4 }));

    const b = db.__get(`bookings/${ORDER}`)!;
    const p = db.__get('pending_bookings/CT-20260729-001')!;
    expect(b.refundedUSDTotal).toBe(p.refundedUSDTotal);
    expect(b.status).toBe(p.status);
    expect(db.__get('paypal_webhook_log/E1')!.status).toBe('processed');
  });

  it('갱신할 예약이 없으면 processed 로 못 박지 않는다 (나중에 재처리 가능)', async () => {
    const db = createFakeFirestore({});
    const r = await applyRefundEvent(ev({ db, eventId: 'E1', refundId: 'R1', refundedUSD: 5 }));
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('unmatched');
    expect(db.__get('paypal_webhook_log/E1')).toBeUndefined();
  });
});

describe('상태 단조성 — 전액환불은 되돌아가지 않는다', () => {
  it('전액환불 뒤 늦게 도착한 작은 부분환불이 상태를 내리지 못한다', async () => {
    const db = createFakeFirestore(seedBooking());
    await applyRefundEvent(ev({ db, eventId: 'E-FULL', refundId: 'R-FULL', refundedUSD: 9.9 }));
    expect(db.__get(`bookings/${ORDER}`)!.status).toBe('REFUNDED');

    // 늦게 도착한 별개의 작은 환불 이벤트 (금액은 누계에 더해지되 상태는 유지)
    await applyRefundEvent(ev({ db, eventId: 'E-LATE', refundId: 'R-LATE', refundedUSD: 0.5 }));
    expect(db.__get(`bookings/${ORDER}`)!.status).toBe('REFUNDED');
    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBe(10.4);
  });

  it('decideRefundStatus 는 서열이 낮은 상태로 내려가지 않는다', () => {
    expect(decideRefundStatus({
      priorStatus: 'REFUNDED', cumulativeRefundedUSD: 0.5, originalUSD: 9.9,
    })).toBe('REFUNDED');
    expect(decideRefundStatus({
      priorStatus: 'CONFIRMED', cumulativeRefundedUSD: 0.5, originalUSD: 9.9,
    })).toBe('PARTIALLY_REFUNDED');
  });
});

describe('판정 근거 — PayPal 권위 상태 우선, 환율 배제', () => {
  it('PayPal 이 REFUNDED 라고 하면 우리 누계가 모자라도 전액으로 본다', async () => {
    const db = createFakeFirestore(seedBooking());
    await applyRefundEvent(ev({
      db, eventId: 'E1', refundId: 'R1', refundedUSD: 4,
      authoritativeCaptureStatus: 'REFUNDED',
    }));
    expect(db.__get(`bookings/${ORDER}`)!.status).toBe('REFUNDED');
  });

  it('PayPal 이 PARTIALLY_REFUNDED 면 누계가 넘쳐도 부분으로 본다', () => {
    expect(decideRefundStatus({
      cumulativeRefundedUSD: 99, originalUSD: 9.9,
      authoritativeCaptureStatus: 'PARTIALLY_REFUNDED',
    })).toBe('PARTIALLY_REFUNDED');
  });

  it('환율이 판정에 개입하지 않는다 — 원결제 USD 를 알면 KRW 는 무시', () => {
    // $9.06 전액환불을 엉뚱한 환율로 환산하면 KRW 기준으로는 "부분"이 된다.
    expect(decideRefundStatus({
      cumulativeRefundedUSD: 9.06, originalUSD: 9.06,
      priceKRW: 13300, cumulativeRefundedKRW: 12956,
    })).toBe('REFUNDED');
  });

  it('원결제 USD 를 모르는 레거시 문서만 KRW 로 폴백한다', () => {
    expect(decideRefundStatus({
      cumulativeRefundedUSD: 5, originalUSD: 0,
      priceKRW: 13300, cumulativeRefundedKRW: 13300,
    })).toBe('REFUNDED');
    expect(decideRefundStatus({
      cumulativeRefundedUSD: 5, originalUSD: 0,
      priceKRW: 13300, cumulativeRefundedKRW: 5000,
    })).toBe('PARTIALLY_REFUNDED');
  });

  it('원결제 금액을 전혀 모르면 전액으로 단정하지 않는다', () => {
    expect(decideRefundStatus({ cumulativeRefundedUSD: 5 })).toBe('PARTIALLY_REFUNDED');
  });
});

describe('검증되지 않은 웹훅은 아무것도 건드리지 못한다', () => {
  it('webhookEnvironment 생략(=unverified) → 격리', async () => {
    const db = createFakeFirestore(seedBooking());
    const r = await applyRefundEvent({
      db, FieldValue, eventId: 'E-NOENV', eventType: 'PAYMENT.CAPTURE.REFUNDED',
      refundId: 'R', captureId: CAPTURE, refundedUSD: 5, refundedKRW: 0,
      bookingsDocId: ORDER, bookingRef: 'CT-20260729-001',
    } as never);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('environment_mismatch');
    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBeUndefined();
  });
});

describe('레거시 불일치 — 이미 돌려준 돈을 잊지 않는다', () => {
  it('두 저장소 누계가 다르면 큰 쪽을 이어받는다', async () => {
    const db = createFakeFirestore({
      ...seedBooking({ refundedUSDTotal: 0 }),
      'pending_bookings/CT-20260729-001': { status: 'PARTIALLY_REFUNDED', refundedUSDTotal: 5 },
    });
    await applyRefundEvent(ev({ db, eventId: 'E1', refundId: 'R1', refundedUSD: 4.9 }));
    expect(db.__get(`bookings/${ORDER}`)!.refundedUSDTotal).toBe(9.9);
    expect(db.__get(`bookings/${ORDER}`)!.status).toBe('REFUNDED');
  });

  it('어느 저장소에 기록된 refundId 든 중복으로 걸린다', async () => {
    const db = createFakeFirestore({
      ...seedBooking(),
      'pending_bookings/CT-20260729-001': {
        status: 'PARTIALLY_REFUNDED',
        refundEvents: { 'REF-OLD': { usd: 5 } },
      },
    });
    const r = await applyRefundEvent(ev({ db, eventId: 'E-NEW', refundId: 'REF-OLD', refundedUSD: 5 }));
    expect(r.reason).toBe('duplicate_refund');
  });
});
