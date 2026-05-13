/**
 * exchange-rate.ts — 프론트엔드 환율 SSOT + 다국어 가격 포맷터
 *
 * **사용자 언어 기반 자동 환산 표시** (PR feat/price-multi-currency, 2026-05-13):
 *   en → USD ($), ja → JPY (¥), zh → CNY (¥), ko → KRW (₩)
 *   백엔드 결제는 항상 USD (PayPal) — 본 모듈은 **표시 환산만** 담당.
 *
 * 환율 SSOT (우선순위 위→아래):
 *   1. Vercel env (VITE_KRW_PER_USD / VITE_KRW_PER_JPY / VITE_KRW_PER_CNY)
 *   2. pricing_spec.json policy_krw_per_usd (USD 만 — 결제 환율 일치)
 *   3. hardcoded fallback (JPY 10.5, CNY 200 — 시장 평균, 2026-05-13 기준)
 *
 * 실제 결제 환율은 backend `api/_exchange-rate.js` 의 live rate 사용.
 * 이 모듈 값은 UI 표시·estimate 용. 결제 직전 명시 표시 ("Pay $230 USD") 필수.
 *
 * 후속 (선택): live rate fetch — 1시간 1회 캐싱 + 실패 시 hardcode 폴백.
 */
import spec from '@/data/pricing_spec.json';

const POLICY_KRW_PER_USD = (spec as { policy_krw_per_usd?: number }).policy_krw_per_usd ?? 1430;

// 환율 SSOT — env override > spec > hardcoded fallback.
// USD: pricing_spec.json 의 policy_krw_per_usd (1430) 와 일치 — priceUSD 환산 결과도 동일.
export const KRW_PER_USD: number = Number(import.meta.env.VITE_KRW_PER_USD ?? POLICY_KRW_PER_USD);
// JPY: 시장 평균 ~ 10.5 KRW / 1 JPY (2026-05-13 기준). env override 가능.
export const KRW_PER_JPY: number = Number(import.meta.env.VITE_KRW_PER_JPY ?? 10.5);
// CNY: 시장 평균 ~ 200 KRW / 1 CNY (2026-05-13 기준). env override 가능.
export const KRW_PER_CNY: number = Number(import.meta.env.VITE_KRW_PER_CNY ?? 200);

// Legacy 별칭 — AdminAnalytics 등 backward-compat 용도. 신규 코드는 KRW_PER_USD 사용.
export const USD_TO_KRW = KRW_PER_USD;
export const usdToKrw = (usd: number): number => Math.round(usd * KRW_PER_USD);
export const krwToUsd = (krw: number): number => Math.round((krw / KRW_PER_USD) * 100) / 100;

/** 사용자 언어 → 표시 통화 매핑. */
export type DisplayLanguage = 'ko' | 'en' | 'ja' | 'zh';
export type DisplayCurrency = 'KRW' | 'USD' | 'JPY' | 'CNY';

const LANGUAGE_TO_CURRENCY: Record<DisplayLanguage, DisplayCurrency> = {
  ko: 'KRW',
  en: 'USD',
  ja: 'JPY',
  zh: 'CNY',
};

export function getCurrencyForLanguage(language: string | null | undefined): DisplayCurrency {
  if (!language) return 'USD';
  const lang = (language as DisplayLanguage);
  return LANGUAGE_TO_CURRENCY[lang] ?? 'USD';
}

/**
 * KRW → target currency 환산. 음수/NaN/null/undefined → 0.
 * KRW 는 정수, USD 는 소수점 둘째 자리, JPY/CNY 는 정수 반올림.
 */
export function convertFromKRW(krwAmount: number | null | undefined, currency: DisplayCurrency): number {
  if (krwAmount == null || !Number.isFinite(krwAmount) || krwAmount <= 0) return 0;
  switch (currency) {
    case 'KRW':
      return Math.round(krwAmount);
    case 'USD':
      return Math.round((krwAmount / KRW_PER_USD) * 100) / 100;
    case 'JPY':
      return Math.round(krwAmount / KRW_PER_JPY);
    case 'CNY':
      return Math.round(krwAmount / KRW_PER_CNY);
    default:
      return 0;
  }
}

