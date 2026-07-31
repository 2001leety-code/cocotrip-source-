/**
 * 차터 USD 금액의 **단일 기준** (2026-07-30).
 *
 * 🔴 고친 문제: `/charter` 공개 본문은 "인천공항 → 서울 $87", 실제 결제는 $89 였다.
 *   본문이 `exchange-rate.ts` 의 `formatPrice()`(= 표시환율 `policy_krw_per_usd` 1430)를 썼고,
 *   결제·서버는 `charter_usd_fix_rate` 1400 을 쓴다. 같은 상품에 환율이 두 벌이었던 것이다.
 *     124,800 / 1430 = 87.27 → "$87"   (본문)
 *     124,800 / 1400 = 89.14 → "$89"   (createPaypalOrder usesFixedUsdRate, 정수 반올림)
 *
 * 규칙
 *   - 차터 상품의 USD 는 **이 파일의 함수로만** 만든다. 반올림까지 여기 한 곳에 있다
 *     (서버 `api/createPaypalOrder.js` 의 `Math.round(krwAmount / usdToKrw)` 와 동형).
 *   - 일반 표시환율 함수(`formatPrice`·`convertFromKRW`·`KRW_PER_USD`)는 결제 금액 문구에
 *     쓰지 않는다. `tests/unit/charter-usd-single-source.test.ts` 가 재발을 막는다.
 *   - 판매가·고정환율 정책 자체는 여기서 바꾸지 않는다 — 환산·표기만 담당한다.
 */
import { CHARTER_USD_FIX_RATE } from '@/data/charterPricing';

/**
 * 차터 KRW → 청구 USD (정수). 서버 청구 공식과 동일한 순수 함수.
 * 유효하지 않은 입력은 0 — 호출부가 "표시 안 함" 으로 분기할 수 있게 한다.
 */
export function charterUsdFromKrw(krwAmount: number | null | undefined): number {
  const krw = Number(krwAmount);
  if (!Number.isFinite(krw) || krw <= 0) return 0;
  return Math.round(krw / CHARTER_USD_FIX_RATE);
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
 * "₩124,800 ($89 USD)" — **언어와 무관하게** 정책가(원화)와 실제 청구액(USD)을 함께 적는다.
 *
 * 공개 본문(SEO)·안내 문구는 이걸 쓴다. 언어별 표시통화(ja=¥, zh=¥)로 환산하면 "표시 금액이
 * 결제 금액" 이라는 문장이 거짓이 된다 — 결제는 늘 PayPal USD 다. 두 숫자를 같이 적으면
 * 어느 언어에서도 참이고, 표시환율 함수가 끼어들 자리가 없다.
 */
export function formatCharterKrwUsd(krwAmount: number | null | undefined): string | null {
  const krw = formatCharterKrw(krwAmount);
  const usd = formatCharterUsdWithCode(krwAmount);
  if (!krw || !usd) return null;
  return `${krw} (${usd})`;
}
