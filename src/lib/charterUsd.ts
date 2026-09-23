/**
 * 차터 USD 금액의 **단일 기준** (2026-07-30).
 *
 * 고정 KRW 상품의 USD 표기·주문 가드에 같은 1350원/USD와 정수 달러 반올림을 적용한다.
 *
 * 규칙
 *   - 고정 KRW 상품의 USD 는 **이 파일의 함수로만** 만든다. 반올림까지 여기 한 곳에 있다
 *     (서버 `api/createPaypalOrder.js` 의 `Math.round(krwAmount / usdToKrw)` 와 동형).
 *   - 일반 표시환율 함수(`formatPrice`·`convertFromKRW`·`KRW_PER_USD`)는 결제 금액 문구에
 *     쓰지 않는다. `tests/unit/charter-usd-single-source.test.ts` 가 재발을 막는다.
 *   - 판매가·고정환율 정책 자체는 여기서 바꾸지 않는다 — 환산·표기만 담당한다.
 */
import { CHARTER_USD_FIX_RATE } from '@/data/charterPricing';
import spec from '@/data/pricing_spec.json';

type FixedUsdProduct = { unit_price_usd?: number; pricing_unit?: string };
const fixedUsdProducts = (spec as { fixed_usd_products?: Record<string, FixedUsdProduct> }).fixed_usd_products || {};

const PLAN_DETAIL_DAILY_CHARTER_PRODUCTS = new Set([
  'tour_seoul_night',
  'charter_seoul_city',
  'charter_seoul_suburb',
  'charter_dmz',
  'charter_gangwon',
  'charter_ski',
  'charter_gyeongju',
  'charter_busan',
]);

/** PlanDetail 일일 투어 결제 경로만 할인 후 예상 USD 대조를 갱신한다. */
export function isPlanDetailDailyCharterProduct(productType: string): boolean {
  return PLAN_DETAIL_DAILY_CHARTER_PRODUCTS.has(String(productType || '').trim());
}

/**
 * KRW → 고정 정책 USD (정수). 서버 청구 공식과 동일한 순수 함수.
 * 유효하지 않은 입력은 0 — 호출부가 "표시 안 함" 으로 분기할 수 있게 한다.
 */
export function charterUsdFromKrw(krwAmount: number | null | undefined): number {
  const krw = Number(krwAmount);
  if (!Number.isFinite(krw) || krw <= 0) return 0;
  return Math.round(krw / CHARTER_USD_FIX_RATE);
}

/**
 * SSOT 에 USD 정찰가가 있는 SKU 금액. passenger 상품은 정수 인원수만 반영한다.
 * Night tour 는 1인 $49 정본이며 charter night surcharge 를 별도로 붙이지 않는다.
 */
export function fixedUsdAmountForProduct(productType: string, passengers = 1): number | null {
  const key = String(productType || '').trim().toLowerCase().replace(/-/g, '_');
  const product = fixedUsdProducts[key];
  if (!product || typeof product.unit_price_usd !== 'number' || !Number.isFinite(product.unit_price_usd) || product.unit_price_usd <= 0) return null;
  const numericPassengers = Number(passengers);
  if (product.pricing_unit === 'passenger' && (!Number.isSafeInteger(numericPassengers) || numericPassengers < 1)) return null;
  const pax = Number.isSafeInteger(numericPassengers) && numericPassengers > 0 ? numericPassengers : 1;
  const amount = product.pricing_unit === 'passenger' ? product.unit_price_usd * pax : product.unit_price_usd;
  return Math.round(amount * 100) / 100;
}

/**
 * 쿠폰 적용 뒤 화면 KRW와 주문 생성 전 expectedUSD를 같은 금액으로 맞춘다.
 * 할인 전에는 호출부가 약속한 USD를 그대로 보존하고, 할인 후에만 서버와 같은
 * 고정환율·정수 반올림 공식을 다시 적용한다.
 */
export function charterCheckoutExpectedUsd(
  expectedUsd: number | null | undefined,
  displayedKrw: number,
  discountApplied: boolean,
): number | undefined {
  const expected = Number(expectedUsd);
  if (!Number.isFinite(expected) || expected <= 0) return undefined;
  return discountApplied ? charterUsdFromKrw(displayedKrw) : expected;
}

/** "$89" — 통화 코드 없이. */
export function formatCharterUsd(krwAmount: number | null | undefined): string | null {
  const usd = charterUsdFromKrw(krwAmount);
  if (usd <= 0) return null;
  return `$${usd.toLocaleString('en-US')}`;
}

/** "$89 USD" — 결제 직전 통화 명시용. */
export function formatCharterUsdWithCode(krwAmount: number | null | undefined): string | null {
  const usd = formatCharterUsd(krwAmount);
  return usd ? `${usd} USD` : null;
}

/** "₩124,800" — 정책 판매가(원화) 표기. */
export function formatCharterKrw(krwAmount: number | null | undefined): string | null {
  const krw = Number(krwAmount);
  if (!Number.isFinite(krw) || krw <= 0) return null;
  return `₩${Math.round(krw).toLocaleString('ko-KR')}`;
}

/**
 * "$92 USD (₩124,800)" — **언어와 무관하게** 실제 청구액(USD)과 참고 가격(원화)을 함께 적는다.
 *
 * 공개 본문(SEO)·안내 문구는 이걸 쓴다. 언어별 표시통화(ja=¥, zh=¥)로 환산하면 "표시 금액이
 * 결제 금액" 이라는 문장이 거짓이 된다 — 결제는 늘 PayPal USD 다. 두 숫자를 같이 적으면
 * 어느 언어에서도 참이고, 표시환율 함수가 끼어들 자리가 없다.
 */
export function formatCharterKrwUsd(krwAmount: number | null | undefined): string | null {
  const krw = formatCharterKrw(krwAmount);
  const usd = formatCharterUsdWithCode(krwAmount);
  if (!krw || !usd) return null;
  return `${usd} (${krw})`;
}
