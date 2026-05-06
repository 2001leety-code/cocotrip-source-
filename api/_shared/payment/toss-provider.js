/**
 * CocoTripKR — Toss Payments PaymentProvider 정식 구현.
 *
 * 운영 배경 (2026-05-06): 운영자 결정 — Toss Payments 채택 (PayPal 한국 / Braintree
 * 대체). 가입 승인 대기 중. 코드 사전 배포 + 활성화 시 env 만 변경 → 즉시 prod.
 *
 * 활성화 절차:
 *   1. 운영자 Toss Payments 가입 (docs/TOSS-PAYMENTS-SETUP.md)
 *   2. Vercel env 등록: TOSS_CLIENT_KEY / TOSS_SECRET_KEY / TOSS_ENV
 *   3. 동일 환경에 PAYMENT_PROVIDER=toss 설정
 *   4. 배포 후 sandbox E2E 4 시나리오 (정상 결제·전액 환불·부분 환불·실패) 검증
 *   5. TOSS_ENV='live' 전환
 *
 * Toss API reference: https://docs.tosspayments.com/reference
 *
 * 주요 차이점 (Braintree 대비):
 *   - Toss 는 client widget 에서 사용자가 결제 정보 입력 + 동의까지 마친 후
 *     server 에 paymentKey 전달. server 는 paymentKey + orderId + amount 로
 *     /v1/payments/confirm 호출 → 실제 결제 확정.
 *   - 우리 abstraction 의 `nonce` 가 Toss `paymentKey` 에 해당.
 *   - orderId 필수 — 자체 booking ID 사용 (idempotency 자동).
 *   - amount 는 number (KRW). USD 미지원 — 환산은 호출처에서.
 *
 * Status 매핑 (Toss → Generic):
 *   READY                  → authorized
 *   IN_PROGRESS            → submitted_for_settlement
 *   WAITING_FOR_DEPOSIT    → submitted_for_settlement
 *   DONE                   → settled
 *   CANCELED               → refunded   (전액)
 *   PARTIAL_CANCELED       → refunded   (부분)
 *   ABORTED                → failed
 *   EXPIRED                → failed
 */
import { Buffer } from 'node:buffer';
import { NORMALIZED_STATUSES } from './provider-types.js';

const TOSS_API_BASE = 'https://api.tosspayments.com/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Authorization header (Basic base64) — Toss Secret Key 인증.
 * @returns {string}
 */
function buildAuthHeader() {
  const secret = (process.env.TOSS_SECRET_KEY || '').trim();
  if (!secret) {
    throw new Error('[toss-provider] TOSS_SECRET_KEY env not set');
  }
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`;
}

/**
 * Toss API 호출 wrapper — JSON body / Auth / timeout / 에러 정규화.
 * @param {string} path
 * @param {RequestInit & { body?: object }} [init]
 */
async function tossFetch(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${TOSS_API_BASE}${path}`, {
      ...init,
      method: init.method || 'GET',
      headers: {
        'Authorization': buildAuthHeader(),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* 빈 응답 (HTTP 204 등) */ }
  if (!res.ok) {
    const message = json?.message || `Toss API ${res.status} ${res.statusText}`;
    const err = new Error(`[toss-provider] ${message}`);
    err.status = res.status;
    err.code = json?.code;
    err.toss = json;
    throw err;
  }
  return json;
}

/**
 * Toss status → 정규화된 status enum.
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

/**
 * Toss Payment object → TransactionResult.
 * @param {object} payment Toss API 응답 (Payment object)
 * @returns {import('./provider-types.js').TransactionResult}
 */
export function toTransactionResult(payment) {
  if (!payment || !payment.paymentKey) {
    throw new Error('[toss-provider] empty/invalid payment object');
  }
  return {
    id: payment.paymentKey,
    status: normalizeStatus(payment.status),
    rawStatus: payment.status,
    // Toss totalAmount 는 KRW number — abstraction 은 string 으로 통일.
    amount: String(payment.totalAmount ?? payment.balanceAmount ?? 0),
    currency: payment.currency || 'KRW',
    orderId: payment.orderId,
    provider: 'toss',
    raw: payment,
  };
}

/** @type {import('./provider-types.js').PaymentProvider} */
export const tossProvider = {
  name: 'toss',

  /**
   * Toss /payments/confirm 호출 → 결제 확정.
   *   nonce      → Toss paymentKey (client widget 이 발급)
   *   amount     → KRW number. (string 으로 들어와도 Number() 캐스팅)
   *   orderId    → 자체 booking ID. 필수 (Toss idempotency 키).
   *
   * Toss 는 amount 를 number 로 받음. 우리 abstraction 의 string amount 를 캐스팅.
   */
  async createTransaction(input) {
    const { nonce: paymentKey, amount, orderId, currency = 'KRW' } = input || {};
    if (!paymentKey) throw new Error('[toss-provider] createTransaction: paymentKey required');
    if (!orderId) throw new Error('[toss-provider] createTransaction: orderId required (Toss idempotency 필수)');
    if (!amount) throw new Error('[toss-provider] createTransaction: amount required');
    if (currency !== 'KRW') {
      console.warn(`[toss-provider] currency=${currency} 경고 — Toss 는 KRW 만 권장`);
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error(`[toss-provider] amount invalid: ${amount}`);
    }
    const payment = await tossFetch('/payments/confirm', {
      method: 'POST',
      body: { paymentKey, orderId, amount: numericAmount },
    });
    return toTransactionResult(payment);
  },

  /**
   * Toss /payments/{paymentKey}/cancel 호출 → 환불 (전액 또는 부분).
   *   transactionId → Toss paymentKey
   *   amount        → 부분 환불 시 KRW number. 미지정 시 전액.
   */
  async refundTransaction(transactionId, amount) {
    if (!transactionId) throw new Error('[toss-provider] refundTransaction: paymentKey required');
    const body = { cancelReason: 'CocoTrip refund' };
    if (amount !== undefined && amount !== null) {
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error(`[toss-provider] refundTransaction: amount invalid: ${amount}`);
      }
      body.cancelAmount = numericAmount;
    }
    const payment = await tossFetch(`/payments/${encodeURIComponent(transactionId)}/cancel`, {
      method: 'POST',
      body,
    });
    return toTransactionResult(payment);
  },

  async findTransaction(transactionId) {
    if (!transactionId) throw new Error('[toss-provider] findTransaction: paymentKey required');
    const payment = await tossFetch(`/payments/${encodeURIComponent(transactionId)}`);
    return toTransactionResult(payment);
  },

  /**
   * Toss client key 반환 — frontend widget 초기화용.
   * 정적 public key 라 API 호출 없이 env 에서 즉시 반환.
   */
  async generateClientToken(_customerId) {
    const clientKey = (process.env.TOSS_CLIENT_KEY || '').trim();
    if (!clientKey) {
      throw new Error('[toss-provider] TOSS_CLIENT_KEY env not set');
    }
    return clientKey;
  },
};
