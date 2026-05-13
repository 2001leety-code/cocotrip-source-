/**
 * exchangeRate.test.ts — 다국어 가격 포맷터 회귀 슈트 (PR feat/price-multi-currency).
 *
 * 검증 범위:
 *   B-FX1: 4-lang × 통화 매핑 (ko→KRW / en→USD / ja→JPY / zh→CNY)
 *   B-FX2: 음수/0/null/undefined/NaN 안전 처리 (empty label)
 *   B-FX3: 환율 계산 정확성 (100,000 KRW × 4 lang → 결과 검증)
 *   B-FX4: options.approximate / withCurrencyCode / withSymbol 동작
 *   B-FX5: USD-native 입력 (formatPriceFromUSD) 흐름
 *   B-FX6: USD 환율 SSOT — pricing_spec.policy_krw_per_usd 와 일치
 *
 * 본 슈트는 표시 환산만 검증. 실 결제 환산은 backend (api/_exchange-rate.js) 분리.
 */
import { describe, it, expect } from 'vitest';
import pricingSpec from '../../src/data/pricing_spec.json';
import {
  KRW_PER_USD,
  KRW_PER_JPY,
  KRW_PER_CNY,
  USD_TO_KRW,
  getCurrencyForLanguage,
  convertFromKRW,
  formatPrice,
  formatPriceFromUSD,
} from '../../src/lib/exchange-rate';

describe('B-FX1: 사용자 언어 → 통화 매핑', () => {
  it.each([
    ['ko', 'KRW'],
    ['en', 'USD'],
    ['ja', 'JPY'],
    ['zh', 'CNY'],
  ])('language=%s → currency=%s', (lang, currency) => {
    expect(getCurrencyForLanguage(lang)).toBe(currency);
  });

  it('알 수 없는 language → fallback USD', () => {
    expect(getCurrencyForLanguage('xx')).toBe('USD');
    expect(getCurrencyForLanguage('')).toBe('USD');
    expect(getCurrencyForLanguage(null)).toBe('USD');
    expect(getCurrencyForLanguage(undefined)).toBe('USD');
  });
});

describe('B-FX2: 음수/0/null/NaN 안전 처리', () => {
  it.each([
    [0],
    [-1],
    [-100000],
    [null as number | null],
    [undefined as number | undefined],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
  ])('formatPrice(%s, "en") → emptyLabel "—"', (input) => {
    expect(formatPrice(input as number, 'en')).toBe('—');
  });

  it('custom emptyLabel option 적용', () => {
    expect(formatPrice(0, 'en', { emptyLabel: 'N/A' })).toBe('N/A');
    expect(formatPrice(null, 'ko', { emptyLabel: '문의' })).toBe('문의');
  });

  it('convertFromKRW: 음수/null → 0', () => {
    expect(convertFromKRW(0, 'USD')).toBe(0);
    expect(convertFromKRW(-1, 'USD')).toBe(0);
    expect(convertFromKRW(null, 'JPY')).toBe(0);
    expect(convertFromKRW(undefined, 'CNY')).toBe(0);
    expect(convertFromKRW(Number.NaN, 'KRW')).toBe(0);
  });
});

describe('B-FX3: 환율 계산 정확성 (KRW_PER_USD=1430 기준)', () => {
  it('KRW_PER_USD 는 pricing_spec.policy_krw_per_usd 와 일치 (env override 없을 때)', () => {
    const policyRate = (pricingSpec as { policy_krw_per_usd?: number }).policy_krw_per_usd;
    // env override 가 없으면 spec 값을 따라야 함.
    if (!import.meta.env.VITE_KRW_PER_USD) {
      expect(KRW_PER_USD).toBe(policyRate);
    }
  });

  it('USD_TO_KRW legacy 별칭은 KRW_PER_USD 와 동일', () => {
    expect(USD_TO_KRW).toBe(KRW_PER_USD);
  });

  it('100,000 KRW → USD 환산 (≈ 100000 / 1430 ≈ 69.93)', () => {
    const usd = convertFromKRW(100_000, 'USD');
    // 환율 변동 시 ±10% 마진 — drift 일찍 잡기.
    expect(usd).toBeGreaterThan(60);
    expect(usd).toBeLessThan(80);
    // 소수점 둘째 자리 정밀도.
    expect(Number((usd * 100).toFixed(0)) / 100).toBe(usd);
  });

  it('100,000 KRW → JPY 환산 (≈ 100000 / 10.5 ≈ 9524)', () => {
    const jpy = convertFromKRW(100_000, 'JPY');
    expect(jpy).toBeGreaterThan(8500);
    expect(jpy).toBeLessThan(11000);
    expect(Number.isInteger(jpy)).toBe(true); // 정수 반올림.
  });

  it('100,000 KRW → CNY 환산 (≈ 100000 / 200 ≈ 500)', () => {
    const cny = convertFromKRW(100_000, 'CNY');
    expect(cny).toBeGreaterThan(450);
    expect(cny).toBeLessThan(560);
    expect(Number.isInteger(cny)).toBe(true);
  });

  it('100,000 KRW → KRW 동치 (round)', () => {
    expect(convertFromKRW(100_000, 'KRW')).toBe(100_000);
    expect(convertFromKRW(100_000.7, 'KRW')).toBe(100_001);
  });
});

