/**
 * CocoTripKR — Payment Provider 선택 entry point.
 *
 * 환경 변수 PAYMENT_PROVIDER 로 결정 (옵셔널, default: 'braintree').
 * 현재 endpoint 들은 braintree.js 직접 사용 — 본 모듈은 추상화 layer 도입을
 * 위한 첫 단계. Toss 정식 구현 시 endpoint 들을 getActiveProvider() 로 점진 마이그레이션.
 *
 * 사용 예:
 *   import { getActiveProvider } from './payment/index.js';
 *   const provider = getActiveProvider();
 *   const tx = await provider.createTransaction({ nonce, amount: '9.85', orderId });
 */
import { braintreeProvider } from './braintree-provider.js';
import { tossProvider } from './toss-provider.js';

const PROVIDERS = Object.freeze({
  braintree: braintreeProvider,
  toss: tossProvider,
});

let _activeProvider = null;

/**
 * 활성 provider 반환 (싱글톤). PAYMENT_PROVIDER env 미설정 시 'braintree'.
 * @returns {import('./provider-types.js').PaymentProvider}
 */
export function getActiveProvider() {
  if (_activeProvider) return _activeProvider;
  const key = (process.env.PAYMENT_PROVIDER || 'braintree').toLowerCase().trim();
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(
      `Unknown PAYMENT_PROVIDER: ${key}. Supported: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  console.log(`[payment] active provider: ${provider.name}`);
  _activeProvider = provider;
  return provider;
}

/**
 * 테스트용 — 캐시된 provider reset (PAYMENT_PROVIDER 변경 후 재선택 가능).
 * 프로덕션 코드에서는 호출 금지.
 */
export function _resetActiveProviderForTesting() {
  _activeProvider = null;
}

export { braintreeProvider, tossProvider, PROVIDERS };
export { NORMALIZED_STATUSES } from './provider-types.js';
