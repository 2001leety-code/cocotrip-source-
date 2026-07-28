/**
 * 잠금 (2026-07-29 운영자 가격 정책) — AI 플래너 = **고정 USD $9.90**.
 *
 * 이전 결함: ₩13,300 을 live 환율로 나눠 청구했다. 환율 1,468 이면 실제 청구가 $9.06 인데
 *   화면·마케팅은 $9.90 고정 → 표시가 != 청구가. 환불 판정까지 뒤집혔다.
 *
 * 이 파일이 잠그는 것:
 *  1. 서버 SSOT 와 프론트 미러가 같은 값
 *  2. 주문 생성이 환율 나눗셈을 타지 않는다 (하이픈/언더바 표기 모두)
 *  3. 다른 상품 가격 정책은 그대로 (차터 = 고정환율 1400 유지)
 *  4. 화면 금액과 서버 금액이 다르면 결제를 만들지 않는다
 *  5. 예상 여행비(priceUSD)는 판매가·원장과 완전히 분리돼 있다
 *  6. KRW 는 참고 표시용 — 결제·환불 판정에 쓰이지 않는다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AI_PLANNER_FULL_USD as SERVER_USD } from '../../api/_shared/pricing.js';
import { fixedUsdPriceFor, isFixedUsdPriceProduct, usesFixedUsdRate } from '../../api/_shared/usd-rate-policy.js';
import {
  AI_PLANNER_FULL_USD as CLIENT_USD,
  AI_PLANNER_REFERENCE_KRW,
  formatAiPlannerUsd,
} from '@/lib/aiPlannerPrice';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('AI 플래너 가격 — 서버 ↔ 프론트 패리티', () => {
  it('두 곳이 같은 값이고 정확히 9.90 이다', () => {
    expect(SERVER_USD).toBe(9.90);
    expect(CLIENT_USD).toBe(SERVER_USD);
  });

  it('정책 테이블이 하이픈·언더바 표기 모두에서 같은 값을 준다', () => {
    expect(fixedUsdPriceFor('ai_planner_full')).toBe(9.90);
    expect(fixedUsdPriceFor('ai-planner-full')).toBe(9.90);
    expect(isFixedUsdPriceProduct('ai-planner-full')).toBe(true);
  });

  it('표시 문자열을 한 곳에서만 만든다', () => {
    expect(formatAiPlannerUsd()).toBe('$9.90');
  });
});

describe('다른 상품 가격 정책 무영향', () => {
  it('차터는 고정 USD 정찰가 상품이 아니다 (기존 환율 로직 유지)', () => {
    for (const p of ['charter_transfer', 'charter_multiday', 'airport_seoul_central', 'tour_hourly', 'charter_seoul_city']) {
      expect(fixedUsdPriceFor(p), `${p} 가 정찰가 목록에 들어갔다`).toBeNull();
      expect(usesFixedUsdRate(p), `${p} 의 고정환율 정책이 바뀌었다`).toBe(true);
    }
  });
});

describe('주문 생성 — 환율 미개입 + 금액 대조', () => {
  const code = codeOf('api/createPaypalOrder.js');

  it('정찰가 상품은 KRW/환율 나눗셈을 타지 않는다', () => {
    expect(code).toContain('fixedUsdPriceFor(productType)');
    // 줄바꿈에 무관하게 "고정가면 환율 안 탄다" 형태를 확인한다.
    expect(code).toMatch(/fixedUsd\s*!=\s*null[\s\S]{0,40}fixedUsd\.toFixed\(2\)/);
    expect(code).toMatch(/fixedUsd\s*!=\s*null\s*\?\s*fixedUsd\s*:\s*krwAmount\s*\/\s*usdToKrw/);
  });

  it('화면 금액과 서버 금액이 다르면 409 로 주문을 만들지 않는다', () => {
    expect(code).toContain('AMOUNT_MISMATCH');
    expect(code).toContain('Math.abs(clientUsd - Number(usdAmount)) > 0.005');
  });

  it('주문 스냅샷에 청구 USD 가 그대로 저장된다 (Capture 검증 근거)', () => {
    expect(code).toContain('expectedUSD: usdAmount');
    expect(code).toContain("expectedCurrency: 'USD'");
  });
});

describe('Capture · booking · 원장 — 금액 출처', () => {
  it('Capture 금액은 PayPal 응답에서 온다 (클라이언트 body 아님)', () => {
    const code = codeOf('api/capturePaypalOrder.js');
    expect(code).toContain('const amount = captureNode?.amount?.value');
    expect(code).toContain('amountUSD: amount');
  });

  it('Capture 검증은 스냅샷 expectedUSD 와 대조한다', () => {
    const code = codeOf('api/capturePaypalOrder.js');
    expect(code).toContain('_snapExpectedUSD');
  });

  it('원장은 booking.amountUSD 만 본다 (예상 여행비 아님)', () => {
    const code = codeOf('api/booking-processor.js');
    expect(code).toContain('ledger.amountUSD');
    expect(code).not.toContain('amountUSD: body.amount');
  });
});

describe('예상 여행비 ↔ 판매가 분리', () => {
  it('플랜 파이프라인이 예상치를 판매가로 부르지 않는다', () => {
    const code = codeOf('api/_ai_core/handlerCore.js');
    expect(code).toContain('estimatedTripUSD');
  });

  it('플랜 저장 경로는 원장을 건드리지 않는다', () => {
    const code = codeOf('api/_ai_core/planPersister.js');
    for (const f of ['tripCoins', 'totalSpentUSD', 'bookingCount']) {
      expect(code, `planPersister 가 ${f} 를 쓴다`).not.toContain(f);
    }
  });
});

describe('KRW 는 참고 표시용', () => {
  it('프론트 참고 KRW 상수가 분리돼 있다', () => {
    expect(AI_PLANNER_REFERENCE_KRW).toBe(13300);
  });

  it('화면에 $9.90 이 하드코딩돼 있지 않다', () => {
    for (const f of [
      'src/pages/PlannerPage/components/PurchaseSection.tsx',
      'src/components/WizardForm/WizardStep3Review.tsx',
    ]) {
      const code = codeOf(f);
      expect(code, `${f}: $9.90 하드코딩 잔존`).not.toContain('>$9.90<');
      expect(code).toContain('formatAiPlannerUsd');
    }
  });

  it('환불 전액/부분 판정에 KRW 가 쓰이지 않는다 (USD 비교)', () => {
    const code = codeOf('api/paypal-webhook.js');
    expect(code).toMatch(/isPartialRefund\s*=\s*originalUSD\s*>\s*0/);
  });
});
