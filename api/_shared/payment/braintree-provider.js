/**
 * CocoTripKR — Braintree PaymentProvider 구현.
 *
 * 기존 `api/_shared/braintree.js` 의 함수들을 PaymentProvider interface 로 wrap.
 * 기존 endpoint 들은 braintree.js 직접 참조 — 본 모듈은 추상화 layer 진입점만 제공.
 * (Toss 도입 시 endpoint 들은 이 wrapper 사용으로 점진 마이그레이션 예정)
 *
 * Status 정규화 (Braintree → Generic):
 *   authorized                    → authorized
 *   submitted_for_settlement      → submitted_for_settlement
 *   settling / settled            → settled
 *   refunded                      → refunded
 *   voided                        → voided
 *   processor_declined / gateway_rejected / failed → failed
 *   기타                          → 원본 그대로 lowercase
 */
import {
  generateClientToken as btGenerateClientToken,
  createTransaction as btCreateTransaction,
  findTransaction as btFindTransaction,
  refundTransaction as btRefundTransaction,
} from '../braintree.js';
import { NORMALIZED_STATUSES } from './provider-types.js';

/**
 * Braintree status string → 정규화된 status enum.
 * Braintree status reference: https://developer.paypal.com/braintree/docs/reference/general/statuses
 * @param {string} btStatus
 * @returns {string}
 */
function normalizeStatus(btStatus) {
  if (!btStatus) return NORMALIZED_STATUSES.FAILED;
  const s = String(btStatus).toLowerCase();
  switch (s) {
    case 'authorized':
    case 'authorizing':
      return NORMALIZED_STATUSES.AUTHORIZED;
    case 'submitted_for_settlement':
    case 'settlement_pending':
      return NORMALIZED_STATUSES.SUBMITTED_FOR_SETTLEMENT;
    case 'settling':
    case 'settled':
    case 'settlement_confirmed':
      return NORMALIZED_STATUSES.SETTLED;
    case 'refunded':
      return NORMALIZED_STATUSES.REFUNDED;
    case 'voided':
      return NORMALIZED_STATUSES.VOIDED;
    case 'processor_declined':
    case 'gateway_rejected':
    case 'settlement_declined':
    case 'failed':
      return NORMALIZED_STATUSES.FAILED;
    default:
      return s;
  }
}

/**
 * Braintree transaction object → TransactionResult.
 * @param {object} tx
 * @returns {import('./provider-types.js').TransactionResult}
 */
function toTransactionResult(tx) {
  if (!tx) {
    throw new Error('[braintree-provider] empty transaction object');
  }
  return {
    id: tx.id,
    status: normalizeStatus(tx.status),
    rawStatus: tx.status,
    amount: tx.amount,
    currency: tx.currencyIsoCode,
    orderId: tx.orderId,
    provider: 'braintree',
    raw: tx,
  };
}

/** @type {import('./provider-types.js').PaymentProvider} */
export const braintreeProvider = {
  name: 'braintree',

  async createTransaction(input) {
    const { nonce, amount, currency = 'USD', orderId, customer } = input || {};
    if (!nonce) throw new Error('[braintree-provider] createTransaction: nonce required');
    if (!amount) throw new Error('[braintree-provider] createTransaction: amount required');
    const tx = await btCreateTransaction({ nonce, amount, currency, orderId, customer });
    return toTransactionResult(tx);
  },

  async refundTransaction(transactionId, amount) {
    if (!transactionId) throw new Error('[braintree-provider] refundTransaction: transactionId required');
    const tx = await btRefundTransaction(transactionId, amount);
    return toTransactionResult(tx);
  },

  async findTransaction(transactionId) {
    if (!transactionId) throw new Error('[braintree-provider] findTransaction: transactionId required');
    const tx = await btFindTransaction(transactionId);
    return toTransactionResult(tx);
  },

  async generateClientToken(customerId) {
    return btGenerateClientToken(customerId);
  },
};

// 테스트/디버그용 export
export { normalizeStatus, toTransactionResult };
