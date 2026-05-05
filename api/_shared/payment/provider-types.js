/**
 * CocoTripKR — Payment Provider 추상화 타입 정의 (JSDoc).
 *
 * 운영 배경: PayPal 한국 / Toss Payments 신청 결과 대기 중. 결정되면 빠른 교체
 * 가능하도록 abstraction layer 도입. 현재 활성: Braintree (PayPal 자회사).
 *
 * 모든 구현은 동일한 인터페이스를 만족해야 함:
 *   - name (string)               — provider 식별자 ('braintree' | 'toss' | ...)
 *   - createTransaction(input)    — 결제 captured 트랜잭션 생성
 *   - refundTransaction(id, amt?) — 환불 (전액/부분)
 *   - findTransaction(id)         — 트랜잭션 조회
 *   - generateClientToken(custId?)— 클라이언트 측 결제 위젯용 token
 *
 * Status 정규화: Braintree 가 reference. 다른 provider 는 normalizeStatus()
 * 에서 generic enum 으로 매핑 — authorized | submitted_for_settlement |
 * settled | refunded | voided | failed
 */

/**
 * @typedef {Object} CreateTransactionInput
 * @property {string} nonce             클라이언트가 발급받은 결제 수단 nonce / paymentKey
 * @property {string} amount            "9.85" 같은 string (provider 별로 단위 다를 수 있음)
 * @property {string} [currency]        "USD" / "KRW" 등. provider 가 지원하는 ISO code
 * @property {string} [orderId]         자체 booking ID (idempotency / 매핑 용)
 * @property {{firstName?: string, lastName?: string, email?: string}} [customer]
 * @property {Object} [metadata]        provider 특화 추가 필드 (passthrough)
 */

/**
 * @typedef {Object} TransactionResult
 * @property {string} id                provider 측 트랜잭션 ID
 * @property {string} status            정규화된 status (authorized|submitted_for_settlement|settled|refunded|voided|failed)
 * @property {string} rawStatus         provider 원본 status
 * @property {string} amount            결제된 금액 (string)
 * @property {string} [currency]        ISO currency
 * @property {string} [orderId]         자체 booking ID (있을 경우)
 * @property {string} provider          'braintree' | 'toss' | ...
 * @property {Object} raw               provider 응답 원본 (디버깅용)
 */

/**
 * @typedef {Object} PaymentProvider
 * @property {string} name
 * @property {(input: CreateTransactionInput) => Promise<TransactionResult>} createTransaction
 * @property {(transactionId: string, amount?: string) => Promise<TransactionResult>} refundTransaction
 * @property {(transactionId: string) => Promise<TransactionResult>} findTransaction
 * @property {(customerId?: string) => Promise<string>} generateClientToken
 */

export const NORMALIZED_STATUSES = Object.freeze({
  AUTHORIZED: 'authorized',
  SUBMITTED_FOR_SETTLEMENT: 'submitted_for_settlement',
  SETTLED: 'settled',
  REFUNDED: 'refunded',
  VOIDED: 'voided',
  FAILED: 'failed',
});
