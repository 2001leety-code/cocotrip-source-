// @vitest-environment jsdom
/**
 * 차터 P2-2 (2026-10-18) — Step6 견적 포함/제외 뱃지 라벨 현지화 (표시 전용).
 *
 * 잠그는 것
 *   1) useQuoteCalculator 가 내는 includes/excludes 키 전부가 ko/ja/zh 에서 현지화 라벨로 보인다.
 *   2) en 은 원래 키 문자열 그대로 (바이트 동일).
 *   3) 모르는 키는 어떤 언어에서도 원래 키 그대로.
 *   4) quote 배열(순서·내용)은 변경되지 않고, 뱃지 순서/개수와 금액 표기는 언어와 무관하게 같다.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Step6Quote } from '../../src/components/charter/Step6Quote';
import type { QuoteBreakdown } from '../../src/components/charter/types';

afterEach(() => cleanup());

// useQuoteCalculator.ts 의 includes/excludes 상수와 동일한 키셋 (계산기 무수정).
const INCLUDES = ['fuel', 'tolls', 'parking'];
const EXCLUDES = ['meals', 'attractions', 'drinks', 'shopping'];

const EXPECTED: Record<'ko' | 'ja' | 'zh', Record<string, string>> = {
  ko: { fuel: '유류비', tolls: '통행료', parking: '주차비', meals: '식사', attractions: '관광지 입장료', drinks: '음료', shopping: '쇼핑' },
  ja: { fuel: '燃料費', tolls: '高速料金', parking: '駐車料金', meals: '食事', attractions: '観光地入場料', drinks: '飲み物', shopping: 'ショッピング' },
  zh: { fuel: '燃油费', tolls: '过路费', parking: '停车费', meals: '餐饮', attractions: '景点门票', drinks: '饮料', shopping: '购物' },
};

function makeQuote(includes: string[], excludes: string[]): QuoteBreakdown {
  return {
    mode: 'airport_transfer',
    source: 'formula',
    vehicle: 'staria_9',
    vehicleChargeKRW: 124_800,
    addons: [],
    subtotalKRW: 124_800,
    surchargeKRW: 0,
    surchargePercent: 0,
    multiDayDiscountKRW: 0,
    multiDayDiscountPercent: 0,
    vatExcluded: false,
    vatPercent: 10,
    estimatedMealsKRW: 0,
    estimatedAttractionsKRW: 0,
    showMeals: false,
    showAttractions: false,
    includes,
    excludes,
    warnings: [],
    needsCustomQuote: false,
  };
}

function chipTexts(container: HTMLElement): string[] {
  const box = container.querySelector('.charter-funnel-quote-chips');
  expect(box).not.toBeNull();
  return Array.from(box!.children).map((el) => el.textContent || '');
}

function amounts(container: HTMLElement): string[] {
  return (container.textContent || '').match(/₩[\d,]+/g) || [];
}

describe('Step6Quote 포함/제외 뱃지 라벨', () => {
  it('ko/ja/zh — 알려진 키 전부 현지화, 순서 유지', () => {
    for (const lang of ['ko', 'ja', 'zh'] as const) {
      const { container } = render(<Step6Quote quote={makeQuote([...INCLUDES], [...EXCLUDES])} language={lang} />);
      const expected = [
        ...INCLUDES.map((k) => `✓ ${EXPECTED[lang][k]}`),
        ...EXCLUDES.map((k) => `× ${EXPECTED[lang][k]}`),
      ];
      expect(chipTexts(container)).toEqual(expected);
      for (const k of [...INCLUDES, ...EXCLUDES]) {
        expect(chipTexts(container)).not.toContain(`✓ ${k}`);
        expect(chipTexts(container)).not.toContain(`× ${k}`);
      }
      cleanup();
    }
  });

  it('en — 원래 키 문자열 그대로 (바이트 동일)', () => {
    const { container } = render(<Step6Quote quote={makeQuote([...INCLUDES], [...EXCLUDES])} language="en" />);
    expect(chipTexts(container)).toEqual([
      '✓ fuel', '✓ tolls', '✓ parking',
      '× meals', '× attractions', '× drinks', '× shopping',
    ]);
  });

  it('모르는 키 / 프로토타입 이름 — 모든 언어에서 원래 키 그대로', () => {
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const { container } = render(
        <Step6Quote quote={makeQuote(['fuel', 'wifi_extra'], ['constructor', 'meals'])} language={lang} />,
      );
      const texts = chipTexts(container);
      expect(texts).toHaveLength(4);
      expect(texts[1]).toBe('✓ wifi_extra');
      expect(texts[2]).toBe('× constructor');
      cleanup();
    }
  });

  it('quote 배열은 불변, 금액 표기는 언어와 무관하게 동일', () => {
    const includes: string[] = [...INCLUDES];
    const excludes: string[] = [...EXCLUDES];
    Object.freeze(includes);
    Object.freeze(excludes);
    const quote = makeQuote(includes, excludes);
    const before = JSON.stringify(quote);
    const perLang: string[][] = [];
    for (const lang of ['ko', 'en', 'ja', 'zh'] as const) {
      const { container } = render(<Step6Quote quote={quote} language={lang} />);
      perLang.push(amounts(container));
      expect(chipTexts(container)).toHaveLength(INCLUDES.length + EXCLUDES.length);
      cleanup();
    }
    expect(JSON.stringify(quote)).toBe(before);
    expect(quote.includes).toEqual(INCLUDES);
    expect(quote.excludes).toEqual(EXCLUDES);
    expect(perLang[0].length).toBeGreaterThan(0);
    for (const a of perLang) expect(a).toEqual(perLang[0]);
  });
});
