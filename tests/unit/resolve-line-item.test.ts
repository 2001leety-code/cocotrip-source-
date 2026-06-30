/**
 * resolve-line-item 단위 테스트 — 장바구니 라인별 결제 SSOT 재계산 (PR2c).
 * (1) resolveKrwAmount 정본 복제 correctness (SPEC 기준) (2) dispatch (3) 합산/거부
 * (4) ⚠️ source-parity 가드 — createPaypalOrder.js 와 상수 divergence 방지 (복제 채택 trade-off).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveKrwAmount, resolveLineItemKrw, computeCartTotalKrw,
  CHARTER_MAP, AI_PLANNER_FULL_KRW, COMBO_DISCOUNT_PERCENT_FALLBACK,
} from '../../api/_shared/resolve-line-item.js';

const SPEC = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_pricing_spec.json'), 'utf8'));
const createOrderSrc = readFileSync(resolve(process.cwd(), 'api/createPaypalOrder.js'), 'utf8');
const createCartSrc = readFileSync(resolve(process.cwd(), 'api/createCartOrder.js'), 'utf8');

describe('resolveKrwAmount — 정본 복제 correctness', () => {
  it('ai_planner_full = 13300 (fixed)', () => {
    expect(resolveKrwAmount(SPEC, 'ai_planner_full', 1, 1)).toBe(13300);
  });
  it('kpop_shuttle = pax × price', () => {
    expect(resolveKrwAmount(SPEC, 'kpop_shuttle_oneway', 3, 1)).toBe(3 * SPEC.kpop_shuttle.price_one_way);
  });
  it('kpop_shuttle passengers sanitize — 소수/음수/0/NaN → 1 (과소청구·음수 차단)', () => {
    const unit = SPEC.kpop_shuttle.price_one_way;
    expect(resolveKrwAmount(SPEC, 'kpop_shuttle_oneway', 0.5, 1)).toBe(unit);   // 소수 → 1
    expect(resolveKrwAmount(SPEC, 'kpop_shuttle_oneway', -2, 1)).toBe(unit);    // 음수 → 1
    expect(resolveKrwAmount(SPEC, 'kpop_shuttle_oneway', 0, 1)).toBe(unit);     // 0 → 1
    expect(resolveKrwAmount(SPEC, 'kpop_shuttle_oneway', NaN, 1)).toBe(unit);   // NaN → 1
    expect(resolveKrwAmount(SPEC, 'kpop_shuttle_roundtrip', 2.9, 1)).toBe(2 * SPEC.kpop_shuttle.price_round_trip); // floor
  });
  it('charter × durationDays (P100) + hyphen 정규화', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 1)).toBe(daily);
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 3)).toBe(daily * 3);
    expect(resolveKrwAmount(SPEC, 'charter-seoul-city', 1, 2)).toBe(daily * 2);
  });
  it('days cap 1~30 + undefined/0 = 1', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, undefined)).toBe(daily);
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 99)).toBe(daily * 30);
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 0)).toBe(daily);
  });
  it('airport_ = SPEC 값', () => {
    const v = SPEC.airport_transfer_prices['seoul-central'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'airport_seoul_central', 1, 1)).toBe(v);
  });
  it('captain premium — staria(7인) +33000 / staria_9·미전달 +0 (cart day-tour/airport, createPaypalOrder 미러·P311 표시=청구)', () => {
    const cap = SPEC.vehicles.staria.captain_premium_krw;
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 1, 'staria')).toBe(daily + cap);   // 7인승 +33,000
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 1, 'staria_9')).toBe(daily);        // 9인승 +0
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 1)).toBe(daily);                    // vehicle 미전달 = 기존 동작
    const ap = SPEC.airport_transfer_prices['seoul-central'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'airport_seoul_central', 1, 1, 'staria')).toBe(ap + cap);
    expect(resolveKrwAmount(SPEC, 'airport_seoul_central', 1, 1, 'staria_9')).toBe(ap);
  });
  it('combo = (airport+tour)×(1-할인) 정확', () => {
    const airport = SPEC.airport_transfer_prices['seoul-central'].priceKRW;
    const tour = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    const cp = SPEC.combo_packages || {};
    const pkg = (cp.packages && cp.packages.combo_airport_seoul) || {};
    let disc;
    if (typeof pkg.discount_percent === 'number') disc = pkg.discount_percent;
    else if (typeof cp.discount_percent === 'number') disc = cp.discount_percent;
    else disc = 10;
    const expected = Math.round((airport + tour) * (1 - disc / 100));
    expect(resolveKrwAmount(SPEC, 'combo_airport_seoul', 1, 1)).toBe(expected);
  });
  it('unknown/missing SPEC = null', () => {
    expect(resolveKrwAmount(SPEC, 'nonsense_product', 1, 1)).toBe(null);
    expect(resolveKrwAmount(null, 'ai_planner_full', 1, 1)).toBe(null);
  });
});

describe('resolveLineItemKrw — dispatch (개별 flag 존중)', () => {
  it('일반 productType → resolveKrwAmount', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    expect(resolveLineItemKrw(SPEC, { productType: 'charter_seoul_city', durationDays: 2 }, {})).toBe(daily * 2);
  });
  it('charter_transfer flag OFF → null (cart 가 개별 flag 우회 안 함)', () => {
    expect(resolveLineItemKrw(SPEC, { productType: 'charter_transfer', originKey: 'x', destKey: 'y' }, { transferEnabled: false })).toBe(null);
  });
  it('null booking/productType → null', () => {
    expect(resolveLineItemKrw(SPEC, null, {})).toBe(null);
    expect(resolveLineItemKrw(SPEC, {}, {})).toBe(null);
  });
});

describe('computeCartTotalKrw — 합산 + 거부 (P311)', () => {
  const tourItem = (days: number) => ({ booking: { productType: 'charter_seoul_city', durationDays: days } });
  it('합산 = 라인 합', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    const r = computeCartTotalKrw(SPEC, [tourItem(1), tourItem(2)], {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalKRW).toBe(daily + daily * 2);
      expect(r.lines).toHaveLength(2);
    }
  });
  it('빈 cart = EMPTY_CART', () => {
    expect(computeCartTotalKrw(SPEC, [], {})).toMatchObject({ ok: false, code: 'EMPTY_CART' });
  });
  it('AI 플래너 포함 = MIXED_DIGITAL_PHYSICAL 전체 거부', () => {
    expect(computeCartTotalKrw(SPEC, [tourItem(1), { booking: { productType: 'ai_planner_full' } }], {}))
      .toMatchObject({ ok: false, code: 'MIXED_DIGITAL_PHYSICAL' });
  });
  it('null 라인 = INVALID_LINE 전체 거부 (부분 결제 금지)', () => {
    expect(computeCartTotalKrw(SPEC, [tourItem(1), { booking: { productType: 'nonsense' } }], {}))
      .toMatchObject({ ok: false, code: 'INVALID_LINE' });
  });
  it('client priceKRW 무시 (booking 키만 신뢰)', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    const r = computeCartTotalKrw(SPEC, [{ booking: { productType: 'charter_seoul_city', durationDays: 1 }, priceKRW: 999999999 }], {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totalKRW).toBe(daily); // 위조된 priceKRW 무시
  });
});

describe('createPaypalOrder — passenger sanitize + 음수금액 가드 (소스 가드)', () => {
  it('kpop passengers 를 Math.max(1, Math.floor(Number)) 로 정규화 (소수/음수 과소청구 차단)', () => {
    expect(createOrderSrc).toMatch(/Math\.max\(1,\s*Math\.floor\(Number\(passengers\)\s*\|\|\s*1\)\)/);
  });
  it('음수/0/NaN 금액 차단: if (!(krwAmount > 0))', () => {
    expect(createOrderSrc).toMatch(/!\(krwAmount\s*>\s*0\)/);
  });
});

describe('source-parity 가드 — createPaypalOrder.js 와 상수 동기 (복제 divergence 방지)', () => {
  it('AI_PLANNER_FULL_KRW 동일 (13300)', () => {
    expect(AI_PLANNER_FULL_KRW).toBe(13_300);
    expect(createOrderSrc).toMatch(/AI_PLANNER_FULL_KRW\s*=\s*13_?300/);
  });
  it('CHARTER_MAP 키·값 동일', () => {
    for (const key of Object.keys(CHARTER_MAP)) {
      expect(createOrderSrc).toContain(`${key}:`);
    }
    expect(createOrderSrc).toMatch(/charter_seoul_city:\s*'seoul-city'/);
    expect(createOrderSrc).toMatch(/charter_busan:\s*'busan-day'/);
  });
  it('COMBO_DISCOUNT_PERCENT_FALLBACK 동일 (10)', () => {
    expect(COMBO_DISCOUNT_PERCENT_FALLBACK).toBe(10);
    expect(createOrderSrc).toMatch(/COMBO_DISCOUNT_PERCENT_FALLBACK\s*=\s*10/);
  });
});

describe('createCartOrder 핸들러 — 안전 wiring 가드', () => {
  it('FEATURE_CART flag-gated (OFF=404 CART_DISABLED)', () => {
    expect(createCartSrc).toMatch(/featureEnabled\(process\.env\.FEATURE_CART\)/);
    expect(createCartSrc).toMatch(/CART_DISABLED/);
  });
  it('computeCartTotalKrw 로 SSOT 재계산 (client priceKRW 무시)', () => {
    expect(createCartSrc).toMatch(/computeCartTotalKrw\(SPEC,\s*items/);
  });
  it('고정 USD 1400 (charter_usd_fix_rate)', () => {
    expect(createCartSrc).toMatch(/charter_usd_fix_rate\s*\|\|\s*1400/);
  });
  it('cart_orders 스냅샷 저장 (capture SSOT) + 실패 시 명시 에러', () => {
    expect(createCartSrc).toMatch(/cart_orders/);
    expect(createCartSrc).toMatch(/SNAPSHOT_FAILED/);
  });
  it('discountV2 를 opts 에 전달 (v2 ON 시 cart 라인 표시==청구, #876 클래스 재발 방지)', () => {
    // createCartOrder 가 discountV2 를 누락하면 cart 라인은 v1(10%)로 청구되는데 표시가는
    // v2(5%) → 표시≠청구. createPaypalOrder 와 동일하게 discountV2 를 opts 로 넘겨야 한다.
    expect(createCartSrc).toMatch(/discountV2:\s*featureEnabled\(process\.env\.FEATURE_DISCOUNT_V2\)/);
  });
});

describe('resolveLineItemKrw — discountV2 forward (멀티데이/트랜스퍼 표시==청구)', () => {
  // FEATURE_DISCOUNT_V2 ON 이면 멀티데이 3일+ 가 v2(5%)·v1(10%) 으로 갈리므로, opts.discountV2 가
  // resolveMultiDayCheckoutKrw 까지 forward 되면 두 호출 결과가 달라야 한다(미forward=동일=버그).
  const mdBooking = { productType: 'charter_multiday', vehicle: 'staria', originKey: 'ICN', destKey: 'BUSAN', durationDays: 3 };
  it('multiday: discountV2 true(5%) > false(10%) — forward 되면 가격 다름', () => {
    const v2 = resolveLineItemKrw(SPEC, mdBooking, { multidayEnabled: true, discountV2: true });
    const v1 = resolveLineItemKrw(SPEC, mdBooking, { multidayEnabled: true, discountV2: false });
    expect(typeof v2).toBe('number');
    expect(typeof v1).toBe('number');
    // 5% 할인 < 10% 할인 → v2 청구가 > v1 청구가. forward 안 되면 둘 다 10%=동일(이 단언 실패).
    expect(v2 as number).toBeGreaterThan(v1 as number);
  });
});