/** 통화별 심볼·소수점 자리수·천 단위 구분 옵션. */
interface CurrencySpec {
  symbol: string;
  fractionDigits: number;
  locale: string;
}

const CURRENCY_SPECS: Record<DisplayCurrency, CurrencySpec> = {
  KRW: { symbol: '₩', fractionDigits: 0, locale: 'ko-KR' },
  USD: { symbol: '$', fractionDigits: 0, locale: 'en-US' },
  JPY: { symbol: '¥', fractionDigits: 0, locale: 'ja-JP' },
  CNY: { symbol: '¥', fractionDigits: 0, locale: 'zh-CN' },
};

export interface FormatPriceOptions {
  /** trailing "~" suffix 추가 (예: "$230~"). 기본 false. */
  approximate?: boolean;
  /** 통화 심볼 노출 여부 (기본 true). false 시 숫자만 (예: "230"). */
  withSymbol?: boolean;
  /** "USD" 같은 통화 코드 suffix 노출 (기본 false). 결제 직전 명시용. */
  withCurrencyCode?: boolean;
  /** 0 / null / 음수 입력 시 표시 텍스트. 기본 '—'. */
  emptyLabel?: string;
}

/**
 * **사용자 언어 기반 가격 포맷** — KRW 입력을 받아 언어 매핑된 통화로 환산·표시.
 *
 * 예시 (krwAmount = 330_000):
 *   - ko: "₩330,000"
 *   - en: "$231"           (~330_000 / 1430)
 *   - ja: "¥31,429"        (~330_000 / 10.5)
 *   - zh: "¥1,650"         (~330_000 / 200)
 *
 * options.withCurrencyCode = true 시: "$231 USD" / "¥31,429 JPY" 등 — 결제 직전 명시용.
 * options.approximate = true 시: "$231~" / "₩330,000~" — 카드/타일 "최저" 표시용.
 * krwAmount ≤ 0 또는 invalid 시: options.emptyLabel (기본 '—') 반환.
 */
export function formatPrice(
  krwAmount: number | null | undefined,
  language: string | null | undefined,
  options: FormatPriceOptions = {},
): string {
  const {
    approximate = false,
    withSymbol = true,
    withCurrencyCode = false,
    emptyLabel = '—',
  } = options;

  if (krwAmount == null || !Number.isFinite(krwAmount) || krwAmount <= 0) {
    return emptyLabel;
  }

  const currency = getCurrencyForLanguage(language);
  const spec = CURRENCY_SPECS[currency];
  const value = convertFromKRW(krwAmount, currency);

  // toLocaleString 으로 천 단위 구분 + 소수점 처리.
  const formatted = value.toLocaleString(spec.locale, {
    minimumFractionDigits: spec.fractionDigits,
    maximumFractionDigits: spec.fractionDigits,
  });

  let out = withSymbol ? `${spec.symbol}${formatted}` : formatted;
  if (withCurrencyCode) out += ` ${currency}`;
  if (approximate) out += '~';
  return out;
}

/**
 * USD 금액 → 사용자 언어 통화 표시. PayPal 결제 단계 등 USD-native 금액에 사용.
 * 내부적으로 KRW 환산 거치지 않고 직접 변환 (USD ↔ JPY ↔ CNY) — 결제 일관성 우선.
 */
export function formatPriceFromUSD(
  usdAmount: number | null | undefined,
  language: string | null | undefined,
  options: FormatPriceOptions = {},
): string {
  if (usdAmount == null || !Number.isFinite(usdAmount) || usdAmount <= 0) {
    return options.emptyLabel ?? '—';
  }
  // USD → KRW 환산 후 다시 formatPrice 흐름 재사용 (단일 진실 경로).
  const krw = usdAmount * KRW_PER_USD;
  return formatPrice(krw, language, options);
}
