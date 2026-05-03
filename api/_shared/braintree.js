/**
 * CocoTripKR — Braintree gateway singleton.
 *
 * 한국 PayPal Business 계정은 직접 PayPal SDK (paypal.com/sdk/js) 사용 불가
 * (CDN reject 확인됨, 2026-05-03). PayPal이 보낸 안내 이메일대로 Braintree 통합으로
 * 전환. Braintree는 PayPal 자회사로 동일 비즈니스 계정 + 기존 머천트 자격 사용.
 *
 * 환경변수:
 *   BRAINTREE_ENV               'sandbox' | 'production' (default: 'sandbox')
 *   BRAINTREE_MERCHANT_ID       Braintree Dashboard → Settings → API
 *   BRAINTREE_PUBLIC_KEY        동일 페이지
 *   BRAINTREE_PRIVATE_KEY       ⚠️ 절대 client에 노출 금지
 *
 * 클라이언트 측은 별도로 server에서 client token 발급 받아 사용.
 */
import braintree from 'braintree';

let _gateway = null;

function resolveEnvironment(env) {
  // Braintree SDK는 객체 비교로 환경 결정
  if (env === 'production') return braintree.Environment.Production;
  return braintree.Environment.Sandbox;
}

/**
 * 싱글톤 gateway 반환. cold start마다 새로 만들지 않음.
 */
export function getBraintreeGateway() {
  if (_gateway) return _gateway;

  const merchantId = (process.env.BRAINTREE_MERCHANT_ID || '').trim();
  const publicKey = (process.env.BRAINTREE_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.BRAINTREE_PRIVATE_KEY || '').trim();
  const env = (process.env.BRAINTREE_ENV || 'sandbox').trim();

  if (!merchantId || !publicKey || !privateKey) {
    throw new Error(
      'Braintree credentials missing. Set BRAINTREE_MERCHANT_ID, BRAINTREE_PUBLIC_KEY, BRAINTREE_PRIVATE_KEY in Vercel env.'
    );
  }

  _gateway = new braintree.BraintreeGateway({
    environment: resolveEnvironment(env),
    merchantId,
    publicKey,
    privateKey,
  });

  console.log(`[braintree] gateway initialized (env=${env}, merchant=${merchantId.slice(0, 6)}...)`);
  return _gateway;
}

/**
 * 클라이언트가 Drop-in UI 띄울 때 필요한 client token 발급.
 * @param {string} [customerId] - 기존 Braintree customer 있으면 vault된 결제수단 표시
 */
export async function generateClientToken(customerId) {
  const gateway = getBraintreeGateway();
  const opts = customerId ? { customerId } : {};
  const result = await gateway.clientToken.generate(opts);
  if (!result.success) {
    throw new Error(`clientToken generation failed: ${result.message || 'unknown'}`);
  }
  return result.clientToken;
}

/**
 * payment_method_nonce → 실제 transaction 생성 (결제 captured).
 * @param {object} args
 * @param {string} args.nonce - Drop-in UI에서 받은 nonce
 * @param {string} args.amount - "9.85" 같은 USD string
 * @param {string} args.currency - "USD" / "KRW" 등 (account에 enable된 것만)
 * @param {string} [args.orderId] - 자체 booking ID로 매핑
 * @param {object} [args.customer] - { firstName, lastName, email }
 */
export async function createTransaction({ nonce, amount, currency = 'USD', orderId, customer }) {
  const gateway = getBraintreeGateway();
  const result = await gateway.transaction.sale({
    amount,
    paymentMethodNonce: nonce,
    options: {
      submitForSettlement: true,  // 즉시 capture (PayPal과 동일 UX)
    },
    ...(orderId ? { orderId } : {}),
    ...(customer ? { customer } : {}),
    // currencyIsoCode는 multi-currency 활성화된 머천트만 사용 가능. 단일 통화면 생략.
    ...(currency && currency !== 'USD' ? { currencyIsoCode: currency } : {}),
  });

  if (!result.success) {
    const errMsg = result.message || result.errors?.deepErrors?.()?.map(e => e.message).join('; ') || 'unknown';
    throw new Error(`Braintree transaction failed: ${errMsg}`);
  }

  return result.transaction;
}

/**
 * transaction 조회 (orderID 검증 등).
 */
export async function findTransaction(transactionId) {
  const gateway = getBraintreeGateway();
  return gateway.transaction.find(transactionId);
}

/**
 * 환불 — 이미 settled된 transaction에 대해서만 가능.
 * @param {string} transactionId
 * @param {string} [amount] - 일부 환불 시. 생략 시 전액.
 */
export async function refundTransaction(transactionId, amount) {
  const gateway = getBraintreeGateway();
  const result = amount
    ? await gateway.transaction.refund(transactionId, amount)
    : await gateway.transaction.refund(transactionId);
  if (!result.success) {
    throw new Error(`Braintree refund failed: ${result.message || 'unknown'}`);
  }
  return result.transaction;
}

/**
 * 아직 settle되지 않은 transaction 취소 (void).
 * Settled된 건 refundTransaction 사용.
 */
export async function voidTransaction(transactionId) {
  const gateway = getBraintreeGateway();
  const result = await gateway.transaction.void(transactionId);
  if (!result.success) {
    throw new Error(`Braintree void failed: ${result.message || 'unknown'}`);
  }
  return result.transaction;
}