describe('B-FX4: formatPrice 옵션', () => {
  it('기본 — 심볼 + 천 단위 구분 + 통화별 locale', () => {
    expect(formatPrice(330_000, 'ko')).toMatch(/^₩330,000$/);
    // USD/JPY/CNY 는 환율 변동 가능 — 심볼 + 통화 검증.
    expect(formatPrice(330_000, 'en')).toMatch(/^\$\d/);
    expect(formatPrice(330_000, 'ja')).toMatch(/^¥/);
    expect(formatPrice(330_000, 'zh')).toMatch(/^¥/);
  });

  it('approximate=true → "~" suffix', () => {
    expect(formatPrice(330_000, 'ko', { approximate: true })).toMatch(/~$/);
    expect(formatPrice(330_000, 'en', { approximate: true })).toMatch(/~$/);
  });

  it('withCurrencyCode=true → "USD"/"KRW" suffix (결제 직전 명시용)', () => {
    expect(formatPrice(330_000, 'en', { withCurrencyCode: true })).toMatch(/USD$/);
    expect(formatPrice(330_000, 'ko', { withCurrencyCode: true })).toMatch(/KRW$/);
    expect(formatPrice(330_000, 'ja', { withCurrencyCode: true })).toMatch(/JPY$/);
    expect(formatPrice(330_000, 'zh', { withCurrencyCode: true })).toMatch(/CNY$/);
  });

  it('withSymbol=false → 숫자만', () => {
    expect(formatPrice(330_000, 'ko', { withSymbol: false })).toBe('330,000');
    expect(formatPrice(330_000, 'en', { withSymbol: false })).not.toMatch(/^\$/);
  });

  it('approximate + withCurrencyCode 조합', () => {
    const out = formatPrice(330_000, 'en', { approximate: true, withCurrencyCode: true });
    expect(out).toMatch(/USD~$/);
  });
});

describe('B-FX5: formatPriceFromUSD — USD-native 입력', () => {
  it('$100 → ko 표시 (₩ 변환)', () => {
    const out = formatPriceFromUSD(100, 'ko');
    expect(out).toMatch(/^₩/);
    // $100 × 1430 = ₩143,000.
    expect(out).toContain('143,000');
  });

  it('$100 → en 표시 (소수점 유지)', () => {
    expect(formatPriceFromUSD(100, 'en')).toMatch(/^\$/);
  });

  it('음수/0/null 안전', () => {
    expect(formatPriceFromUSD(0, 'en')).toBe('—');
    expect(formatPriceFromUSD(-1, 'en')).toBe('—');
    expect(formatPriceFromUSD(null, 'en')).toBe('—');
  });
});

describe('B-FX6: 환율 상수 sanity check', () => {
  it('KRW_PER_USD 는 양수이고 합리적 범위', () => {
    expect(KRW_PER_USD).toBeGreaterThan(1000);
    expect(KRW_PER_USD).toBeLessThan(2000);
  });
  it('KRW_PER_JPY 는 양수이고 합리적 범위 (8~12)', () => {
    expect(KRW_PER_JPY).toBeGreaterThan(8);
    expect(KRW_PER_JPY).toBeLessThan(13);
  });
  it('KRW_PER_CNY 는 양수이고 합리적 범위 (150~250)', () => {
    expect(KRW_PER_CNY).toBeGreaterThan(150);
    expect(KRW_PER_CNY).toBeLessThan(260);
  });
});
