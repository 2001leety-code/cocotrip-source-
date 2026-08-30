// @vitest-environment jsdom
/**
 * 차터 USD — 표시가 == 청구가 단일화 (2026-07-30, P0-1).
 *
 * 🔴 운영 실측으로 잡힌 사고: `/charter` 공개 본문이 "Incheon Airport → central Seoul is **$87**"
 *   이라고 적고 있었는데, 같은 상품의 실제 결제는 **$89** 였다.
 *     본문:  formatPrice(124800, 'en') → 124800 / 1430(policy_krw_per_usd) = 87.27 → "$87"
 *     결제:  createPaypalOrder usesFixedUsdRate → Math.round(124800 / 1400) = 89
 *   같은 화면 안에서 "1 USD = 1400 원 고정, 표시 금액이 결제 금액" 이라고 써 놓고 1430 으로
 *   환산한 숫자를 보여 준 것이다.
 *
 * 이 파일이 잠그는 것
 *   1) 순수 함수 `charterUsdFromKrw` 가 서버 공식과 같다.
 *   2) SEO 본문을 **실제로 렌더해** 화면 문자열에 $89 가 있고 $87 이 없다.
 *   3) 결제 경로 소스에 일반 표시환율 함수(`formatPrice`·`convertFromKRW`·`KRW_PER_USD`)가
 *      다시 들어오지 못한다.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { charterCheckoutExpectedUsd, charterUsdFromKrw, formatCharterUsd, formatCharterKrwUsd, isPlanDetailDailyCharterProduct } from '../../src/lib/charterUsd';
import { AIRPORT_TRANSFER_PRICES, CHARTER_USD_FIX_RATE } from '../../src/data/charterPricing';
import { CharterSeoInfo } from '../../src/components/charter/CharterSeoInfo';
import en from '../../src/i18n/locales/en.json';
import type { Translations } from '../../src/i18n';

const ICN_SEOUL_KRW = AIRPORT_TRANSFER_PRICES['seoul-central'].priceKRW;

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('charterUsdFromKrw — 서버 청구 공식과 동일한 순수 함수', () => {
  it('고정환율 1400 + 정수 반올림 (createPaypalOrder roundUsdWhole 과 동형)', () => {
    expect(CHARTER_USD_FIX_RATE).toBe(1400);
    expect(charterUsdFromKrw(124_800)).toBe(Math.round(124_800 / 1400));
    expect(charterUsdFromKrw(124_800)).toBe(89);
  });

  it('인천공항 → 서울 도심 = $89 (현재 정책)', () => {
    expect(ICN_SEOUL_KRW).toBe(124_800);
    expect(charterUsdFromKrw(ICN_SEOUL_KRW)).toBe(89);
    expect(formatCharterUsd(ICN_SEOUL_KRW)).toBe('$89');
  });

  it('🔴 $87 재발 방지 — 표시환율(1430)로 나눈 값과 절대 같지 않아야 한다', () => {
    const displayRateUsd = Math.round(ICN_SEOUL_KRW / 1430);
    expect(displayRateUsd).toBe(87);
    expect(charterUsdFromKrw(ICN_SEOUL_KRW)).not.toBe(displayRateUsd);
  });

  it('무효 입력은 0 — 호출부가 "표시 안 함" 으로 분기할 수 있게', () => {
    expect(charterUsdFromKrw(0)).toBe(0);
    expect(charterUsdFromKrw(-1)).toBe(0);
    expect(charterUsdFromKrw(null)).toBe(0);
    expect(charterUsdFromKrw(undefined)).toBe(0);
    expect(charterUsdFromKrw(Number.NaN)).toBe(0);
    expect(formatCharterUsd(0)).toBeNull();
  });

  it('공개 표기는 언어 무관하게 "₩정책가 ($청구 USD)"', () => {
    expect(formatCharterKrwUsd(ICN_SEOUL_KRW)).toBe('₩124,800 ($89 USD)');
  });

  it('쿠폰 적용 뒤 expectedUSD도 할인된 화면 KRW로 다시 맞춘다', () => {
    expect(charterCheckoutExpectedUsd(429, 600_000, false)).toBe(429);
    expect(charterCheckoutExpectedUsd(429, 570_000, true)).toBe(407);
    expect(charterCheckoutExpectedUsd(undefined, 570_000, true)).toBeUndefined();
  });

  it('이번 PlanDetail 일일 차터 상품만 할인 후 예상 USD 갱신 대상이다', () => {
    for (const productType of [
      'charter_seoul_city', 'charter_seoul_suburb', 'charter_dmz', 'charter_gangwon',
      'charter_ski', 'charter_gyeongju', 'charter_busan',
    ]) {
      expect(isPlanDetailDailyCharterProduct(productType)).toBe(true);
    }
    for (const existingProduct of ['charter_multiday', 'charter_transfer', 'kpop_shuttle_roundtrip', 'tour_hourly', 'ai_planner_full']) {
      expect(isPlanDetailDailyCharterProduct(existingProduct)).toBe(false);
    }
  });
});

describe('SEO 본문 실렌더 — 4개 언어 모두 $89, $87 없음', () => {
  const langs = ['ko', 'en', 'ja', 'zh'] as const;

  for (const lang of langs) {
    it(`${lang}: 본문에 $89 가 있고 $87 은 없다`, () => {
      const { container, unmount } = render(
        <CharterSeoInfo language={lang} t={en as unknown as Translations} />,
      );
      const text = container.textContent || '';
      expect(text, `${lang} 본문에 청구액 $89 가 없다`).toContain('$89');
      expect(text, `${lang} 본문에 표시환율 산출값 $87 이 남아 있다`).not.toContain('$87');
      expect(text).toContain('₩124,800');
      unmount();
    });
  }

  it('en 본문의 "price you see is the price you pay" 문장과 같은 화면에 $89 가 있다', () => {
    render(<CharterSeoInfo language="en" t={en as unknown as Translations} />);
    expect(screen.getByText(/price you see is the price you pay/i)).toBeTruthy();
    expect(document.body.textContent).toContain('$89');
  });
});

describe('결제 경로에 일반 표시환율 함수가 들어오지 못한다 (잠금)', () => {
  // 결제 금액을 만드는/보여 주는 파일들. 여기에 표시환율이 섞이면 이번 사고가 재발한다.
  const PAYMENT_SURFACES = [
    'src/components/charter/CharterSeoInfo.tsx',
    'src/components/charter/Step5DateOptions.tsx',
    'src/components/charter/Step6Quote.tsx',
    'src/pages/CharterNewPage.tsx',
  ];

  for (const file of PAYMENT_SURFACES) {
    it(`${file}: formatPrice/convertFromKRW/KRW_PER_USD 를 쓰지 않는다`, () => {
      const code = src(file);
      expect(code, `${file} 이 표시환율 포맷터를 다시 임포트했다`).not.toMatch(/from ['"]@\/lib\/exchange-rate['"]/);
      expect(code).not.toMatch(/\bformatPrice\s*\(/);
      expect(code).not.toMatch(/\bconvertFromKRW\s*\(/);
      expect(code).not.toMatch(/\bKRW_PER_USD\b/);
    });
  }

  it('차터 USD 환산 나눗셈은 lib/charterUsd 한 곳에만 있다', () => {
    for (const file of [...PAYMENT_SURFACES, 'src/components/charter/CharterWizard.tsx']) {
      const code = src(file);
      expect(code, `${file} 에 직접 나눗셈(/ CHARTER_USD_FIX_RATE)이 남아 있다`)
        .not.toMatch(/\/\s*CHARTER_USD_FIX_RATE/);
    }
  });

  it('서버는 같은 공식을 쓴다 — Math.round(krwAmount / usdToKrw) + charter_usd_fix_rate', () => {
    const server = src('api/createPaypalOrder.js');
    expect(server).toMatch(/charter_usd_fix_rate/);
    expect(server).toMatch(/roundUsdWhole\s*\?\s*Math\.round\(_usdRaw\)/);
  });
});

describe('클라이언트 표시액 ↔ 서버 산정액 대조 배선', () => {
  it('CharterNewPage 가 expectedUSD 를 charterUsdFromKrw 로 만든다', () => {
    const page = src('src/pages/CharterNewPage.tsx');
    expect(page).toMatch(/expectedUSD=\{routeCoords \? undefined : charterUsdFromKrw\(resolved\.priceKRW\)\}/);
    expect(page).toMatch(/expectedUSD=\{charterUsdFromKrw\(estimateKRW\)\}/);
  });

  it('PayPalBookingButton 이 expectedUSD 를 주문 생성 body 로 전달한다', () => {
    const btn = src('src/components/PayPalBookingButton.tsx');
    expect(btn).toContain('isPlanDetailDailyCharterProduct(productType)');
    expect(btn).toContain('charterCheckoutExpectedUsd(expectedUSD, effectiveKRW, promoApplied)');
    expect(btn).toContain("{ expectedUSD: expectedUSDForCheckout }");
  });

  it('서버는 불일치 시 주문을 만들지 않고 409 로 거부한다', () => {
    const server = src('api/createPaypalOrder.js');
    expect(server).toMatch(/AMOUNT_MISMATCH/);
    expect(server).toMatch(/res\.writeHead\(409, JSON_CORS\)/);
  });
});
