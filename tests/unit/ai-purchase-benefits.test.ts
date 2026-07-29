import { describe, expect, it } from 'vitest';
import {
  createFakeFirestore,
  FieldValue,
  makeBarrier,
} from '../helpers/fake-firestore.js';
import { activateAiPlannerPurchase } from '../../api/_shared/ai-purchase-benefits.js';
import { applyRefundEvent } from '../../api/_shared/refund-ledger.js';

const ORDER = 'ORDER-AI-1';
const UID = 'USER-AI-1';

function seed(status = 'CONFIRMED') {
  return {
    [`bookings/${ORDER}`]: {
      orderID: ORDER,
      bookingRef: 'CT-AI-1',
      uid: UID,
      captureID: 'CAP-AI-1',
      amountUSD: 9.9,
      amountKRW: 13300,
      currency: 'USD',
      paymentVerified: true,
      productType: 'ai_planner_full',
      paypalEnvironment: 'live',
      status,
    },
    [`users/${UID}`]: {
      aiFeaturesUnlocked: false,
      activeAiPlannerPurchaseCount: 0,
    },
  };
}

describe('AI 유료 해금 원장', () => {
  it('orderID당 한 번만 활성화한다', async () => {
    const db = createFakeFirestore(seed());
    const first = await activateAiPlannerPurchase({
      db: db as never,
      FieldValue,
      uid: UID,
      orderID: ORDER,
    });
    const second = await activateAiPlannerPurchase({
      db: db as never,
      FieldValue,
      uid: UID,
      orderID: ORDER,
    });

    expect(first.activated).toBe(true);
    expect(second.alreadyActive).toBe(true);
    expect(db.__get(`users/${UID}`)!.activeAiPlannerPurchaseCount).toBe(1);
    expect(db.__get(`users/${UID}/aiPlannerPurchases/${ORDER}`)!.status).toBe('active');
  });

  it('이미 전액환불된 예약은 활성화하지 않는다', async () => {
    const db = createFakeFirestore(seed('REFUNDED'));
    const result = await activateAiPlannerPurchase({
      db: db as never,
      FieldValue,
      uid: UID,
      orderID: ORDER,
    });
    expect(result.reason).toBe('booking-refunded-or-canceled');
    expect(db.__get(`users/${UID}`)!.aiFeaturesUnlocked).toBe(false);
    expect(db.__get(`users/${UID}/aiPlannerPurchases/${ORDER}`)).toBeUndefined();
  });

  it('활성화와 전액환불이 동시에 와도 최종 상태는 환불로 수렴한다', async () => {
    const db = createFakeFirestore(seed());
    const barrier = makeBarrier(2);
    db.__beforeCommit = async ({ attempt }: { attempt: number }) => {
      if (attempt === 1) await barrier.wait();
    };

    await Promise.all([
      activateAiPlannerPurchase({
        db: db as never,
        FieldValue,
        uid: UID,
        orderID: ORDER,
      }),
      applyRefundEvent({
        db: db as never,
        FieldValue,
        eventId: 'EVT-AI-REFUND',
        eventType: 'PAYMENT.CAPTURE.REFUNDED',
        refundId: 'REF-AI-1',
        captureId: 'CAP-AI-1',
        refundedUSD: 9.9,
        refundedKRW: 13300,
        bookingsDocId: ORDER,
        bookingRef: 'CT-AI-1',
        authoritativeCaptureStatus: 'REFUNDED',
        webhookEnvironment: 'live',
      }),
    ]);

    expect(db.__get(`bookings/${ORDER}`)!.status).toBe('REFUNDED');
    expect(db.__get(`users/${UID}`)!.activeAiPlannerPurchaseCount || 0).toBe(0);
    expect(db.__get(`users/${UID}`)!.aiFeaturesUnlocked).toBe(false);
    const purchase = db.__get(`users/${UID}/aiPlannerPurchases/${ORDER}`);
    expect(purchase && purchase.status).not.toBe('active');
  });
});
