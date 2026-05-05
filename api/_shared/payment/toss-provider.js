/**
 * CocoTripKR — Toss Payments PaymentProvider STUB.
 *
 * 운영자: Toss Payments 신청 결과 대기 중 (2026-05-05). 승인되면 본 stub 을
 * 정식 구현으로 교체. 현재는 PAYMENT_PROVIDER=toss 로 활성화 시도하면
 * 명시적 throw — silent fallback 금지.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 구현 가이드 (다음 PR)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * [환경 변수]
 *   TOSS_CLIENT_KEY   — 클라이언트 측 widget 초기화 (NEXT_PUBLIC_ 접두 필요할 수 있음)
 *   TOSS_SECRET_KEY   — 서버 측. 절대 client 노출 금지.
 *   TOSS_ENV          — 'sandbox' | 'live' (default: 'sandbox')
 *
 * [Status 매핑 (Toss → Generic)]
 *   READY                  → authorized
 *   IN_PROGRESS            → submitted_for_settlement
 *   WAITING_FOR_DEPOSIT    → submitted_for_settlement
 *   DONE                   → settled
 *   CANCELED               → refunded   (전액 환불)
 *   PARTIAL_CANCELED       → refunded   (일부 환불)
 *   ABORTED                → failed
 *   EXPIRED                → failed
 *
 * [API endpoints]
 *   POST   https://api.tosspayments.com/v1/payments/confirm
 *     Body: { paymentKey, orderId, amount }
 *     Authorization: Basic base64(`${TOSS_SECRET_KEY}:`)
 *
 *   POST   https://api.tosspayments.com/v1/payments/${paymentKey}/cancel
 *     Body: { cancelReason, cancelAmount? }
 *
 *   GET    https://api.tosspayments.com/v1/payments/${paymentKey}
 *
 * [Client-side]
 *   - 패키지: @tosspayments/payment-widget-sdk (또는 tosspayments JS widget)
 *   - 초기화: TOSS_CLIENT_KEY 로 init → widget 렌더 → onApprove 시점에
 *     paymentKey + orderId + amount 를 서버 confirm endpoint 로 전달
 *
 * [Idempotency]
 *   - Toss 는 orderId 가 unique → 동일 orderId 로 confirm 재호출 시 기존 결과 반환
 *   - 우리 측 booking ID 를 orderId 로 사용 (현재 Braintree 와 동일 패턴)
 *
 * [refundTransaction 매개변수]
 *   - Braintree 는 transactionId 사용; Toss 는 paymentKey 사용
 *   - Provider 추상화 layer 에서는 "captureId" 라는 추상 ID 로 통일
 *     (Braintree provider 에서는 transaction.id, Toss provider 에서는 paymentKey)
 */
import { NORMALIZED_STATUSES } from './provider-types.js';

const NOT_IMPLEMENTED_MSG =
  'Toss Payments provider not implemented yet. Use PAYMENT_PROVIDER=braintree until Toss approval lands.';

/**
 * Toss status → 정규화된 status enum (사전 정의, 정식 구현에서 활용).
 * @param {string} tossStatus
 */
export function normalizeStatus(tossStatus) {
  if (!tossStatus) return NORMALIZED_STATUSES.FAILED;
  const s = String(tossStatus).toUpperCase();
  switch (s) {
    case 'READY':
      return NORMALIZED_STATUSES.AUTHORIZED;
    case 'IN_PROGRESS':
    case 'WAITING_FOR_DEPOSIT':
      return NORMALIZED_STATUSES.SUBMITTED_FOR_SETTLEMENT;
    case 'DONE':
      return NORMALIZED_STATUSES.SETTLED;
    case 'CANCELED':
    case 'PARTIAL_CANCELED':
      return NORMALIZED_STATUSES.REFUNDED;
    case 'ABORTED':
    case 'EXPIRED':
      return NORMALIZED_STATUSES.FAILED;
    default:
      return s.toLowerCase();
  }
}

/** @type {import('./provider-types.js').PaymentProvider} */
export const tossProvider = {
  name: 'toss',

  async createTransaction(_input) {
    throw new Error(`[toss-provider] createTransaction: ${NOT_IMPLEMENTED_MSG}`);
  },

  async refundTransaction(_transactionId, _amount) {
    throw new Error(`[toss-provider] refundTransaction: ${NOT_IMPLEMENTED_MSG}`);
  },

  async findTransaction(_transactionId) {
    throw new Error(`[toss-provider] findTransaction: ${NOT_IMPLEMENTED_MSG}`);
  },

  async generateClientToken(_customerId) {
    throw new Error(`[toss-provider] generateClientToken: ${NOT_IMPLEMENTED_MSG}`);
  },
};
