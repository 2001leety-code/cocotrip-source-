// ─────────────────────────────────────────────────────────────────────────────
// MANUAL- 결제 우회 가드 — 상품종류·소유자 바인딩 회귀 테스트 (2026-07-21)
//
// 배경 (보안 감사): api/_ai_core/paymentGate.js 의 MANUAL- 분기는 예전에
//   `pending_bookings/{ref}.status === 'CONFIRMED'` 단 하나만 검사했다. PayPal 분기와
//   달리 상품종류·소유자·금액 검증이 없어서:
//     - pending_bookings 는 투어·차터·AI플래너 공유 컬렉션 → CONFIRMED 상태인 값싼 투어
//       예약의 bookingRef 하나만 알면 `MANUAL-<ref>` 로 유료 AI 플랜($9.90)을 무료 취득.
//     - bookingRef(CT-YYYYMMDD-XXX)가 열거 가능 → 남의 CONFIRMED ref 로도 통과하고
//       플랜은 공격자 uid 로 저장됨(교차사용자 IDOR).
//     - used_paypal_orders 멱등키는 비-AI ref 에 대해 비어 있어 최초 호출이 통과.
//
// fix: PayPal 분기와 대칭인 (1) 상품 바인딩(isAiPlannerFullProduct) + (2) 소유자 바인딩
//   (pending.userId==uid 또는 pending.customerEmail==인증email) 을 강제.
//   정당 흐름은 서버 트리거(triggerAiPlanner)가 무토큰이라 이 분기 이전 401 이므로
//   깨질 정당 토큰 흐름은 없다(2026-07-21 조사).
//
// 이 테스트가 두 공격 벡터(투어 ref, 교차사용자 ref)를 박제한다.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

// @ts-expect-error — paymentGate.js 는 JS 모듈 (타입 선언 없음)
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

const REF = 'CT-20260720-001';
const ORDER = `MANUAL-${REF}`;
const OWNER_UID = 'owner-uid-123';
const OWNER_EMAIL = 'owner@example.com';

/** pending_bookings/{REF} + used_paypal_orders 를 모델링한 최소 adminDb mock. */
function mockDb(pending: Record<string, unknown> | null, opts: { alreadyUsed?: boolean } = {}) {
  const writes: Array<{ collection: string; id: string }> = [];
  return {
    _writes: writes,
    collection(name: string) {
      return {
        doc: (id: string) => ({
          get: async () => {
            if (name === 'pending_bookings') {
              return pending ? { exists: true, data: () => pending } : { exists: false, data: () => ({}) };
            }
            if (name === 'used_paypal_orders') {
              return { exists: !!opts.alreadyUsed, data: () => ({}) };
            }
            return { exists: false, data: () => ({}) };
          },
          set: async () => { writes.push({ collection: name, id }); },
          update: async () => {},
        }),
        add: async () => {},
      };
    },
  };
}

const AI = { productType: 'ai-planner-full', status: 'CONFIRMED', userId: OWNER_UID, customerEmail: OWNER_EMAIL };

describe('MANUAL- — 상품종류 바인딩 (값싼 투어 ref 공격 차단)', () => {
  it('⭐ 투어 예약 ref (productType != ai-planner) → 403 ORDER_PRODUCT_MISMATCH', async () => {
    const db = mockDb({ productType: 'charter_seoul_city', status: 'CONFIRMED', userId: OWNER_UID, customerEmail: OWNER_EMAIL });
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, OWNER_EMAIL, OWNER_UID);
    expect(result.rejection?.statusCode).toBe(403);
    expect(result.rejection?.code).toBe('ORDER_PRODUCT_MISMATCH');
  });

  it('AI 플래너 상품 (하이픈/언더스코어 변형) 은 상품검사 통과', async () => {
    const db = mockDb({ productType: 'ai_planner_full', status: 'CONFIRMED', userId: OWNER_UID, customerEmail: OWNER_EMAIL });
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, OWNER_EMAIL, OWNER_UID);
    expect(result.rejection).toBeUndefined();
  });
});

describe('MANUAL- — 소유자 바인딩 (교차사용자 IDOR 차단)', () => {
  it('⭐ 남의 CONFIRMED AI 예약 ref + 다른 uid·다른 email → 403 FORBIDDEN', async () => {
    const db = mockDb(AI);
    const result = await enforcePaymentAndRevision(
      { paypalOrderId: ORDER }, db, 'attacker@example.com', 'attacker-uid'
    );
    expect(result.rejection?.statusCode).toBe(403);
    expect(result.rejection?.code).toBe('FORBIDDEN');
  });

  it('소유자 uid 일치 → 통과', async () => {
    const db = mockDb(AI);
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, 'other@example.com', OWNER_UID);
    expect(result.rejection).toBeUndefined();
  });

  it('userId=null 이어도 예약 email 과 인증 email 일치 → 통과 (로그아웃 예약 후 로그인)', async () => {
    const db = mockDb({ productType: 'ai-planner-full', status: 'CONFIRMED', userId: null, customerEmail: OWNER_EMAIL });
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, OWNER_EMAIL, 'some-uid');
    expect(result.rejection).toBeUndefined();
  });

  it('userId=null + email 도 불일치 → 403 (소유 증명 불가)', async () => {
    const db = mockDb({ productType: 'ai-planner-full', status: 'CONFIRMED', userId: null, customerEmail: OWNER_EMAIL });
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, 'attacker@example.com', 'attacker-uid');
    expect(result.rejection?.statusCode).toBe(403);
  });
});

describe('MANUAL- — 기존 가드 유지 (회귀 없음)', () => {
  it('pending 없음 → 404 PENDING_NOT_FOUND', async () => {
    const db = mockDb(null);
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, OWNER_EMAIL, OWNER_UID);
    expect(result.rejection?.statusCode).toBe(404);
  });

  it('status != CONFIRMED → 403 PAYMENT_NOT_CONFIRMED', async () => {
    const db = mockDb({ ...AI, status: 'AWAITING_VERIFICATION' });
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, OWNER_EMAIL, OWNER_UID);
    expect(result.rejection?.code).toBe('PAYMENT_NOT_CONFIRMED');
  });

  it('정당 소유자 재사용(멱등) → 403 DUPLICATE_ORDER', async () => {
    const db = mockDb(AI, { alreadyUsed: true });
    const result = await enforcePaymentAndRevision({ paypalOrderId: ORDER }, db, OWNER_EMAIL, OWNER_UID);
    expect(result.rejection?.code).toBe('DUPLICATE_ORDER');
  });
});
